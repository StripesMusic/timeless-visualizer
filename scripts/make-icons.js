// Draws the plugin's icons, an hourglass, as PNGs. Usage: node scripts/make-icons.js
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const OUT = path.join(__dirname, "..", "plugin", "icons");
const SAMPLES = 4;

function pngFile(size, pixelAt) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelAt(x, y);
      raw.set([r, g, b, a], row + 1 + x * 4);
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const out = Buffer.alloc(4 + body.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(zlib.crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// In a unit square: bars at top and bottom, and two triangles meeting at the waist.
function hourglass(x, y) {
  const left = 0.22, right = 0.78, top = 0.1, bottom = 0.9, bar = 0.08, mid = 0.5, waist = 0.035;
  if (x < left || x > right || y < top || y > bottom) return false;
  if (y < top + bar || y > bottom - bar) return true;
  const t = Math.abs(y - mid) / (bottom - bar - mid);
  const half = waist + (0.5 - 0.08 - waist) * t;
  return Math.abs(x - 0.5) <= half;
}

function coverage(size, px, py, inside) {
  let hits = 0;
  for (let i = 0; i < SAMPLES; i++) {
    for (let j = 0; j < SAMPLES; j++) {
      if (inside((px + (i + 0.5) / SAMPLES) / size, (py + (j + 0.5) / SAMPLES) / size)) hits++;
    }
  }
  return hits / (SAMPLES * SAMPLES);
}

function glyph(size, [r, g, b]) {
  return pngFile(size, (x, y) => [r, g, b, Math.round(255 * coverage(size, x, y, hourglass))]);
}

// White hourglass on a black rounded square, inset so it reads at small sizes.
function badge(size) {
  const radius = 0.18;
  const square = (x, y) => {
    const dx = Math.max(radius - x, x - (1 - radius), 0);
    const dy = Math.max(radius - y, y - (1 - radius), 0);
    return dx * dx + dy * dy <= radius * radius;
  };
  const inset = (x, y) => hourglass((x - 0.14) / 0.72, (y - 0.14) / 0.72);
  return pngFile(size, (x, y) => {
    const a = coverage(size, x, y, square);
    const w = Math.round(255 * coverage(size, x, y, inset));
    return [w, w, w, Math.round(255 * a)];
  });
}

function makeIcons(dir = OUT) {
  fs.mkdirSync(dir, { recursive: true });
  for (const scale of [1, 2]) {
    fs.writeFileSync(path.join(dir, `panel-dark@${scale}x.png`), glyph(23 * scale, [224, 224, 224]));
    fs.writeFileSync(path.join(dir, `panel-light@${scale}x.png`), glyph(23 * scale, [60, 60, 60]));
    fs.writeFileSync(path.join(dir, `plugin@${scale}x.png`), badge(48 * scale));
  }
}

if (require.main === module) makeIcons();
module.exports = { makeIcons };
