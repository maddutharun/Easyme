const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'node_modules');
const source = path.join(__dirname, '..', 'vendor', 'debug');

function visit(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'debug') {
        fs.copyFileSync(path.join(source, 'package.json'), path.join(target, 'package.json'));
        fs.copyFileSync(path.join(source, 'index.js'), path.join(target, 'index.js'));
      } else {
        visit(target);
      }
    }
  }
}

visit(root);
