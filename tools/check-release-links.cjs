#!/usr/bin/env node
'use strict';

/**
 * Release gate: every download link we advertise must actually resolve.
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const releaseMd = fs.readFileSync(path.join(root, 'RELEASE.md'), 'utf8');

const problems = [];

function compareVersions(a, b) {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

// — 1. every pinned artifact name must carry the current version —
const assetRe = /Conclave-(\d+\.\d+\.\d+)-([^\s`)]+)/g;
const assets = new Set();
for (const m of releaseMd.matchAll(assetRe)) {
  if (m[1] !== version) {
    problems.push(`RELEASE.md advertises Conclave-${m[1]}-${m[2]} but package.json says ${version}`);
  }
  assets.add(`Conclave-${m[1]}-${m[2]}`);
}
if (assets.size === 0) problems.push('RELEASE.md advertises no download assets at all — did the table move?');

// — 2. the website's direct download version —
const indexHtml = path.join(root, 'docs/index.html');
if (fs.existsSync(indexHtml)) {
  const html = fs.readFileSync(indexHtml, 'utf8');
  const m = /var REL = '(\d+\.\d+\.\d+)'/.exec(html);
  if (m && compareVersions(m[1], version) < 0) {
    problems.push(`docs/index.html download fallback is ${m[1]}, older than package.json ${version}`);
  }
}

// — 3. llms.txt —
const llmsTxt = path.join(root, 'docs/llms.txt');
if (fs.existsSync(llmsTxt)) {
  const text = fs.readFileSync(llmsTxt, 'utf8');
  const m = /Current version: (\d+\.\d+\.\d+)/.exec(text);
  if (m && m[1] !== version) {
    problems.push(`docs/llms.txt says current version ${m[1]}, package.json says ${version}`);
  }
}

if (problems.length > 0) {
  console.error(`✗ release links are wrong (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`✓ release links verified against v${version} (${assets.size} assets)`);
