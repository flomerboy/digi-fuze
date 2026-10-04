// Builds src/assets/vgr-pixel.ttf from the console's own 5x7 bitmap font (src/runtime/font.js), so the web UI
// uses exactly the same letters as the TV and the cartridges. Every lit pixel becomes a square in the outline.
// Run after changing the font: npm run font
import { writeFileSync, mkdirSync } from 'node:fs';
import opentype from 'opentype.js';
import { FONT_CHARS, glyph, ADVANCE } from '../src/runtime/font.js';

const PX = 100;                  // font units per pixel
const ASC = 7 * PX, DESC = 1 * PX; // 7 rows above the baseline, 1 below: line height = 8 px

// A few extra symbols the UI uses, in the same 5x7 style (bit 4 = leftmost column).
const EXTRA = {
  '…': [0, 0, 0, 0, 0, 0, 21],          // … ellipsis
  '·': [0, 0, 0, 4, 0, 0, 0],           // · middle dot
  '→': [0, 4, 2, 31, 2, 4, 0],          // → arrow
  '←': [0, 4, 8, 31, 8, 4, 0],          // ← arrow
  '×': [0, 17, 10, 4, 10, 17, 0],       // × times
  '★': [4, 4, 31, 14, 14, 27, 17],      // ★ star
  '☆': [4, 4, 27, 17, 10, 21, 17],      // ☆ outline star
  '✓': [0, 1, 1, 2, 20, 8, 0],          // ✓ check
  '–': [0, 0, 0, 14, 0, 0, 0],          // – en dash
  '—': [0, 0, 0, 31, 0, 0, 0],          // — em dash
  '▼': [0, 0, 31, 14, 4, 0, 0],         // ▼ (select arrow)
  '▶': [8, 12, 14, 15, 14, 12, 8],      // ▶
};

function outline(rows) {
  const p = new opentype.Path();
  rows.forEach((bits, r) => {
    for (let c = 0; c < 5; c++) {
      if (!(bits & (16 >> c))) continue;
      const x = c * PX, top = ASC - r * PX, bottom = top - PX;
      // clockwise square (TrueType outer contour)
      p.moveTo(x, bottom); p.lineTo(x, top); p.lineTo(x + PX, top); p.lineTo(x + PX, bottom); p.close();
    }
  });
  return p;
}

const glyphs = [new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: ADVANCE * PX, path: new opentype.Path() })];
const add = (name, unicode, rows) => glyphs.push(new opentype.Glyph({ name, unicode, advanceWidth: ADVANCE * PX, path: outline(rows) }));

for (const ch of FONT_CHARS) {
  add(`u${ch.codePointAt(0).toString(16)}`, ch.codePointAt(0), glyph(ch));
  // the console font is uppercase-only: lowercase letters get the same shapes
  if (/[A-Z]/.test(ch)) add(`u${ch.toLowerCase().codePointAt(0).toString(16)}`, ch.toLowerCase().codePointAt(0), glyph(ch));
}
for (const [ch, rows] of Object.entries(EXTRA)) add(`u${ch.codePointAt(0).toString(16)}`, ch.codePointAt(0), rows);
add('nbsp', 0xa0, [0, 0, 0, 0, 0, 0, 0]);

const font = new opentype.Font({
  familyName: 'VGR Pixel', styleName: 'Regular', unitsPerEm: 8 * PX, ascender: ASC, descender: -DESC, glyphs,
});
mkdirSync(new URL('../src/assets/', import.meta.url), { recursive: true });
writeFileSync(new URL('../src/assets/vgr-pixel.ttf', import.meta.url), Buffer.from(font.toArrayBuffer()));
console.log(`wrote src/assets/vgr-pixel.ttf (${glyphs.length} glyphs)`);
