# Applying this to `Chapter02V3.jsx` (Remotion)

Source on Drive: `morik-v3-remotion-source` → `Chapter02V3.jsx`. The v2 video was built from `Chapter02V2.jsx`.
V3 already has the draw-on borders and the zoom change, so patch V3, not V2. I could not render here
(the video assets are not in this environment), so these changes are untested. Run `npx remotion preview`
on your laptop after each step.

## 1. Drop in the files
Copy `OilWells.jsx`, `TVCaption.jsx`, `oil-wells.json` next to `Chapter02V3.jsx`.

## 2. Oil map (take 14)
In `Chapter02V3.jsx`:

```jsx
import {OilWells} from './OilWells.jsx';
import {TVCaption} from './TVCaption.jsx';
```

Replace the whole `OilMap` function:

```jsx
function OilMap({film,t,duration}){
 const p=ease(t/duration);
 const cue=name=>Math.max(0,(film.wordCues?.[name]??0)-start(film,14));
 return <AbsoluteFill><MapBase film={film} center={[44.5,34.2]} scale={mix(1.03,1.0,p)}
   progress={{tigris:.98,euphrates:1}} riverOpacity={.3}>{screen=><>
   <OilWells screen={screen} t={t} cues={{kirkuk:cue('14.kirkuk')||.4,mixed:cue('14.mixed')||6.5}}/>
 </>}</MapBase></AbsoluteFill>;
}
```

In `MapBase` add the prop `riverOpacity=1` and wrap the river line:
`<g opacity={riverOpacity}>{film.rivers.map(...)}</g>`. Remove the old `Pump` use in `OilMap`.

## 3. Map continues at 1:08 (take 9)
`management` currently re-enters the map with `Connections ... management`. In `Connections`:
- start `scale` at the same value the previous scene ended on (take 8 ends at `mix(1.10,1.04,1)=1.04`), so `mix(1.04,1.12,p)`.
- keep `borderProgress=ease(t/4)` so borders draw on one by one while the narrator explains control.
- the four capitals are already staggered (`.8` s apart). Add a glow: a second `<circle r=18 fill=none stroke=GOLD>` with opacity `ease((t-.4-i*.8)/.65)`.
- set `Scene` opacity fade for `management` to 1 (no 0.25 s fade-in), so there is no cut: change `scene.start===0?1:ease(t/.25)` to also return 1 when `scene.kind==='management'`.

## 4. No repeated images
In the `assets` table replace each entry with the new files from `SHOTLIST.md` (path `chapter-02-v4/<file>`).
Rewrite the photo scenes so each segment names a different asset:

```jsx
case 'ancient': items=[['ur',a],['bridge',duration-a]]
case 'uses':    items=[['farm',a],['intake',(b-a)/2],['hydro',(b-a)/2],['wheat',duration-b]]
case 'dam':     'ataturkWide'
case 'regulation' (after the diagram): [['ilisu',.34],['mosul',.33],['dukan',.33]]
case 'oil-intro': 'pumpjack'
case 'supply': background 'pipeline'
case 'strength': [['riverLandscape',a],['refinery',b-a],['mountain',c-b],['city',duration-c]]
```

Add `check-assets.mjs` at the project root and run it before rendering:

```js
import fs from 'fs';
const src=fs.readFileSync('src/Chapter02V3.jsx','utf8');
const files=[...src.matchAll(/chapter-02-v4\/[\w.-]+/g)].map(m=>m[0]);
const dup=files.filter((f,i)=>files.indexOf(f)!==i);
const missing=files.filter(f=>!fs.existsSync('public/'+f));
if(dup.length||missing.length){console.error({dup,missing});process.exit(1)}
```

## 5. Captions
Inside `Scene`, after `content`, render `<TVCaption take={film.takes[scene.first-1]}/>` per take. The component hides itself outside the take's speech window. For scenes that span two takes (`rivers`, `connections`, `regulation`, `supply`, `people`) map over `first..last`.

## 6. CapCut export
Render separate layers (needs the full project on your laptop):

```
npx remotion render Chapter02V3 out/maps.mov --codec=prores --prores-profile=4444 --image-format=png --pixel-format=yuva444p10le
```

Do the same for a caption-only composition. Images stay as individual files in `Chapter02/images/`.
