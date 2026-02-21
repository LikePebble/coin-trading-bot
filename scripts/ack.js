const crypto = require('crypto');
const { sendTelegram } = require('./notify_telegram');

// Simple ETA estimator by action keyword (minutes)
const ETA_MAP = {
  'restart': 1,
  'start': 1,
  'stop': 1,
  'deploy': 5,
  'patch': 5,
  'diagnose': 10,
  'diagnostic': 10,
  'logs': 2,
  'default': 3
};

function etaForText(text){
  if(!text) return ETA_MAP.default;
  const t = text.toLowerCase();
  for(const k of Object.keys(ETA_MAP)){
    if(k==='default') continue;
    if(t.includes(k)) return ETA_MAP[k];
  }
  return ETA_MAP.default;
}

function genRequestId(){ return crypto.randomBytes(6).toString('hex'); }

async function ackRequest(text, opts={}){
  const id = genRequestId();
  const etaMin = etaForText(text);
  const short = (text||'').split('\n')[0].slice(0,120);
  const msg = `요청 접수: id=${id}\n요약: ${short}\n처리: 약 ${etaMin}분 이내 응답 예정`;
  // fire-and-forget enqueue; return meta immediately
  try{ await sendTelegram(msg); }catch(e){ /* notify is non-blocking but keep try */ }
  return { id, etaMin };
}

module.exports = { ackRequest, etaForText, genRequestId };
