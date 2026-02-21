require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Simple async Telegram queue + background worker
const LOG_DIR = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
const FALLBACK_LOG = path.join(LOG_DIR, 'telegram_fallback.log');

const openclawCfgPath = path.join(process.env.HOME || '/', '.openclaw', 'openclaw.json');
function loadOpenClawTelegramConfig() {
  try {
    if (!fs.existsSync(openclawCfgPath)) return {};
    const raw = fs.readFileSync(openclawCfgPath, 'utf8');
    const cfg = JSON.parse(raw);
    const tg = (cfg.channels && cfg.channels.telegram) || {};
    const botToken = tg.botToken && typeof tg.botToken === 'string' && !tg.botToken.includes('__OPENCLAW_REDACTED__') ? tg.botToken : null;
    const chatList = tg.allowFrom || [];
    const chatId = process.env.TELEGRAM_CHAT_ID || (chatList.length ? String(chatList[0]) : null);
    return { botToken, chatId };
  } catch (e) { return {}; }
}

const openclawCfg = loadOpenClawTelegramConfig();
const BOT_TOKEN = openclawCfg.botToken || process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = openclawCfg.chatId || process.env.TELEGRAM_CHAT_ID;

// Config (env override)
const CFG = {
  MAX_QUEUE: parseInt(process.env.TELEGRAM_MAX_QUEUE || '1000', 10),
  WORK_INTERVAL_MS: parseInt(process.env.TELEGRAM_WORK_INTERVAL_MS || '1000', 10),
  MAX_RETRIES: parseInt(process.env.TELEGRAM_MAX_RETRIES || '3', 10),
  BASE_BACKOFF_MS: parseInt(process.env.TELEGRAM_BASE_BACKOFF_MS || '500', 10),
  MAX_BACKOFF_MS: parseInt(process.env.TELEGRAM_MAX_BACKOFF_MS || '10000', 10),
  CB_FAIL_THRESHOLD: parseInt(process.env.TELEGRAM_CB_FAIL_THRESHOLD || '8', 10),
  CB_OPEN_MS: parseInt(process.env.TELEGRAM_CB_OPEN_MS || '60000', 10),
  BATCH_WINDOW_MS: parseInt(process.env.TELEGRAM_BATCH_WINDOW_MS || '800', 10),
};

const QUEUE_FILE = path.join(LOG_DIR, 'telegram_queue.jsonl');
let queue = [];
let cbFailures = 0;
let circuitOpenUntil = 0;
let workerRunning = false;

function loadQueueFromDisk(){
  try{
    if (!fs.existsSync(QUEUE_FILE)) return;
    const lines = fs.readFileSync(QUEUE_FILE,'utf8').split('\n').filter(Boolean);
    for(const l of lines){
      try{ const it=JSON.parse(l); queue.push(it); }catch(e){}
    }
  }catch(e){ console.error('failed loadQueueFromDisk', e.message); }
}

function persistQueueToDisk(){
  try{
    const out = queue.map(it=>JSON.stringify(it)).join('\n') + (queue.length? '\n':'');
    fs.writeFileSync(QUEUE_FILE, out, 'utf8');
  }catch(e){ console.error('failed persistQueueToDisk', e.message); }
}

function safeWriteFallback(entry) {
  try {
    fs.appendFileSync(FALLBACK_LOG, JSON.stringify(entry) + '\n');
  } catch (e) { console.error('fallback write failed', e.message); }
}

function enqueueTelegram(text, opts = {}) {
  // Drop noisy periodic HEARTBEAT messages unless explicitly forced
  try{
    if(typeof text === 'string' && text.includes('HEARTBEAT') && !opts.force){
      return Promise.resolve({ok:false, reason:'dropped_heartbeat'});
    }
  }catch(e){}
  if (!BOT_TOKEN || !CHAT_ID) return Promise.resolve({ok:false, reason:'no-telegram-config'});
  if (queue.length >= CFG.MAX_QUEUE) {
    const entry = { ts: Date.now(), text, opts, reason: 'queue_full' };
    safeWriteFallback(entry);
    return Promise.resolve({ok:false, reason:'queue_full'});
  }
  const item = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2,8),
    text: String(text),
    opts: opts || {},
    retries: 0,
    nextTry: Date.now(),
    createdAt: Date.now(),
  };
  queue.push(item);
  persistQueueToDisk();
  return Promise.resolve({ok:true, enqueued:true, id: item.id});
}

async function doSend(item) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const payload = { chat_id: CHAT_ID, text: item.text };
  try {
    const resp = await axios.post(url, payload, { timeout: parseInt(process.env.TELEGRAM_SEND_TIMEOUT_MS||'5000',10) });
    return {ok:true, data: resp.data};
  } catch (e) {
    const err = e.response?.data || e.message || String(e);
    return {ok:false, error: err};
  }
}

function backoffMs(retries) {
  const ms = Math.min(CFG.BASE_BACKOFF_MS * Math.pow(2, retries), CFG.MAX_BACKOFF_MS);
  return ms + Math.floor(Math.random()*100);
}

async function workerLoop() {
  if (workerRunning) return; workerRunning = true;
  while (true) {
    try {
      const now = Date.now();
      if (circuitOpenUntil > now) { await sleep(CFG.WORK_INTERVAL_MS); continue; }
      // take next eligible item
      const idx = queue.findIndex(it => it.nextTry <= now);
      if (idx === -1) { await sleep(CFG.WORK_INTERVAL_MS); continue; }
      const item = queue.splice(idx,1)[0];
      const res = await doSend(item);
      if (res.ok) {
        cbFailures = 0; // reset failures
      } else {
        item.retries++;
        if (item.retries > CFG.MAX_RETRIES) {
          safeWriteFallback({ts:Date.now(), item, err:res.error});
        } else {
          item.nextTry = Date.now() + backoffMs(item.retries);
          queue.push(item);
        }
        cbFailures++;
        if (cbFailures >= CFG.CB_FAIL_THRESHOLD) {
          circuitOpenUntil = Date.now() + CFG.CB_OPEN_MS;
          safeWriteFallback({ts:Date.now(), event:'circuit_open', until:circuitOpenUntil});
        }
      }
    } catch (e) {
      safeWriteFallback({ts:Date.now(), err: e.message || String(e)});
    }
  }
}

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

function getTelegramQueueStats(){
  return {queueLen: queue.length, cbFailures, circuitOpenUntil};
}

async function flushTelegramQueue(timeoutMs=5000){
  const deadline = Date.now() + timeoutMs;
  while (queue.length>0 && Date.now()<deadline) {
    await sleep(200);
  }
  return queue.length===0;
}

// Start worker (detached)
loadQueueFromDisk();
workerLoop().catch(e=>console.error('workerLoop crashed', e));

// Exported API
module.exports = {
  sendTelegram: (text, opts) => enqueueTelegram(text, opts),
  sendTelegramSync: async (text, opts) => { // best-effort synchronous send
    if (!BOT_TOKEN || !CHAT_ID) return {ok:false, reason:'no-telegram-config'};
    try {
      const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
      const resp = await axios.post(url, { chat_id: CHAT_ID, text }, { timeout: 5000 });
      return {ok:true, data: resp.data};
    } catch (e) {
      safeWriteFallback({ts:Date.now(), syncSendFailed: e.response?.data || e.message});
      return {ok:false, err: e.response?.data || e.message};
    }
  },
  getTelegramQueueStats,
  flushTelegramQueue,
};
