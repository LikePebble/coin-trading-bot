const fs = require('fs');
const path = require('path');
const STORE = path.resolve(__dirname, '..', '..', 'runtime', 'state.json');
function load() { try { if (!fs.existsSync(STORE)) return {}; return JSON.parse(fs.readFileSync(STORE,'utf8')); } catch(e){return {}} }
function save(s) { fs.mkdirSync(path.dirname(STORE), { recursive:true }); fs.writeFileSync(STORE, JSON.stringify(s, null, 2)); }
module.exports = { load, save, STORE };
