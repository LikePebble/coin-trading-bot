const fs = require('fs');
const path = require('path');
const OUT = path.resolve(__dirname, '..', '..', 'runtime', 'audit.log');
function stamp() { return new Date().toISOString(); }
function redact(obj) { try { const s = JSON.stringify(obj); return s.replace(/(\b[0-9A-Za-z]{8,}\b)/g, '****'); } catch(e){return 'redact_failed'} }
function audit(type, payload) {
  const line = JSON.stringify({ ts: stamp(), type, payload });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.appendFileSync(OUT, line + '\n');
  console.log('[AUDIT]', type, payload && payload.reason ? payload.reason : 'ok');
}
module.exports = { audit, OUT };
