"""
Input logger for OBS screen recording mode.
Runs alongside OBS and logs mouse clicks, drags, keyboard events, and
neighborhood tracking to a moments.json file compatible with the screen-demo pipeline.

Usage:
    python scripts/log-inputs.py <slug> [--viewport 2560x1440] [--obs] [--obs-password PASSWORD]

Without --obs: Press Ctrl+C to stop. Clock starts on first interaction.
With --obs:    Connects to OBS WebSocket, waits for recording to start,
               clock syncs to recording start, auto-stops on recording stop.

Requires: pip install obsws-python (only needed if using --obs flag)

Features:
- Click and drag detection (press vs release at different positions)
- Neighborhood tracking: after each click, samples mouse position for 2s
  to determine if the user stays in the same area (for zoom clustering)
- Keyboard typing batched into chunks with cursor position from last click
- OBS WebSocket sync: clock starts with recording, auto-saves on stop
"""

import sys
import json
import time
import math
from pathlib import Path
from threading import Lock, Thread, Event
from pynput import mouse, keyboard

# Parse args
if len(sys.argv) < 2:
    print("Usage: python scripts/log-inputs.py <slug> [--viewport WxH] [--obs]")
    sys.exit(1)

slug = sys.argv[1]
viewport_w, viewport_h = 1920, 1080
use_obs = "--obs" in sys.argv
obs_password = ""

for i, arg in enumerate(sys.argv):
    if arg == "--viewport" and i + 1 < len(sys.argv):
        parts = sys.argv[i + 1].split("x")
        viewport_w, viewport_h = int(parts[0]), int(parts[1])
    if arg == "--obs-password" and i + 1 < len(sys.argv):
        obs_password = sys.argv[i + 1]

# Events for OBS sync
recording_started = Event()
recording_stopped = Event()

data_dir = Path(__file__).parent.parent / "data" / slug
data_dir.mkdir(parents=True, exist_ok=True)

moments = []
moment_id = 0
lock = Lock()
start_time = None
last_click_pos = None
current_typing = ""
typing_start_time = None
typing_pos = None

# Drag tracking
mouse_press_pos = None
mouse_press_time = None
is_dragging = False
DRAG_THRESHOLD = 15  # pixels to distinguish click from drag

# Neighborhood tracking
# After each click, we sample the mouse position every 200ms for 2 seconds.
# If the mouse stays within NEIGHBORHOOD_RADIUS of the click, we mark it
# as "stayed" so the edit plan knows to keep the zoom.
NEIGHBORHOOD_RADIUS = 300  # pixels
NEIGHBORHOOD_DURATION = 2.0  # seconds to track after click
NEIGHBORHOOD_SAMPLE_INTERVAL = 0.2  # seconds between samples
current_mouse_x = 0
current_mouse_y = 0


def get_timestamp():
    global start_time
    if use_obs:
        # In OBS mode, clock is set by OBS RecordStateChanged. Drop events before recording.
        if start_time is None:
            return -1
        return int((time.time() - start_time) * 1000)
    else:
        if start_time is None:
            start_time = time.time()
            print(f"  Clock started at first event")
        return int((time.time() - start_time) * 1000)


def clamp(x, y):
    return max(0, min(viewport_w, int(x))), max(0, min(viewport_h, int(y)))


def add_moment(moment_type, description, cursor=None, target=None, keys=None, extra=None):
    global moment_id
    ts = get_timestamp()
    if ts < 0:
        # OBS mode: recording hasn't started yet, discard this event
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
    """Flush accumulated keystrokes as a single 'type' moment."""
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
    """
    Sample mouse position for NEIGHBORHOOD_DURATION seconds after a click.
    If the mouse stays within NEIGHBORHOOD_RADIUS, annotate the last click
    moment with "stayedInArea": true and the max distance traveled.
    """
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

    # Annotate the most recent click moment
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


# Mouse handlers
def on_move(x, y):
    global current_mouse_x, current_mouse_y
    current_mouse_x, current_mouse_y = int(x), int(y)


def on_click(x, y, button, pressed):
    global last_click_pos, mouse_press_pos, mouse_press_time, is_dragging

    x_c, y_c = clamp(x, y)
    btn_name = "left" if button == mouse.Button.left else "right" if button == mouse.Button.right else "middle"

    if pressed:
        # Mouse button down: record press position, don't emit event yet
        mouse_press_pos = (x_c, y_c)
        mouse_press_time = time.time()
        is_dragging = False
    else:
        # Mouse button up: determine if it was a click or drag
        if mouse_press_pos is None:
            return

        press_x, press_y = mouse_press_pos
        dist = math.sqrt((x_c - press_x) ** 2 + (y_c - press_y) ** 2)

        flush_typing()

        if dist > DRAG_THRESHOLD:
            # It was a drag
            is_dragging = False
            last_click_pos = {"x": x_c, "y": y_c}
            add_moment(
                "drag",
                f"{btn_name.capitalize()} drag from ({press_x},{press_y}) to ({x_c},{y_c})",
                cursor={"x": x_c, "y": y_c},
                target={
                    "x": min(press_x, x_c),
                    "y": min(press_y, y_c),
                    "width": abs(x_c - press_x),
                    "height": abs(y_c - press_y),
                },
                extra={
                    "dragFrom": {"x": press_x, "y": press_y},
                    "dragTo": {"x": x_c, "y": y_c},
                },
            )
        else:
            # It was a click
            last_click_pos = {"x": x_c, "y": y_c}
            add_moment(
                "click",
                f"{btn_name.capitalize()} click at ({x_c}, {y_c})",
                cursor={"x": x_c, "y": y_c},
                target={"x": max(0, x_c - 20), "y": max(0, y_c - 20), "width": 40, "height": 40},
            )

            # Start neighborhood tracking in background
            Thread(target=track_neighborhood, args=(x_c, y_c), daemon=True).start()

        mouse_press_pos = None


def on_scroll(x, y, dx, dy):
    flush_typing()
    x_c, y_c = clamp(x, y)
    direction = "down" if dy < 0 else "up"
    add_moment(
        "scroll",
        f"Scroll {direction} at ({x_c}, {y_c})",
        cursor={"x": x_c, "y": y_c},
    )


# Keyboard handlers
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


def save_moments():
    """Flush typing and write moments.json to disk."""
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

    out_path = data_dir / "moments.json"
    with open(out_path, "w") as f:
        json.dump(moments_file, f, indent=2)

    print(f"\n  Saved {len(moments)} moments to {out_path}")
    print(f"  Total duration: {total_ms}ms")
    print(f"\n  Next: copy your OBS recording to {data_dir / 'recording.mkv'}")


def setup_obs_sync():
    """Connect to OBS WebSocket and sync clock to recording state."""
    global start_time
    try:
        import obsws_python as obs
    except ImportError:
        print("\n  ERROR: obsws-python not installed.")
        print("  Run: pip install obsws-python")
        sys.exit(1)

    # Connect to OBS WebSocket (default: localhost:4455, no password)
    # OBS 28+ has WebSocket server built in. Enable it in:
    #   Tools > WebSocket Server Settings
    conn_kwargs = {"host": "localhost", "port": 4455, "timeout": 5}
    if obs_password:
        conn_kwargs["password"] = obs_password

    try:
        cl = obs.ReqClient(**conn_kwargs)
        print("  Connected to OBS WebSocket")
    except Exception as e:
        print(f"\n  ERROR: Could not connect to OBS WebSocket: {e}")
        print("  Make sure OBS is running and WebSocket Server is enabled.")
        print("  (Tools > WebSocket Server Settings)")
        if "authentication" in str(e).lower():
            print("  Use --obs-password <password> to authenticate.")
        sys.exit(1)

    # Check if already recording
    status = cl.get_record_status()
    if status.output_active:
        print("  OBS is already recording. Starting clock now.")
        start_time = time.time()
        recording_started.set()
    else:
        print("  Waiting for OBS recording to start...")

    # Set up event listener for recording state changes
    ev_kwargs = {"host": "localhost", "port": 4455}
    if obs_password:
        ev_kwargs["password"] = obs_password
    ev = obs.EventClient(**ev_kwargs)

    def on_record_state_changed(data):
        global start_time
        if data.output_active:
            start_time = time.time()
            recording_started.set()
            print(f"\n  OBS recording started. Clock is running.")
            print(f"  Interact normally. Recording will auto-save on stop.\n")
        elif recording_started.is_set():
            # Only stop if we actually started. OBS fires a spurious
            # "stopped" transition when recording begins.
            recording_stopped.set()
            print(f"\n  OBS recording stopped.")

    ev.callback.register(on_record_state_changed)

    return cl, ev


# --- Main ---
print(f"\n  Input Logger for screen-demo")
print(f"  Slug: {slug}")
print(f"  Viewport: {viewport_w}x{viewport_h}")
print(f"  Mode: {'OBS sync' if use_obs else 'manual (Ctrl+C)'}")
print(f"  Neighborhood radius: {NEIGHBORHOOD_RADIUS}px")
print(f"  Drag threshold: {DRAG_THRESHOLD}px")
print(f"  Output: {data_dir / 'moments.json'}")

obs_client = None
obs_events = None

if use_obs:
    obs_client, obs_events = setup_obs_sync()
else:
    print(f"\n  Start your OBS recording, then interact normally.")
    print(f"  The clock starts on your first interaction.")
    print(f"  Press Ctrl+C to stop and save.\n")

mouse_listener = mouse.Listener(on_click=on_click, on_scroll=on_scroll, on_move=on_move)
keyboard_listener = keyboard.Listener(on_press=on_key_press)

mouse_listener.start()
keyboard_listener.start()

try:
    if use_obs:
        # Wait for recording to stop (or Ctrl+C as fallback)
        while not recording_stopped.is_set():
            time.sleep(0.5)
            if typing_start_time and (time.time() - typing_start_time) > 1.5 and current_typing:
                flush_typing()
    else:
        while True:
            time.sleep(0.5)
            if typing_start_time and (time.time() - typing_start_time) > 1.5 and current_typing:
                flush_typing()
except KeyboardInterrupt:
    print("\n  Interrupted by user.")

mouse_listener.stop()
keyboard_listener.stop()

save_moments()
