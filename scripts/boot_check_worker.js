require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { ackRequest } = require('./ack');
const OPENCLAW_HOME = path.join(__dirname, '..');
const POLL_INTERVAL = parseInt(process.env.BOOTCHECK_POLL_MS || '5000', 10);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const LAST_UPDATE_FILE = path.join(OPENCLAW_HOME, 'logs', 'bootcheck_last_update.txt');

if (!BOT_TOKEN) {
  console.error('no bot token');
  process.exit(1);
}

function saveLastUpdate(id){ try{ fs.writeFileSync(LAST_UPDATE_FILE, String(id)); }catch(e){} }
function loadLastUpdate(){ try{ return parseInt(fs.readFileSync(LAST_UPDATE_FILE,'utf8')||'0',10);}catch(e){return 0;} }

async function getUpdates(offset){
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?timeout=0` + (offset?`&offset=${offset}`:'');
  const r = await axios.get(url,{timeout:5000});
  return r.data.result||[];
}

async function sendMessage(text){
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  await axios.post(url,{chat_id: CHAT_ID, text}, {timeout:5000});
}

async function handle(){
  let last = loadLastUpdate();
  try{
    const updates = await getUpdates(last+1);
    for(const u of updates){
      try{
        saveLastUpdate(u.update_id);
        const msg = u.message && (u.message.text || '');
        if(!msg) continue;
        const from = u.message.from && u.message.from.username;
        // look for '허용' or '시작' in reply
        if(/\b(허용|시작|start|yes)\b/i.test(msg)){
          // ACK before executing
          try{
            await ackRequest(msg);
          }catch(e){}
          // start strategy via launchctl
          try{
            execSync(`launchctl kickstart -k gui/${process.getuid()}/com.openclaw.strategy`);
            await sendMessage('전략 엔진 시작 명령을 실행했습니다. (요청자:'+ (from||'unknown') +')');
          }catch(e){
            await sendMessage('전략 엔진 시작 실패: '+ String(e.message).slice(0,200));
          }
        } else if(/\b(중지|정지|stop|no|아니)\b/i.test(msg)){
          try{
            await ackRequest(msg);
          }catch(e){}
          try{ execSync(`launchctl stop gui/${process.getuid()}/com.openclaw.strategy`); await sendMessage('전략 엔진 중지 명령을 실행했습니다.'); }catch(e){ await sendMessage('전략 엔진 중지 실패: '+String(e.message).slice(0,200)); }
        }
      }catch(e){ console.error('handle update error', e.message); }
    }
  }catch(e){ /* ignore transient */ }
}

(async ()=>{
  while(true){ await handle(); await new Promise(r=>setTimeout(r,POLL_INTERVAL)); }
})();
