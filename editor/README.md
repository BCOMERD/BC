# ReCut — AI video projects you can edit

An AI doesn't hand you a flat video. It hands you a **project**: video/images, voiceover, music, titles and subtitles on separate tracks with exact timing. You open it, review it, edit anything, comment on any shot, and export.

## Run
```bash
cd editor
python3 -m http.server 8000     # or any static file server
# open http://localhost:8000
```
No build step, no dependencies. Use **Chrome or Edge** for folder projects.

## Using it
| Action | How |
|---|---|
| Open an AI-generated project | **Open → Project folder…** (a folder with `project.json` + `assets/`) |
| Try it | **Open → Sample project** |
| Add media | **Upload**, or drop files anywhere on the window |
| Edit | Click a clip → **Properties** (text, timing, volume, zoom/shift) |
| Move / trim / split | Drag a clip, drag its edges, **S** at the playhead |
| Comment on a shot | Select a clip → **Comments** tab (or the comment box in Properties) |
| Send changes back to the AI | **Request AI changes** copies every open comment as JSON; paste it to Claude |
| Review status | Draft → In review → Approved |
| Save / export | **Save** writes back to the project folder (or downloads `project.json`); **Export** renders WebM with audio |

Shortcuts: `Space` play · `S` split · `Del` delete · `Ctrl+Z / Ctrl+Shift+Z` undo/redo · `Ctrl+D` duplicate · `←/→` step (Shift = 1 s) · `Ctrl+S` save.

## Project format (`project.json`)
```
meta    { title, width, height, fps, duration, status: draft|review|approved }
assets  { id: { type: image|video|audio, src, name, source: ai|user, prompt } }
tracks  [ { id, type: visual|audio|text, name, muted?, hidden?, clips: [...] } ]
clip    { id, start, duration, source, comment?, commentDone?,
          asset (visual/audio) | text + style{size,color,y,bg} (text),
          in, volume (audio/video), transform{x,y,scale} (visual) }
```
The top track in the list is drawn on top. Audio and text tracks cannot overlap within a track.

Validate AI output before opening it:
```bash
node tools/validate.mjs path/to/project.json
```

## Known limits
- Sample assets are placeholders (`tools/make-sample-assets.mjs`). No AI generation is wired into the app yet; today Claude builds the project folder and applies your comments.
- Export is real-time WebM (`MediaRecorder`), so a 5-minute video takes 5 minutes to export. MP4 needs ffmpeg or a later conversion.
- Not built yet: transitions, effects, keyframes, maps, multi-user review.
