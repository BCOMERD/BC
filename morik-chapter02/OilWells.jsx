import React from 'react';
import {ease} from './chapter02Timing.mjs';
import wells from './oil-wells.json';

const GOLD = '#f2bd60';
const INK = '#fff5df';

// Derrick icon + soft pulse ring. No filled boxes behind labels.
function Derrick({x, y, p, pulse}) {
  const s = 0.55 + 0.45 * p;
  const ring = 8 + 20 * ((pulse % 1.6) / 1.6);
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} opacity={p}>
      <circle r={ring} fill="none" stroke={GOLD} strokeWidth="2" opacity={1 - (pulse % 1.6) / 1.6} />
      <path d="M-9 8L0-14L9 8M-5 0H5M-7 8H7" fill="none" stroke={GOLD} strokeWidth="3.2" strokeLinejoin="round" strokeLinecap="round" />
      <circle r="3" cy="-14" fill={INK} />
    </g>
  );
}

// Reveal order follows the narration: Kirkuk first (cue), then the rest of the map.
// reveal = seconds (scene time) at which each group starts; tweak to the real speech cues.
export function OilWells({screen, t, cues = {}}) {
  const order = ['kirkuk', 'taqtaq', 'khurmala', 'shaikan', 'rumaila', 'majnoon', 'rmelan', 'omar', 'batman', 'gachsaran', 'ahvaz'];
  const base = cues.kirkuk ?? 0.4;     // "Kirkuk and the oil fields..."
  const mixed = cues.mixed ?? 6.5;     // "...Some oil-producing areas are mixed or disputed."
  return (
    <g>
      {order.map((id, i) => {
        const w = wells.wells.find(x => x.id === id);
        const [x, y] = screen(w.lonlat);
        const at = id === 'kirkuk' ? base : id.match(/taqtaq|khurmala|shaikan/) ? base + 1.2 + i * 0.35 : mixed + (i - 4) * 0.45;
        const p = ease((t - at) / 0.55);
        const left = ['rumaila', 'majnoon', 'ahvaz', 'gachsaran'].includes(id);
        return (
          <g key={id}>
            <Derrick x={x} y={y} p={p} pulse={Math.max(0, t - at)} />
            <text
              x={x + (left ? -20 : 20)} y={y + 6}
              textAnchor={left ? 'end' : 'start'}
              fill={id === 'kirkuk' ? GOLD : INK}
              fontFamily="Arial" fontSize={id === 'kirkuk' ? 34 : 26} letterSpacing="1"
              stroke="#142a31" strokeWidth="6" paintOrder="stroke"
              opacity={p}
            >{w.name}</text>
          </g>
        );
      })}
    </g>
  );
}
