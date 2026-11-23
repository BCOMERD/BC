# ReCut — AI video projects you can edit

An AI doesn't hand you a flat video. It hands you a **project**: video/images, voiceover, music, titles and subtitles on separate tracks with exact timing. You open it, review it, edit anything, comment on any shot, and export.

## Run (full app, with AI)
Needs Node 20+.
```bash
cd editor
npm install
cp .env.example .env        # add ANTHROPIC_API_KEY and ELEVENLABS_API_KEY
npm start                   # → http://localhost:5173
```
The home screen lists your projects and has a **New video** form: describe the video (or paste a script / research notes), pick length, format and an ElevenLabs voice, and press **Generate project**. Claude writes the scenes, ElevenLabs records each line, and the project opens on separate tracks: titles, subtitles, footage slots, voiceover, music.

Review it, comment on any clip, then press **Apply AI changes**: Claude reads every open comment and edits only those clips. Changed voiceover lines are re-recorded with the same voice and the timeline shifts to stay in sync. Requests it can't do (e.g. "use real footage") stay open with a note. Every apply can be undone with Ctrl+Z.

Projects are saved in `editor/projects/` (or `RECUT_PROJECTS`). Your API keys stay on your machine in `.env`; the browser never sees them.

### Without the server
`python3 -m http.server` in `editor/` still runs the editor on its own (sample project, folder projects in Chrome/Edge). **Request AI changes** then copies the comments as JSON instead of applying them.

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
- Footage is not generated: each scene gets a placeholder slot showing what to film or find. Select it and use **Replace media**.
- Music is not generated yet; the Music track starts empty.
- Export is real-time WebM (`MediaRecorder`), so a 5-minute video takes 5 minutes to export. MP4 needs ffmpeg or a later conversion.
- Not built yet: transitions, effects, keyframes, maps, multi-user review.
