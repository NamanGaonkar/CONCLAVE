'use strict';
const fs = require('fs');
const path = require('path');
const resedit = require('resedit');

exports.default = async function (context) {
  if (context.electronPlatformName !== 'win32') return;

  const ROOT = path.resolve(__dirname, '..');
  const icoPath = path.join(ROOT, 'build', 'icon.ico');
  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);

  if (!fs.existsSync(icoPath) || !fs.existsSync(exePath)) {
    console.warn(`[afterPack] Skipping icon patch, file not found: ico=${fs.existsSync(icoPath)}, exe=${fs.existsSync(exePath)}`);
    return;
  }

  console.log(`[afterPack] Patching PE icon on ${exePath}...`);
  const icoData = fs.readFileSync(icoPath);
  const iconFile = resedit.Data.IconFile.from(icoData);
  const icons = iconFile.icons.map(item => item.data);

  const exeData = fs.readFileSync(exePath);
  const exe = resedit.NtExecutable.from(exeData);
  const res = resedit.NtExecutableResource.from(exe);

  resedit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 0, icons);
  res.outputResource(exe);
  const newBuf = Buffer.from(exe.generate());
  fs.writeFileSync(exePath, newBuf);
  console.log(`[afterPack] Successfully patched icon in ${exePath} (${newBuf.length} bytes)`);
};
