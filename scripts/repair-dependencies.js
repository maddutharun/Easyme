const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'node_modules');
const source = path.join(__dirname, '..', 'vendor', 'debug');

function copyDebug(target) {
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(path.join(source, 'package.json'), path.join(target, 'package.json'));
  fs.copyFileSync(path.join(source, 'index.js'), path.join(target, 'index.js'));
}

function visit(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const resolved = path.resolve(directory, fs.readlinkSync(target));
      if (entry.name === 'debug' || resolved.endsWith(`${path.sep}vendor${path.sep}debug`) || resolved.endsWith('/vendor/debug')) {
        copyDebug(resolved);
      }
      continue;
    }
    if (entry.isDirectory()) {
      if (entry.name === 'debug') {
        copyDebug(target);
      } else {
        visit(target);
      }
    }
  }
}

visit(root);
