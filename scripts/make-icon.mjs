// Generates src-tauri/icons/source.png (512x512) from the pet sprite,
// with a tiny dependency-free PNG encoder. Then `tauri icon` makes the rest.
import fs from "node:fs";
import zlib from "node:zlib";

const half = [
  "........",
  "........",
  "...d....",
  "...o....",
  "..oooooo",
  ".ooooooo",
  ".oookooo",
  ".oookooo",
  ".opooooo",
  ".ooooooo",
  "..oooooo",
  "..o..o..",
  "..o..o..",
  "........",
  "........",
  "........",
];
const rows = half.map((r) => r + [...r].reverse().join(""));
const pal = {
  o: [217, 119, 87, 255],
  d: [150, 70, 48, 255],
  k: [26, 26, 26, 255],
  p: [240, 150, 140, 255],
};

const SIZE = 512;
const cell = SIZE / 16;
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    const ch = rows[Math.floor(y / cell)][Math.floor(x / cell)];
    const c = pal[ch] ?? [0, 0, 0, 0];
    raw.set(c, y * (SIZE * 4 + 1) + 1 + x * 4);
  }
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);
fs.mkdirSync("src-tauri/icons", { recursive: true });
fs.writeFileSync("src-tauri/icons/source.png", png);
console.log("wrote src-tauri/icons/source.png");
