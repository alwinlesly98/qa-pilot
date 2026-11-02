import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { DATA_DIR } from "../config";

const SAMPLES_DIR = path.join(DATA_DIR, "samples");
const COLORS: [number, number, number][] = [[79, 70, 229], [16, 163, 127], [234, 88, 12], [219, 39, 119], [37, 99, 235], [202, 138, 4]];

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/** A 640x480 striped PNG - a stand-in "photo of the item" for upload tests. */
function makePng([r, g, b]: [number, number, number], width = 640, height = 480) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const shade = ((x >> 5) + (y >> 5)) % 2 ? 1 : 0.8;
      raw[row + 1 + x * 3] = r * shade;
      raw[row + 2 + x * 3] = g * shade;
      raw[row + 3 + x * 3] = b * shade;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Paths to `count` sample item photos (1-6), generated once. */
export function samplePhotos(count: number): string[] {
  fs.mkdirSync(SAMPLES_DIR, { recursive: true });
  const n = Math.max(1, Math.min(6, Math.floor(count) || 1));
  return Array.from({ length: n }, (_, i) => {
    const file = path.join(SAMPLES_DIR, `item-photo-${i + 1}.png`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, makePng(COLORS[i % COLORS.length]));
    return file;
  });
}
