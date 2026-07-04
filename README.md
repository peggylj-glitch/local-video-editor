# Simple Video Timeline Editor

A small local browser editor for trimming and arranging vertical video clips. It is designed for quick social-video edits where you want to preview source clips, add edited sections to a timeline, adjust timing, and export a 9:16 MP4.

## Features

- Choose local `.MOV` or `.MP4` source videos.
- Preview a source video before adding it to the timeline.
- Add clips to a drag-reorder timeline.
- Uses varied rule-based defaults to recommend a better start time and duration when a clip is added.
- Auto-arranges timeline clips into a simple story flow with an intro, build, peak, and ending.
- Adjust each timeline clip's start time, duration, and volume.
- Preview the full edit or only the selected timeline clip.
- Save and load project timelines as JSON.
- Export a 1080x1920 vertical MP4 using ffmpeg.

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer.
- [ffmpeg](https://ffmpeg.org/) installed and available from your terminal as `ffmpeg`.

### macOS

If you use Homebrew:

```bash
brew install ffmpeg
```

### Windows

Install ffmpeg and add it to your `PATH`, then confirm this works in Command Prompt or PowerShell:

```bash
ffmpeg -version
```

One common option is installing ffmpeg with winget:

```bash
winget install Gyan.FFmpeg
```

Restart your terminal after installing.

## Run

```bash
npm start
```

Then open:

```text
http://127.0.0.1:8787
```

## Usage

1. Click `Choose Source` and select one or more videos.
2. Click a source video to preview it.
3. Click `Add to timeline` for clips you want to include. The editor will pick a suggested start and duration that you can adjust.
4. Use `Auto Arrange` if you want the timeline ordered into a simple story flow.
5. Select timeline clips to preview and fine-tune start/duration.
6. Click `Export Video` when ready.

Exports are written to the project folder. Temporary files are written to `build/`.

## Notes

- The export is center-cropped to 1080x1920.
- Browser preview is good for quick timing decisions, but it is not frame-accurate.
- Keep source videos and exports out of Git. The included `.gitignore` is set up for that.
