// Renders assets/icon.png (gradient squircle + sparkle) without any image libraries.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const N = 512, SS = 3;
const stops = [[0, [94, 92, 230]], [0.4, [175, 82, 222]], [0.75, [255, 94, 138]], [1, [255, 159, 10]]];
function grad(t) {
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
      const k = (t - t0) / (t1 - t0);
      return c0.map((v, j) => v + (c1[j] - v) * k);
    }
  }
  return stops.at(-1)[1];
}
const inSquircle = (x, y) => Math.abs(x) ** 5 + Math.abs(y) ** 5 <= 1;
const inStar = (x, y, r) => Math.sqrt(Math.abs(x) / r) + Math.sqrt(Math.abs(y) / r) <= 1;

const px = Buffer.alloc(N * (N * 4 + 1));
for (let y = 0; y < N; y++) {
  px[y * (N * 4 + 1)] = 0;
  for (let x = 0; x < N; x++) {
    let a = 0, w = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const u = ((x + (sx + 0.5) / SS) / N) * 2 - 1, v = ((y + (sy + 0.5) / SS) / N) * 2 - 1;
      if (inSquircle(u / 0.9, v / 0.9)) {
        a++;
        if (inStar(u + 0.1, v + 0.08, 0.56) || inStar(u - 0.36, v - 0.38, 0.2)) w++;
      }
    }
    const cov = a / (SS * SS), wcov = w / (SS * SS);
    const t = (x + y) / (2 * N);
    const c = grad(t).map((v) => v * (1 - wcov / Math.max(cov, 1e-6)) + 255 * (wcov / Math.max(cov, 1e-6)));
    const o = y * (N * 4 + 1) + 1 + x * 4;
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = Math.round(cov * 255);
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(px)), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync(path.join(__dirname, '..', 'assets', 'icon.png'), png);
console.log('wrote assets/icon.png');
