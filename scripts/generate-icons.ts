#!/usr/bin/env tsx
/**
 * Generate deterministic placeholder-free PWA icons from code.
 *
 * No external image dependency is required: this writes simple PNGs with the
 * Dynasty monogram. The UI/PWA phase can replace the artwork, but the package
 * script is real and produces valid assets today.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const name = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([len, name, data, crc]);
}

function png(size: number): Buffer {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const bg = [12, 18, 32, 255];
  const gold = [244, 196, 48, 255];
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const border = x < size * 0.08 || y < size * 0.08 || x > size * 0.92 || y > size * 0.92;
      const dStem = x > size * 0.24 && x < size * 0.34 && y > size * 0.23 && y < size * 0.77;
      const dBowl = (Math.pow((x - size * 0.46) / (size * 0.23), 2) + Math.pow((y - size * 0.5) / (size * 0.28), 2)) < 1 && x > size * 0.32;
      const yFork = Math.abs(x - y) < size * 0.035 && y > size * 0.24 && y < size * 0.52;
      const yFork2 = Math.abs((size - x) - y) < size * 0.035 && y > size * 0.24 && y < size * 0.52;
      const yStem = x > size * 0.64 && x < size * 0.73 && y > size * 0.5 && y < size * 0.78;
      const col = border || dStem || dBowl || yFork || yFork2 || yStem ? gold : bg;
      raw.set(col, i);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = join(process.cwd(), 'public', 'icons', 'generated');
mkdirSync(out, { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(join(out, `icon-${size}.png`), png(size));
}
console.log(`Generated Dynasty icons in ${out}`);
