# Morik – Chapter 02 (v2) revision plan

Times come from `chapter-02-v1-props.json` (take start frames at 30 fps). The 1:09 and 1:58 notes
match take 9 (1:08) and take 14 (1:56). Takes 19–20 were not read; fill them in from the props file.

## Rule for the whole film
No image file is used twice. Every row below has its own file. The checker in `PATCH.md` fails the render if two shots point to the same file.

## Shot list (narration → visual)

| Take | Time | Narration (short) | Visual | New file needed |
|---|---|---|---|---|
| 1–4 | 0:00–0:27 | Euphrates and Tigris sources | Map, rivers draw on (keep) | — |
| 5 | 0:27 | Ancient civilizations between two rivers | Ur ziggurat (keep `ur.jpg`) | — |
| 5b | 0:34 | …waters connect highlands to distant cities | **Ten-Eyed Bridge, Diyarbakır, Tigris** (replaces weak `tigris-city.png`) | `bridge-tigris-amed.jpg` |
| 6a | 0:40 | Agriculture | **Irrigated farmland, Iraq/Syria plain** | `farmland-irrigated.jpg` |
| 6b | 0:44 | Drinking water | Water treatment / canal intake | `water-intake.jpg` |
| 6c | 0:47 | Electricity | **Hydro turbine hall or transmission lines** | `hydro-turbines.jpg` |
| 6d | 0:50 | "…not the source of all water" | Rain-fed wheat, Kurdistan hills (replaces `wheat.jpg`) | `wheat-rainfed.jpg` |
| 7–8 | 0:54–1:07 | Highlands, regional security | Map (keep) | — |
| **9** | **1:08** | **Actual control depends on who operates the dams** | **Map continues (no re-entry cut).** Borders of Turkey, Iraq, Iran, Syria draw on one by one; capitals Ankara, Baghdad, Tehran, Damascus light up in order. Atatürk Dam marker last. | — (code) |
| 10 | 1:24 | GAP: 22 dams, 19 plants | Atatürk Dam wide (upgrade `ataturk.jpg`) | `ataturk-dam-wide.jpg` |
| 11 | 1:35 | Regulating flow upstream | Diagram (keep, already code) | — |
| 12a | 1:40 | Water becomes development | Ilısu Dam / reservoir | `ilisu-dam.jpg` |
| 12b | 1:46 | …negotiation and influence | Mosul Dam, downstream | `mosul-dam.jpg` |
| 12c | 1:50 | …not a single key held by a single people | Dukan or Darbandikhan Dam, Kurdistan Region | `dukan-dam.jpg` |
| 13 | 1:52 | Add to the water… oil | **Pumpjack at dusk, no flames** (replaces fire image) | `oil-pumpjack-dusk.jpg` |
| **14** | **1:56** | **Kirkuk and the oil fields** | **Oil map, wider frame, wells appear in sync (see below)** | — (code) |
| 15 | 2:10 | Reserves ≠ revenue | Pipeline over desert | `oil-pipeline.jpg` |
| 16 | 2:21 | Pause the map, take stock | Map, labels off (keep) | — |
| 17a | 2:25 | Water resources | Tigris gorge / river landscape (not reused from 5b) | `river-landscape.jpg` |
| 17b | 2:29 | Energy | Refinery tanks / export terminal | `refinery-tanks.jpg` |
| 17c | 2:33 | Terrain | Mountains (replace `mountain.jpg` only if weak) | `mountain-terrain.jpg` |
| 17d | 2:38 | Community | Erbil street/bazaar (keep `erbil-wide.jpg`) | — |
| 18+ | 2:38– | Closing | As is | — |

## Oil map framing (take 14, 1:56)
- Scale 1.00 → 1.00 (full frame), centre `[44.5, 34.2]`: shows Batman to Gachsaran. The current 1.08 crop cuts the south Iraq fields.
- Rivers stay, drawn at 30% opacity so wells read first.
- Wells appear in this order: Kirkuk on the word "Kirkuk", the Kurdistan Region fields on "oil fields of the Kurdistan Region", all others on "mixed or disputed".
- Wells data and verification sources: `oil-wells.json`. Coordinates are approximate field centres. Check each against its source and delete any you cannot confirm.

## Captions
`TVCaption.jsx`: no box, 8 px dark stroke + soft shadow, 46 px Georgia, 96 px above the bottom edge, max 9 words on screen, words timed from `speechStart` / `speechSeconds`. Keep the lower third free of map labels while a caption is up.

## Images: sourcing
- Real places (bridge, dams, pipeline): use licensed photos (Wikimedia Commons CC-BY/CC0 or a stock licence) and credit them. AI-generated images of real landmarks can show wrong details, so use them only for generic scenes (farmland, water intake, refinery tanks, pumpjack at dusk).
- Do not generate or show identifiable people at the negotiation scene.
- Minimum 3840×2160, so a slow zoom does not soften.

## Separate material per chapter (for CapCut)
Export per chapter: `Chapter02/maps/*.mov` (ProRes 4444, alpha), `Chapter02/captions/*.mov` (alpha), `Chapter02/images/*.jpg`, and the narration audio. This repo does not render them. See `PATCH.md`.
