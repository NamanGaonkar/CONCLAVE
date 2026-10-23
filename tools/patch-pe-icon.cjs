'use strict';
const fs = require('fs');
const path = require('path');
const resedit = require('resedit');

const ROOT = path.resolve(__dirname, '..');
const icoPath = path.join(ROOT, 'build', 'icon.ico');
const icoData = fs.readFileSync(icoPath);
const iconFile = resedit.Data.IconFile.from(icoData);
const icons = iconFile.icons.map(item => item.data);

function patchExe(targetPath) {
  if (!fs.existsSync(targetPath)) {
    console.log(`Target not found: ${targetPath}`);
    return;
  }
  console.log(`Patching icon for: ${targetPath}`);
  const exeData = fs.readFileSync(targetPath);
  const exe = resedit.NtExecutable.from(exeData);
  const res = resedit.NtExecutableResource.from(exe);

  resedit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 0, icons);
  res.outputResource(exe);
  const newBuf = Buffer.from(exe.generate());
  fs.writeFileSync(targetPath, newBuf);
  console.log(`Successfully patched icon in: ${targetPath} (${newBuf.length} bytes)`);
}

// 1. Patch unpacked dist
patchExe(path.join(ROOT, 'dist', 'win-unpacked', 'Conclave.exe'));

// 2. Patch installed exe if present
const localApp = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Local');
patchExe(path.join(localApp, 'Programs', 'Conclave', 'Conclave.exe'));
