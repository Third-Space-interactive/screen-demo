"""
One-command OBS recording session.

Connects to OBS WebSocket, captures inputs during recording, then
automatically copies the video, generates the edit plan, updates
Root.tsx, and launches Remotion Studio for preview.

Usage:
    python scripts/session.py <slug> [--viewport 2560x1440] [--obs-password PASSWORD]
                                     [--fps 60] [--zoom 1.6] [--type-zoom 1.8]
                                     [--exclude x,y,w,h] [--no-studio]

What happens:
    1. Connects to OBS WebSocket and waits for you to hit Record
    2. Captures mouse/keyboard inputs while you record
    3. When you stop recording:
       a. Saves moments.json
       b. Finds and copies the OBS recording to data/<slug>/ and public/
       c. Generates edit-plan.json with zoom segments
       d. Updates src/Root.tsx to point at your data
       e. Launches Remotion Studio for preview

Example:
    python scripts/session.py my-demo --viewport 2560x1440 --obs-password secret123
"""

import sys
import os
import json
import time
import math
import shutil
import subprocess
from pathlib import Path
from threading import Lock, Thread, Event
from pynput import mouse, keyboard

# ── Parse args ──

if len(sys.argv) < 2:
    print("Usage: python scripts/session.py <slug> [--viewport WxH] [--obs-password PW] [--exclude x,y,w,h] [--no-studio]")
    sys.exit(1)

slug = sys.argv[1]
viewport_w, viewport_h = 1920, 1080
obs_password = ""
edit_fps = 60
edit_zoom = 1.6
edit_type_zoom = 1.8
exclude_zones = []
launch_studio = True

for i, arg in enumerate(sys.argv):
    if arg == "--viewport" and i + 1 < len(sys.argv):
        parts = sys.argv[i + 1].split("x")
        viewport_w, viewport_h = int(parts[0]), int(parts[1])
    if arg == "--obs-password" and i + 1 < len(sys.argv):
        obs_password = sys.argv[i + 1]
    if arg == "--fps" and i + 1 < len(sys.argv):
        edit_fps = int(sys.argv[i + 1])
    if arg == "--zoom" and i + 1 < len(sys.argv):
        edit_zoom = float(sys.argv[i + 1])
    if arg == "--type-zoom" and i + 1 < len(sys.argv):
        edit_type_zoom = float(sys.argv[i + 1])
    if arg == "--exclude" and i + 1 < len(sys.argv):
        parts = sys.argv[i + 1].split(",")
        exclude_zones.append((int(parts[0]), int(parts[1]), int(parts[2]), int(parts[3])))
    if arg == "--no-studio":
        launch_studio = False

project_root = Path(__file__).parent.parent
data_dir = project_root / "data" / slug
public_dir = project_root / "public"
data_dir.mkdir(parents=True, exist_ok=True)

# ── OBS connection ──

try:
    import obsws_python as obs
except ImportError:
    print("\n  ERROR: obsws-python not installed.")
    print("  Run: pip install obsws-python")
    sys.exit(1)

conn_kwargs = {"host": "localhost", "port": 4455, "timeout": 5}
if obs_password:
    conn_kwargs["password"] = obs_password

try:
    obs_client = obs.ReqClient(**conn_kwargs)
    print("\n  screen-demo session")
    print(f"  Slug: {slug}")
    print(f"  Viewport: {viewport_w}x{viewport_h}")
    print(f"  Connected to OBS WebSocket")
except Exception as e:
    print(f"\n  ERROR: Could not connect to OBS WebSocket: {e}")
    print("  Make sure OBS is running and WebSocket Server is enabled.")
    print("  (Tools > WebSocket Server Settings)")
    if "authentication" in str(e).lower():
        print("  Use --obs-password <password> to authenticate.")
    sys.exit(1)

# ── Input logger state ──

moments = []
moment_id = 0
lock = Lock()
start_time = None
last_click_pos = None
current_typing = ""
typing_start_time = None
typing_pos = None
mouse_press_pos = None
mouse_press_time = None
is_dragging = False
current_mouse_x = 0
current_mouse_y = 0

DRAG_THRESHOLD = 15
NEIGHBORHOOD_RADIUS = 300
NEIGHBORHOOD_DURATION = 2.0
NEIGHBORHOOD_SAMPLE_INTERVAL = 0.2

recording_started = Event()
recording_stopped = Event()
obs_output_path = None


def get_timestamp():
    global start_time
    if start_time is None:
        return -1
    return int((time.time() - start_time) * 1000)


def clamp(x, y):
    return max(0, min(viewport_w, int(x))), max(0, min(viewport_h, int(y)))


def add_moment(moment_type, description, cursor=None, target=None, keys=None, extra=None):
    global moment_id
    ts = get_timestamp()
    if ts < 0:
        return None
    with lock:
        moment_id += 1
        moment = {
            "id": moment_id,
            "type": moment_type,
            "timestamp": ts,
            "description": description,
        }
        if cursor:
            moment["cursor"] = cursor
        if target:
            moment["target"] = target
        if keys:
            moment["keys"] = keys
        if extra:
            moment.update(extra)
        moments.append(moment)
        print(f"  [{moment['timestamp']}ms] {moment_type}: {description}")
        return moment


def flush_typing():
    global current_typing, typing_start_time, typing_pos
    if current_typing and typing_pos:
        add_moment(
            "type",
            f"Typed: {current_typing[:50]}{'...' if len(current_typing) > 50 else ''}",
            cursor=typing_pos,
            keys=current_typing,
        )
    current_typing = ""
    typing_start_time = None
    typing_pos = None


def track_neighborhood(click_x, click_y):
    samples = []
    end_time = time.time() + NEIGHBORHOOD_DURATION
    while time.time() < end_time:
        time.sleep(NEIGHBORHOOD_SAMPLE_INTERVAL)
        dist = math.sqrt((current_mouse_x - click_x) ** 2 + (current_mouse_y - click_y) ** 2)
        samples.append(dist)
    if not samples:
        return
    max_dist = max(samples)
    stayed = max_dist < NEIGHBORHOOD_RADIUS
    with lock:
        for m in reversed(moments):
            if m["type"] in ("click", "drag"):
                m["stayedInArea"] = stayed
                m["maxDriftPx"] = round(max_dist)
                if stayed:
                    print(f"    -> Stayed in area (max drift: {round(max_dist)}px)")
                else:
                    print(f"    -> Left area (max drift: {round(max_dist)}px)")
                break


# ── Mouse/keyboard handlers ──

def on_move(x, y):
    global current_mouse_x, current_mouse_y
    current_mouse_x, current_mouse_y = int(x), int(y)


def on_click(x, y, button, pressed):
    global last_click_pos, mouse_press_pos, mouse_press_time, is_dragging
    x_c, y_c = clamp(x, y)
    btn_name = "left" if button == mouse.Button.left else "right" if button == mouse.Button.right else "middle"
    if pressed:
        mouse_press_pos = (x_c, y_c)
        mouse_press_time = time.time()
        is_dragging = False
    else:
        if mouse_press_pos is None:
            return
        press_x, press_y = mouse_press_pos
        dist = math.sqrt((x_c - press_x) ** 2 + (y_c - press_y) ** 2)
        flush_typing()
        if dist > DRAG_THRESHOLD:
            is_dragging = False
            last_click_pos = {"x": x_c, "y": y_c}
            add_moment("drag", f"{btn_name.capitalize()} drag from ({press_x},{press_y}) to ({x_c},{y_c})",
                cursor={"x": x_c, "y": y_c},
                target={"x": min(press_x, x_c), "y": min(press_y, y_c),
                         "width": abs(x_c - press_x), "height": abs(y_c - press_y)},
                extra={"dragFrom": {"x": press_x, "y": press_y}, "dragTo": {"x": x_c, "y": y_c}})
        else:
            last_click_pos = {"x": x_c, "y": y_c}
            add_moment("click", f"{btn_name.capitalize()} click at ({x_c}, {y_c})",
                cursor={"x": x_c, "y": y_c},
                target={"x": max(0, x_c - 20), "y": max(0, y_c - 20), "width": 40, "height": 40})
            Thread(target=track_neighborhood, args=(x_c, y_c), daemon=True).start()
        mouse_press_pos = None


def on_scroll(x, y, dx, dy):
    flush_typing()
    x_c, y_c = clamp(x, y)
    direction = "down" if dy < 0 else "up"
    add_moment("scroll", f"Scroll {direction} at ({x_c}, {y_c})", cursor={"x": x_c, "y": y_c})


def on_key_press(key):
    global current_typing, typing_start_time, typing_pos
    try:
        char = key.char
        if char is None:
            return
    except AttributeError:
        key_name = str(key).replace("Key.", "")
        if key_name in ("shift", "shift_r", "ctrl_l", "ctrl_r", "alt_l", "alt_r", "cmd"):
            return
        flush_typing()
        if key_name == "enter":
            add_moment("key", "Press Enter", cursor=last_click_pos)
        elif key_name == "tab":
            add_moment("key", "Press Tab", cursor=last_click_pos)
        elif key_name == "backspace":
            add_moment("key", "Press Backspace", cursor=last_click_pos)
        elif key_name == "escape":
            add_moment("key", "Press Escape", cursor=last_click_pos)
        elif key_name == "space":
            current_typing += " "
            if typing_start_time is None:
                typing_start_time = time.time()
                typing_pos = last_click_pos
        else:
            add_moment("key", f"Press {key_name}", cursor=last_click_pos)
        return
    if typing_start_time is None:
        typing_start_time = time.time()
        typing_pos = last_click_pos
    current_typing += char
    if len(current_typing) >= 80:
        flush_typing()


# ── OBS event handling ──

ev_kwargs = {"host": "localhost", "port": 4455}
if obs_password:
    ev_kwargs["password"] = obs_password
obs_events = obs.EventClient(**ev_kwargs)


def on_record_state_changed(data):
    global start_time, obs_output_path
    if data.output_active:
        start_time = time.time()
        recording_started.set()
        print(f"\n  Recording started. Clock is running.")
        print(f"  Interact normally. Stop recording in OBS when done.\n")
    elif recording_started.is_set():
        # Get the output path from the event data
        obs_output_path = getattr(data, "output_path", None)
        recording_stopped.set()
        print(f"\n  Recording stopped.")


obs_events.callback.register(on_record_state_changed)

# Check if already recording
status = obs_client.get_record_status()
if status.output_active:
    print("  OBS is already recording. Starting clock now.")
    start_time = time.time()
    recording_started.set()
else:
    print(f"\n  Ready. Hit Record in OBS to begin.\n")

# ── Main loop: capture inputs ──

mouse_listener = mouse.Listener(on_click=on_click, on_scroll=on_scroll, on_move=on_move)
keyboard_listener = keyboard.Listener(on_press=on_key_press)
mouse_listener.start()
keyboard_listener.start()

try:
    while not recording_stopped.is_set():
        time.sleep(0.5)
        if typing_start_time and (time.time() - typing_start_time) > 1.5 and current_typing:
            flush_typing()
except KeyboardInterrupt:
    print("\n  Interrupted by user.")

mouse_listener.stop()
keyboard_listener.stop()

# ── Step 1: Save moments.json ──

print("\n  ── Post-recording pipeline ──\n")

flush_typing()
total_ms = int((time.time() - start_time) * 1000) if start_time else 0

moments_file = {
    "metadata": {
        "url": "obs-recording",
        "viewportWidth": viewport_w,
        "viewportHeight": viewport_h,
        "totalDurationMs": total_ms,
        "recordingStart": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(start_time)) if start_time else "",
    },
    "moments": moments,
}

moments_path = data_dir / "moments.json"
with open(moments_path, "w") as f:
    json.dump(moments_file, f, indent=2)
print(f"  [1/5] Saved {len(moments)} moments to {moments_path}")

# ── Step 2: Find and copy the OBS recording ──

recording_src = None

# Try getting path from OBS websocket event
if obs_output_path and Path(obs_output_path).exists():
    recording_src = Path(obs_output_path)
else:
    # Fallback: query OBS for the last recording via the output directory
    # OBS saves to its configured recording path. We look for the newest file.
    try:
        record_dir = obs_client.get_record_directory().record_directory
        record_path = Path(record_dir)
        if record_path.exists():
            # Find most recent video file
            video_files = sorted(
                [f for f in record_path.iterdir()
                 if f.suffix.lower() in (".mkv", ".mp4", ".flv", ".mov", ".ts")],
                key=lambda f: f.stat().st_mtime,
                reverse=True,
            )
            if video_files:
                newest = video_files[0]
                # Only use it if it was modified in the last 30 seconds
                if time.time() - newest.stat().st_mtime < 30:
                    recording_src = newest
    except Exception:
        pass

if recording_src is None:
    print("  [2/5] WARNING: Could not find OBS recording automatically.")
    print(f"         Copy your recording manually to: {data_dir / 'recording.mkv'}")
    print(f"         And to: {public_dir / 'recording.mkv'}")
else:
    ext = recording_src.suffix
    dest_data = data_dir / f"recording{ext}"
    dest_public = public_dir / f"recording{ext}"

    shutil.copy2(recording_src, dest_data)
    shutil.copy2(recording_src, dest_public)
    print(f"  [2/5] Copied recording: {recording_src.name} -> data/{slug}/ and public/")

# ── Step 3: Generate edit plan ──

# Import build-edit-plan inline to reuse its logic
# We shell out to keep it simple and consistent with standalone usage
exclude_args = []
for zone in exclude_zones:
    exclude_args.extend(["--exclude", f"{zone[0]},{zone[1]},{zone[2]},{zone[3]}"])

build_cmd = [
    sys.executable, str(project_root / "scripts" / "build-edit-plan.py"),
    slug,
    "--fps", str(edit_fps),
    "--zoom", str(edit_zoom),
    "--type-zoom", str(edit_type_zoom),
] + exclude_args

result = subprocess.run(build_cmd, capture_output=True, text=True)
if result.returncode == 0:
    # Count segments from output
    seg_count = result.stdout.count("@ (")
    print(f"  [3/5] Generated edit plan ({seg_count} zoom segments)")
else:
    print(f"  [3/5] ERROR generating edit plan:")
    print(result.stderr or result.stdout)

# ── Step 4: Update Root.tsx ──

video_filename = f"recording{ext}" if recording_src else "recording.mkv"

root_tsx = f'''import React from "react";
import {{ Composition }} from "remotion";
import {{ ScreenDemo }} from "./ScreenDemo";
import type {{ EditPlan, MomentsFile }} from "./types";

import editPlanData from "../data/{slug}/edit-plan.json";
import momentsData from "../data/{slug}/moments.json";

const editPlan = editPlanData as EditPlan;
const moments = momentsData as MomentsFile;

export const RemotionRoot: React.FC = () => {{
  return (
    <>
      <Composition
        id="ScreenDemo"
        component={{ScreenDemo as unknown as React.ComponentType<Record<string, unknown>>}}
        durationInFrames={{editPlan.totalDurationFrames}}
        fps={{editPlan.fps}}
        width={{1920}}
        height={{1080}}
        defaultProps={{{{
          editPlan,
          moments,
          videoFileName: "{video_filename}",
          showCursor: false,
          showSfx: true,
        }}}}
      />
    </>
  );
}};
'''

root_path = project_root / "src" / "Root.tsx"
with open(root_path, "w") as f:
    f.write(root_tsx)
print(f"  [4/5] Updated Root.tsx -> data/{slug}/")

# ── Step 5: Launch Remotion Studio ──

if launch_studio:
    print(f"  [5/5] Launching Remotion Studio...\n")
    print(f"  ── Session complete ──\n")
    print(f"  Preview your demo in the browser, then render with:")
    print(f"    npm run render -- --output output/{slug}/demo.mp4\n")
    os.chdir(project_root)
    subprocess.run(["npx", "remotion", "studio"], shell=True)
else:
    print(f"  [5/5] Skipped studio launch (--no-studio)")
    print(f"\n  ── Session complete ──\n")
    print(f"  To preview:  npm start")
    print(f"  To render:   npm run render -- --output output/{slug}/demo.mp4\n")
