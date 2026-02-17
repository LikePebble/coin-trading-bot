const fs = require('fs');
const path = require('path');

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}
function nowIso() { return (new Date()).toISOString(); }
function saveJson(fn, obj) { fs.writeFileSync(fn, JSON.stringify(obj, null, 2), 'utf8'); }
module.exports = { ensureDir, nowIso, saveJson };
