const fs = require('fs');
const path = require('path');
function isKilled(cfg) {
  try { return fs.existsSync(path.resolve(cfg.SAFETY.KILL_SWITCH_FILE)); } catch(e){return false}
}
module.exports = { isKilled };
