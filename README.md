# screen-demo

Open-source screen recording post-production tool. Captures mouse and keyboard inputs alongside your screen recording, auto-generates zoom-to-click camera animations, and renders polished demos with [Remotion](https://www.remotion.dev/).

Like [Screen Studio](https://www.screen.studio/), but free, cross-platform, and hackable.

<!-- Replace the URL below after uploading assets/demo-preview.mp4 to GitHub:
     Edit this README on GitHub, drag-drop the video into the editor, and paste the generated URL -->

https://github.com/user-attachments/assets/50f0b9c1-512d-49a4-a917-69c4ae720620



## Features

- **Automatic zoom-to-click** -- camera zooms to where you click, with configurable zoom levels and easing
- **Smart clustering** -- consecutive clicks in the same area hold the zoom and pan between targets instead of bouncing in and out
- **FPS-adaptive easing** -- animations feel the same at 30fps or 60fps
- **OBS WebSocket sync** -- input logger syncs its clock to OBS recording start/stop. No manual timing offsets.
- **Exclude zones** -- skip zoom for specific screen regions (toolbars, play buttons, etc.)
- **Sound effects** -- optional click sounds and camera whooshes, bring your own audio files
- **Two recording modes** -- automated browser demos with Playwright, or manual recordings with OBS
- **Synthetic cursor** -- for browser mode, renders a smooth animated cursor with click feedback rings

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Python](https://www.python.org/) 3.10+
- [FFmpeg](https://ffmpeg.org/) in your PATH
- [OBS Studio](https://obsproject.com/) 28+ (for OBS mode)

### Install

```bash
git clone https://github.com/Third-Space-interactive/screen-demo.git
cd screen-demo
npm install
pip install -r requirements.txt
```

### OBS Mode (one command)

Record your screen with OBS while the session script handles everything else.

**1. Enable OBS WebSocket** -- OBS > Tools > WebSocket Server Settings

**2. Run a session**

```bash
python scripts/session.py my-video --viewport 2560x1440 --obs-password YOUR_PASSWORD
```

**3. Hit Record in OBS, do your thing, stop recording.** The session script automatically:
- Captures all mouse/keyboard inputs synced to the recording
- Saves `moments.json`
- Finds and copies the OBS video file to the right locations
- Generates the edit plan with zoom segments
- Updates `Root.tsx` to point at your data
- Launches Remotion Studio for preview

**4. Preview, tweak, render**

Scrub through the preview in Remotion Studio. If a zoom needs adjusting, edit `data/my-video/edit-plan.json` directly. When you're happy:

```bash
npm run render -- --output output/my-video/demo.mp4
```

Optional flags:
- `--exclude 400,50,150,60` -- skip zoom for a screen region (e.g. toolbar buttons)
- `--zoom 1.6` -- default zoom level for clicks
- `--type-zoom 1.8` -- zoom level for typing moments
- `--fps 60` -- frame rate (should match your recording)
- `--no-studio` -- skip launching Remotion Studio after recording

### OBS Mode (step by step)

If you prefer manual control, you can run each step individually:

```bash
# 1. Capture inputs (connects to OBS WebSocket)
python scripts/log-inputs.py my-video --viewport 2560x1440 --obs --obs-password YOUR_PASSWORD

# 2. Copy your recording
cp ~/Videos/your-recording.mkv data/my-video/recording.mkv
cp data/my-video/recording.mkv public/recording.mkv

# 3. Generate edit plan
python scripts/build-edit-plan.py my-video

# 4. Update Root.tsx imports to point at data/my-video/, set showCursor: false

# 5. Preview and render
npm start
npm run render
```

### Browser Mode (automated recording)

Automate browser interactions with Playwright. The script records video and captures element positions for the synthetic cursor.

**1. Write a browse plan** (`data/my-demo/browse-plan.json`):

```json
{
  "url": "https://example.com",
  "viewport": { "width": 1920, "height": 1080 },
  "actions": [
    { "type": "navigate", "url": "https://example.com", "description": "Open page" },
    { "type": "wait", "ms": 2000, "description": "Let page load" },
    { "type": "click", "selector": "nav a[href='/docs']", "description": "Click Docs" },
    { "type": "wait", "ms": 2500, "description": "Page transition" }
  ]
}
```

**2. Record**

```bash
npm run record -- my-demo
```

**3. Generate edit plan, preview, render** -- same as OBS mode steps 4-6, but with `showCursor: true`.

## Edit Plan Options

### Exclude zones

Skip zoom for specific screen regions. Useful for toolbars, transport controls, or any UI you click frequently but don't want to highlight.

```bash
python scripts/build-edit-plan.py my-video --exclude 400,50,150,60
```

Format: `--exclude x,y,width,height` (in viewport pixels). Stack multiple flags for multiple zones.

### Zoom levels

```bash
python scripts/build-edit-plan.py my-video --zoom 1.6 --type-zoom 1.8
```

- `--zoom` -- default zoom level for clicks (default: 1.6)
- `--type-zoom` -- zoom level for typing moments (default: 1.8)
- `--fps` -- frame rate, should match your recording (default: 60)

### Manual tweaks

The generated `edit-plan.json` is just JSON. Edit it directly to adjust timing, zoom levels, or remove segments. Re-render without re-recording.

## Sound Effects

Place audio files in `public/sfx/`. The component expects:

| File | Purpose |
|------|---------|
| `click-1.mp3`, `click-2.mp3`, `click-3.mp3` | Mouse click variations (cycled) |
| `whoosh-in-1.mp3`, `whoosh-in-2.mp3` | Zoom-in camera sounds |
| `whoosh-out-1.mp3`, `whoosh-out-2.mp3` | Zoom-out sounds |
| `whoosh-pan.mp3` | Camera pan between segments |

Tip: reverse your zoom-in sounds to create natural zoom-out sounds.

SFX is optional. Set `showSfx={false}` in Root.tsx to disable, or adjust volumes via the `clickVolume` and `whooshVolume` props on the `SoundEffects` component.

## How It Works

1. **Input capture** -- `log-inputs.py` runs alongside OBS, listening for mouse/keyboard events via `pynput`. After each click, it tracks whether the mouse stays in the same area for 2 seconds (neighborhood tracking), which tells the edit plan generator whether to cluster clicks.

2. **Edit plan generation** -- `build-edit-plan.py` reads the moments and applies rules: clicks with `stayedInArea=true` in sequence become one zoom segment with camera panning. Drags get no zoom. Typing extends the preceding click. The last click is always dropped (it's you pressing Stop in OBS).

3. **Remotion composition** -- `CameraTransform` reads the edit plan and computes zoom/pan state per frame. Easing durations scale with FPS so animations feel consistent. When two zoom segments are close enough that bouncing out and back in would take under 3 seconds, it pans directly instead.

4. **Render** -- Remotion renders each frame via FFmpeg. The video plays 1:1 (no speed changes). You trim pacing in your video editor.

## Project Structure

```
screen-demo/
  scripts/
    log-inputs.py        # OBS input logger (Python)
    build-edit-plan.py   # Auto edit plan generator (Python)
    record.ts            # Playwright browser recorder (TypeScript)
  src/
    Root.tsx              # Remotion entry point
    ScreenDemo.tsx        # Main composition
    types.ts              # TypeScript interfaces
    backgrounds/
      Background.tsx      # Animated grid background
    components/
      CameraTransform.tsx # Zoom/pan camera system
      SyntheticCursor.tsx # Animated cursor (browser mode)
      SoundEffects.tsx    # Click + whoosh audio
      FloatingWindow.tsx  # Centered window with shadow
      FrameMapper.ts      # Frame-to-time mapping
    styles/
      colors.ts           # Theme constants
      cursor.ts           # Cursor shape constants
  data/                   # Per-recording data (moments.json, edit-plan.json)
  public/                 # Static assets (recordings, SFX)
  output/                 # Rendered videos
```

## License

MIT. Copyright (c) 2026 [Third Space Interactive](https://github.com/Third-Space-interactive).
