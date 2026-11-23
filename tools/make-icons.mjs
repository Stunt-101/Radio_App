// Draws the site icon (yellow play button on dark) as PNGs, no image libraries needed.
// Usage: node tools/make-icons.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';

function png(size) {
  const S = 3, bg = [11, 13, 16], fg = [255, 210, 63];
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const inTri = (x, y) => { // play triangle centered, pointing right
    const ax = 0.40, ay = 0.30, bx = 0.40, by = 0.70, cx = 0.72, cy = 0.50;
    const d = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
    const d1 = d(x, y, ax, ay, bx, by), d2 = d(x, y, bx, by, cx, cy), d3 = d(x, y, cx, cy, ax, ay);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let cov = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const u = (x + (sx + .5) / S) / size, v = (y + (sy + .5) / S) / size;
        const r = Math.hypot(u - .5, v - .5);
        if (r < 0.40 && !inTri(u, v)) cov++;
      }
      const t = cov / (S * S), o = y * (size * 4 + 1) + 1 + x * 4;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(bg[c] + (fg[c] - bg[c]) * t);
      raw[o + 3] = 255;
    }
  }
  const crc = buf => { let c, k, t = -1; for (const b of buf) { c = (t ^ b) & 0xff; for (k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t = (t >>> 8) ^ c; } return (t ^ -1) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
fs.writeFileSync('icon-512.png', png(512));
fs.writeFileSync('icon-180.png', png(180));
console.log('wrote icon-512.png, icon-180.png');
