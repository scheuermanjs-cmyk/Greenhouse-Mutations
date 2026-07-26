// Copies the root web app files into www/, which is what Capacitor bundles
// into the native Android app. Run this (via `npm run sync`) any time
// index.html / sw.js / manifest.json / assets change, before building.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const wwwDir = path.join(root, 'www');

fs.mkdirSync(wwwDir, { recursive: true });

for (const f of ['index.html', 'sw.js', 'manifest.json']) {
  fs.copyFileSync(path.join(root, f), path.join(wwwDir, f));
}

fs.cpSync(path.join(root, 'assets'), path.join(wwwDir, 'assets'), { recursive: true });

console.log('Synced web assets into www/');
