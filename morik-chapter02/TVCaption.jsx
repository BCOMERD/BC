import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';

// Broadcast-safe caption: no background box, heavy stroke + soft shadow, inside 5% safe area,
// words revealed in sync with the narration (take.speechStart / take.speechSeconds).
export function TVCaption({take}) {
  const t = useCurrentFrame() / 30;
  const words = take.text.split(/\s+/);
  const total = words.reduce((a, w) => a + w.length + 2, 0);
  let acc = 0;
  const timed = words.map(w => {
    const a = take.speechStart + (acc / total) * take.speechSeconds;
    acc += w.length + 2;
    return {w, a};
  });
  const shown = timed.filter(x => t >= x.a);
  // Show only the current 2-line phrase (about 9 words) so it never covers the map.
  const idx = Math.max(0, shown.length - 1);
  const page = Math.floor(idx / 9);
  const slice = timed.slice(page * 9, page * 9 + 9);
  const cur = t - take.speechStart;
  if (cur < -0.1 || cur > take.speechSeconds + 0.4) return null;
  return (
    <AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 96, pointerEvents: 'none'}}>
      <div style={{width: 1500, textAlign: 'center', font: '600 46px Georgia', lineHeight: 1.25, color: '#fff5df',
        WebkitTextStroke: '8px rgba(10,24,30,.85)', paintOrder: 'stroke fill', textShadow: '0 3px 14px rgba(0,0,0,.55)'}}>
        {slice.map((x, i) => (
          <span key={i} style={{marginRight: 12, opacity: t >= x.a ? 1 : 0.0}}>{x.w}</span>
        ))}
      </div>
    </AbsoluteFill>
  );
}
