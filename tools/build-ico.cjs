'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEMP = path.join(__dirname, 'temp_icons');

function buildIco(pngs) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0); // reserved
  dir.writeUInt16LE(1, 2); // 1 = ICO
  dir.writeUInt16LE(pngs.length, 4); // count

  let offset = 6 + pngs.length * 16;
  const entries = [], bodies = [];

  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; // width
    e[1] = size >= 256 ? 0 : size; // height
    e[2] = 0; // color palette
    e[3] = 0; // reserved
    e.writeUInt16LE(1, 4);  // color planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8); // image size
    e.writeUInt32LE(offset, 12);     // offset
    entries.push(e);
    bodies.push(data);
    offset += data.length;
  }

  return Buffer.concat([dir, ...entries, ...bodies]);
}

const icoSizes = [16, 32, 48, 64, 128, 256];
const icoPngs = icoSizes.map(s => ({
  size: s,
  data: fs.readFileSync(path.join(TEMP, `icon_${s}.png`))
}));

const ico = buildIco(icoPngs);
fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), ico);
fs.writeFileSync(path.join(ROOT, 'docs', 'favicon.ico'), ico);
console.log('Successfully generated build/icon.ico and docs/favicon.ico (' + ico.length + ' bytes)');
