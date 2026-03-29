---
name: screen-demo
description: Use when the user wants to create a screen recording demo, either browser-based (Playwright) or OBS-recorded. Triggers on "/screen-demo", "screen demo", "record a demo", "screen recording", "browser demo", "OBS demo".
---

# Screen Demo Skill

Produce polished screen demos with Remotion post-production (floating window, animated background, dramatic zooms, smooth camera pans). Two recording modes:

- **Browser mode**: Playwright captures automated browser interactions from a browse plan.
- **OBS mode**: User records manually with OBS while a Python logger captures input events.

## Critical Architecture Notes

These rules were established through iterative testing. Do not deviate.

### Video playback is always 1:1
The composition plays the raw recording at real-time (`startFrom=0`, `playbackRate=1`). Do NOT use variable speed, dynamic `startFrom`, or per-region `<Sequence>` wrappers. The user trims pacing in their video editor after.

### Timestamps are pre-action
Timestamps are captured BEFORE each action executes. The cursor should arrive at the target at the same moment the action fires in the video.

### Cursor motion model: hold-then-snap
The synthetic cursor holds at each position, then moves to the next target in ~450ms with eased `inOut(cubic)` motion.

### Camera pans between consecutive zooms
When the total bounce time (ease-out + dead air + ease-in) between two zoom segments is under 3 seconds, the camera smoothly pans between targets instead of zooming out to 1x and back in.

### FPS-adaptive easing
All ease frame counts in the edit plan are authored at 30fps base. CameraTransform scales them by `fps / 30` so the animation takes the same wall-clock time at any framerate.

### Drags get no zoom
Drag events can span the full viewport. Camera stays at default 1x during drags.

### Viewport-aware coordinate mapping
CameraTransform receives `viewportWidth`/`viewportHeight` from moments metadata. Never hardcode 1920x1080. OBS recordings are typically 2560x1440.

## OBS Mode Workflow

### Step 1: Record with OBS sync

Start the input logger, then record with OBS. The logger connects to OBS WebSocket and syncs its clock to the recording start/stop.

```bash
python scripts/log-inputs.py <slug> --viewport 2560x1440 --obs --obs-password <password>
```

The logger waits for OBS to start recording, captures all mouse/keyboard events, then auto-saves `moments.json` when OBS stops recording.

OBS WebSocket must be enabled: OBS > Tools > WebSocket Server Settings.

### Step 2: Copy recording

```bash
cp ~/Videos/<recording>.mkv data/<slug>/recording.mkv
cp data/<slug>/recording.mkv public/recording.mkv
```

### Step 3: Generate edit plan

```bash
python scripts/build-edit-plan.py <slug>
```

This auto-generates zoom segments from moments.json using established rules:
- Clicks with `stayedInArea=True` in sequence cluster into one segment with `zoomTargetEnd` panning
- Typing merges into the preceding click segment at higher zoom
- `stayedInArea=False` or missing annotation breaks clusters
- Drags and scrolls get no zoom segments
- Last click is always dropped (OBS stop button)

Optional flags: `--fps 60`, `--zoom 1.6`, `--type-zoom 1.8`, `--exclude x,y,w,h`

### Step 4: Update Root.tsx

Change the imports to point at the new slug:

```tsx
import editPlanData from "../data/<slug>/edit-plan.json";
import momentsData from "../data/<slug>/moments.json";
```

Set `showCursor: false` for OBS mode (real cursor is in the recording).

### Step 5: Preview and render

```bash
npx remotion studio          # preview
npx remotion render ScreenDemo output/<slug>/demo.mp4  # render
```

### Step 6: Hand-tweak (optional)

Edit `data/<slug>/edit-plan.json` to adjust zoom levels, easing, or segment timing. Re-render without re-recording.

## Browser Mode Workflow

### Step 1: Inspect the target page

Use Playwright MCP tools (`browser_navigate` + `browser_snapshot`) to inspect the DOM and identify CSS selectors.

### Step 2: Generate browse plan (Checkpoint 1)

Build `browse-plan.json` with explicit `wait` actions between interactions:
- After hover: 1.5s wait
- After click: 2.5s wait
- After theme/visual change: 3s wait
- After page navigation: 2.5s wait
- After scroll: 1.5-2s wait

Present to user. **Wait for approval.**

### Step 3: Record

```bash
npx tsx scripts/record.ts <slug>
```

Outputs `recording.mp4` and `moments.json` in `data/<slug>/`.

### Step 4: Generate edit plan (Checkpoint 2)

Read `moments.json`. Compute frames: `frame = Math.round(timestamp_ms / 1000 * 30)`.

Zoom levels by target area:
- < 2,000 px: 2.0x-2.5x
- 2,000-10,000 px: 1.5x-2.0x
- > 10,000 px: 1.2x-1.5x

Easing: 12-15 frames ease-in, 10-20 frames ease-out.

Present to user. **Wait for approval.**

### Step 5-7: Build, render, present

Same as OBS mode steps 4-6, but with `showCursor: true` (synthetic cursor) and `recording.mp4`.

## Action Types (Browser Mode)

| Type | Fields | Notes |
|------|--------|-------|
| `navigate` | `url` | Page navigation |
| `click` | `selector` | Click element |
| `hover` | `selector` | Hover element |
| `scroll` | `deltaY` | Scroll viewport (default 400px) |
| `wait` | `ms` | Explicit pause for camera breathing room |
| `script` | `js` | Run JS on page (theme toggles, class changes) |

## Data Files

Per-demo data in `data/<slug>/`:
- `browse-plan.json` - browser mode input
- `moments.json` - recorded events (both modes)
- `edit-plan.json` - zoom plan (auto-generated or hand-authored)
- `recording.mp4` / `recording.mkv` - raw recording

Rendered output: `output/<slug>/demo.mp4`
