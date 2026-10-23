'use strict';
/**
 * Conclave brand logo generator.
 * Produces crisp SVG vector assets and multi-resolution PNG/ICO raster icons.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');

// ── SVG Design ─────────────────────────────────────────────────────────────
function makeSvg(size = 1024) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0B0D17"/>
      <stop offset="50%" stop-color="#121626"/>
      <stop offset="100%" stop-color="#07090F"/>
    </linearGradient>
    <linearGradient id="strokeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38BDF8" stop-opacity="0.8"/>
      <stop offset="50%" stop-color="#818CF8" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#C084FC" stop-opacity="0.2"/>
    </linearGradient>
    <linearGradient id="coreGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00F2FE"/>
      <stop offset="40%" stop-color="#38BDF8"/>
      <stop offset="80%" stop-color="#6366F1"/>
      <stop offset="100%" stop-color="#A855F7"/>
    </linearGradient>
    <linearGradient id="accentGrad" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#38BDF8"/>
      <stop offset="100%" stop-color="#F43F5E"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="24" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
    <filter id="softGlow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="40" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
    <clipPath id="squircleClip">
      <rect x="32" y="32" width="960" height="960" rx="210" ry="210" />
    </clipPath>
  </defs>

  <!-- Background tile -->
  <g clip-path="url(#squircleClip)">
    <rect x="32" y="32" width="960" height="960" fill="url(#bgGrad)" />
    
    <!-- Outer squircle border -->
    <rect x="32" y="32" width="960" height="960" rx="210" ry="210" fill="none" stroke="url(#strokeGrad)" stroke-width="12" />

    <!-- Ambient background glow behind emblem -->
    <circle cx="512" cy="512" r="280" fill="#6366F1" opacity="0.12" filter="url(#softGlow)" />
    <circle cx="512" cy="512" r="160" fill="#00F2FE" opacity="0.15" filter="url(#glow)" />

    <!-- Orbital Conclave Nexus Network -->
    <!-- Hexagonal network linking agent seats -->
    <polygon points="512,232 754,372 754,652 512,792 270,652 270,372"
             fill="none" stroke="#2A3352" stroke-width="6" stroke-dasharray="14 10" opacity="0.8" />
             
    <!-- Inner spoke lines converging to conclave core -->
    <line x1="512" y1="232" x2="512" y2="350" stroke="#38BDF8" stroke-width="5" opacity="0.6"/>
    <line x1="754" y1="372" x2="650" y2="432" stroke="#6366F1" stroke-width="5" opacity="0.6"/>
    <line x1="754" y1="652" x2="650" y2="592" stroke="#818CF8" stroke-width="5" opacity="0.6"/>
    <line x1="512" y1="792" x2="512" y2="674" stroke="#A855F7" stroke-width="5" opacity="0.6"/>
    <line x1="270" y1="652" x2="374" y2="592" stroke="#38BDF8" stroke-width="5" opacity="0.6"/>
    <line x1="270" y1="372" x2="374" y2="432" stroke="#00F2FE" stroke-width="5" opacity="0.6"/>

    <!-- Orbital Agent Node Circles -->
    <circle cx="512" cy="232" r="26" fill="#0F172A" stroke="#38BDF8" stroke-width="8" />
    <circle cx="512" cy="232" r="10" fill="#38BDF8" />

    <circle cx="754" cy="372" r="24" fill="#0F172A" stroke="#6366F1" stroke-width="8" />
    <circle cx="754" cy="372" r="9" fill="#6366F1" />

    <circle cx="754" cy="652" r="24" fill="#0F172A" stroke="#818CF8" stroke-width="8" />
    <circle cx="754" cy="652" r="9" fill="#818CF8" />

    <circle cx="512" cy="792" r="26" fill="#0F172A" stroke="#A855F7" stroke-width="8" />
    <circle cx="512" cy="792" r="10" fill="#A855F7" />

    <circle cx="270" cy="652" r="24" fill="#0F172A" stroke="#38BDF8" stroke-width="8" />
    <circle cx="270" cy="652" r="9" fill="#38BDF8" />

    <circle cx="270" cy="372" r="24" fill="#0F172A" stroke="#00F2FE" stroke-width="8" />
    <circle cx="270" cy="372" r="9" fill="#00F2FE" />

    <!-- Centerpiece: Bold Futuristic Conclave "C" Emblem -->
    <!-- The outer dynamic C arc -->
    <path d="M 640 370 
             C 610 340 565 320 512 320 
             C 406 320 320 406 320 512 
             C 320 618 406 704 512 704 
             C 565 704 610 684 640 654
             L 600 600
             C 578 622 547 636 512 636
             C 443 636 388 581 388 512
             C 388 443 443 388 512 388
             C 547 388 578 402 600 424
             Z"
          fill="url(#coreGrad)" filter="url(#glow)" />

    <!-- Center Radiant Core Prism / Diamond -->
    <polygon points="512,460 556,512 512,564 468,512" fill="#FFFFFF" opacity="0.95" filter="url(#glow)"/>
    <circle cx="512" cy="512" r="8" fill="#00F2FE" />
  </g>
</svg>`;
}

// ── Pure JS PNG Encoder ───────────────────────────────────────────────────
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.concat([t, data]);
  const c = Buffer.alloc(4);
  c.writeInt32BE(crc32(crcBuf), 0);
  return Buffer.concat([len, t, data, c]);
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return ~c;
}

function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ── Analytic Rasterizer for Conclave Mark ──────────────────────────────────
function sdRoundRect(px, py, x, y, w, h, r) {
  const cx = x + w / 2, cy = y + h / 2;
  const qx = Math.abs(px - cx) - (w / 2 - r), qy = Math.abs(py - cy) - (h / 2 - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function rasteriseConclave(N) {
  const out = Buffer.alloc(N * N * 4);
  const scale = N / 1024;
  const SS = 2; // supersampling

  // Palette colours
  const C_BG_TOP = [11, 13, 23];
  const C_BG_BOT = [7, 9, 15];
  const C_BORDER_TOP = [56, 189, 248];
  const C_BORDER_BOT = [192, 132, 252];
  const C_CYAN = [0, 242, 254];
  const C_BLUE = [56, 189, 248];
  const C_PURPLE = [168, 85, 247];
  const C_WHITE = [255, 255, 255];
  const C_NODE_DARK = [15, 23, 42];

  // Hexagon node positions in 1024 space
  const nodes = [
    { x: 512, y: 232, r: 26, c: C_BLUE },
    { x: 754, y: 372, r: 24, c: [99, 102, 241] },
    { x: 754, y: 652, r: 24, c: [129, 140, 248] },
    { x: 512, y: 792, r: 26, c: C_PURPLE },
    { x: 270, y: 652, r: 24, c: C_BLUE },
    { x: 270, y: 372, r: 24, c: C_CYAN }
  ];

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let totalA = 0;
      let rSum = 0, gSum = 0, bSum = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (x + (sx + 0.5) / SS) / scale;
          const py = (y + (sy + 0.5) / SS) / scale;

          // Squircle dist
          const dSquircle = sdRoundRect(px, py, 32, 32, 960, 960, 210);
          if (dSquircle > 0) continue; // outside squircle

          totalA += 1;
          const tY = py / 1024;

          // Base background color (gradient from top to bottom)
          let r = C_BG_TOP[0] * (1 - tY) + C_BG_BOT[0] * tY;
          let g = C_BG_TOP[1] * (1 - tY) + C_BG_BOT[1] * tY;
          let b = C_BG_TOP[2] * (1 - tY) + C_BG_BOT[2] * tY;

          // Squircle border
          if (dSquircle > -12) {
            const bCol = [
              C_BORDER_TOP[0] * (1 - tY) + C_BORDER_BOT[0] * tY,
              C_BORDER_TOP[1] * (1 - tY) + C_BORDER_BOT[1] * tY,
              C_BORDER_TOP[2] * (1 - tY) + C_BORDER_BOT[2] * tY
            ];
            const blend = (dSquircle + 12) / 12;
            r = r * (1 - blend) + bCol[0] * blend;
            g = g * (1 - blend) + bCol[1] * blend;
            b = b * (1 - blend) + bCol[2] * blend;
          }

          // Central glow
          const distCenter = Math.hypot(px - 512, py - 512);
          if (distCenter < 280) {
            const glowAmt = (1 - distCenter / 280) * 0.25;
            r += 99 * glowAmt;
            g += 102 * glowAmt;
            b += 241 * glowAmt;
          }

          // C arc: Outer radius ~192, inner radius ~124
          if (distCenter >= 120 && distCenter <= 194) {
            // Angle around center: 0 = right, pi/2 = bottom, pi = left, -pi/2 = top
            const angle = Math.atan2(py - 512, px - 512);
            // Open on the right between -35 deg and +35 deg
            const inOpening = angle > -0.65 && angle < 0.65;
            if (!inOpening) {
              const tGrad = (angle + Math.PI) / (2 * Math.PI);
              const cCol = [
                C_CYAN[0] * (1 - tGrad) + C_PURPLE[0] * tGrad,
                C_CYAN[1] * (1 - tGrad) + C_PURPLE[1] * tGrad,
                C_CYAN[2] * (1 - tGrad) + C_PURPLE[2] * tGrad
              ];
              r = r * 0.2 + cCol[0] * 0.8;
              g = g * 0.2 + cCol[1] * 0.8;
              b = b * 0.2 + cCol[2] * 0.8;
            }
          }

          // Center diamond
          const dDiamond = Math.abs(px - 512) + Math.abs(py - 512);
          if (dDiamond < 54) {
            r = 255; g = 255; b = 255;
          } else if (dDiamond < 70) {
            r = 0; g = 242; b = 254;
          }

          // Outer nodes
          for (const node of nodes) {
            const dNode = Math.hypot(px - node.x, py - node.y);
            if (dNode < node.r) {
              if (dNode < 10) {
                r = node.c[0]; g = node.c[1]; b = node.c[2];
              } else if (dNode < node.r - 6) {
                r = C_NODE_DARK[0]; g = C_NODE_DARK[1]; b = C_NODE_DARK[2];
              } else {
                r = node.c[0]; g = node.c[1]; b = node.c[2];
              }
            }
          }

          rSum += r; gSum += g; bSum += b;
        }
      }

      const cov = totalA / (SS * SS);
      if (cov > 0) {
        const i = (y * N + x) * 4;
        out[i] = Math.min(255, Math.round(rSum / (SS * SS)));
        out[i + 1] = Math.min(255, Math.round(gSum / (SS * SS)));
        out[i + 2] = Math.min(255, Math.round(bSum / (SS * SS)));
        out[i + 3] = Math.round(cov * 255);
      }
    }
  }

  return encodePng(N, N, out);
}

// ── ICO Builder ───────────────────────────────────────────────────────────
function buildIco(pngs) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(pngs.length, 4);
  let offset = 6 + pngs.length * 16;
  const entries = [], bodies = [];
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0; e[3] = 0;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
    entries.push(e); bodies.push(data);
    offset += data.length;
  }
  return Buffer.concat([dir, ...entries, ...bodies]);
}

// ── Main Execution ────────────────────────────────────────────────────────
console.log('Generating Conclave vector and raster logos...');

// 1. Vector SVG
const svg = makeSvg(1024);
fs.writeFileSync(path.join(ROOT, 'build/icon.svg'), svg, 'utf8');
fs.writeFileSync(path.join(ROOT, 'docs/logo.svg'), svg, 'utf8');
console.log('✓ Written build/icon.svg & docs/logo.svg');

// 2. Raster PNGs
const sizes = [16, 32, 48, 64, 128, 180, 256, 512, 1024];
const rasterMap = {};

for (const s of sizes) {
  console.log(`Rasterizing size ${s}x${s}...`);
  rasterMap[s] = rasteriseConclave(s);
}

// Write target PNGs
fs.writeFileSync(path.join(ROOT, 'build/icon.png'), rasterMap[1024]);
fs.writeFileSync(path.join(ROOT, 'docs/logo.png'), rasterMap[512]);
fs.writeFileSync(path.join(ROOT, 'docs/logo-light.png'), rasterMap[512]);
fs.writeFileSync(path.join(ROOT, 'docs/favicon-32.png'), rasterMap[32]);
fs.writeFileSync(path.join(ROOT, 'docs/apple-touch-icon.png'), rasterMap[180]);
console.log('✓ Written target PNG files in build/ and docs/');

// 3. Multi-resolution Windows ICO
const icoPngs = [16, 32, 48, 64, 128, 256].map(s => ({ size: s, data: rasterMap[s] }));
const ico = buildIco(icoPngs);
fs.writeFileSync(path.join(ROOT, 'build/icon.ico'), ico);
console.log('✓ Written build/icon.ico');

console.log('Done generating Conclave brand mark!');
