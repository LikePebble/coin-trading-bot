const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const nt = require('./notify_telegram');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const STRAT_LOG = path.join(LOG_DIR, 'strategy_engine.log');
const BOOT_LOG = path.join(LOG_DIR, 'bootcheckworker_stdout.log');

const keywords = [
  'Buy failed', '주문가능한 금액', 'Insufficient', 'Buy failed:', 'Sell failed', 'Request failed', 'error', 'exception', 'EXIT', 'Stop-loss triggered', '매도 중지', 'cancel', '취소', 'LastExitStatus'
];

function watchFile(file){
  if(!fs.existsSync(file)) return;
  let stream = fs.createReadStream(file, {encoding:'utf8', start: fs.statSync(file).size});
  stream.on('data', chunk=>{
    processChunk(chunk, file);
  });
  fs.watchFile(file, {interval:1000}, (curr, prev)=>{
    if(curr.size > prev.size){
      const rs = fs.createReadStream(file, {start: prev.size, end: curr.size});
      rs.on('data', chunk=> processChunk(chunk, file));
    }
  });
}

function processChunk(chunk, file){
  const lines = chunk.split(/\n/).filter(Boolean);
  for(const l of lines){
    for(const k of keywords){
      if(l.includes(k)){
        const msg = `ALERT (${path.basename(file)}): ${l}`;
        try{ nt.sendTelegram(msg); }catch(e){ console.error('notify enqueue failed', e.message); }
        break;
      }
    }
  }
}

// start watchers
watchFile(STRAT_LOG);
watchFile(BOOT_LOG);

// No periodic heartbeat — only alert on abnormal events (errors, failures, keywords)
console.log('live_monitor started (alerts only for abnormal events)');
