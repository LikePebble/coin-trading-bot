require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Prefer OpenClaw gateway config token if available, otherwise fall back to .env
function loadOpenClawTelegramConfig() {
  try {
    const cfgPath = path.join(process.env.HOME || '/', '.openclaw', 'openclaw.json');
    if (!fs.existsSync(cfgPath)) return {};
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const cfg = JSON.parse(raw);
    const tg = (cfg.channels && cfg.channels.telegram) || {};
    // botToken may be redacted in config; only return if looks like a real token
    const botToken = tg.botToken && typeof tg.botToken === 'string' && !tg.botToken.includes('__OPENCLAW_REDACTED__') ? tg.botToken : null;
    const chatList = tg.allowFrom || [];
    const chatId = process.env.TELEGRAM_CHAT_ID || (chatList.length ? String(chatList[0]) : null);
    return { botToken, chatId };
  } catch (e) {
    return {};
  }
}

const openclawCfg = loadOpenClawTelegramConfig();
const BOT_TOKEN = openclawCfg.botToken || process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = openclawCfg.chatId || process.env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN || !CHAT_ID) {
  // do not throw; allow scripts to run without telegram configured
  console.warn('Telegram not fully configured: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env or configure OpenClaw channels.telegram to enable notifications.');
}

function safeTruncate(s, n=1500){
  if(s.length<=n) return s;
  return s.slice(0,n-200)+"\n... (truncated) ...\n"+s.slice(-200);
}

function fmtNum(n){
  if(typeof n==='number') return n.toLocaleString();
  const v = Number(n);
  if(Number.isFinite(v)) return v.toLocaleString();
  return String(n);
}

function formatOrderAttempt(msg){
  // msg starts with 'Order attempted:' followed by JSON
  const jsonPart = msg.replace(/^Order attempted:\n?/,'');
  try{
    const obj = JSON.parse(jsonPart);
    const r = obj.res || {};
    const lines = [];
    lines.push(`Order ${r.orderId || ''}: ${obj.side.toUpperCase()} ${fmtNum(obj.quantity)} @ ₩${fmtNum(obj.price)}`);
    lines.push(`Amount (KRW): ₩${fmtNum(obj.amountKRW)} | Budget impact: ₩${fmtNum(obj.budgetImpact)}`);
    lines.push(`Result: ${r.ok? 'OK': 'FAIL'} ${r.dry? '(DRY-RUN)':''}`);
    lines.push(`Time: ${obj.ts}`);
    return lines.join('\n');
  }catch(e){
    return safeTruncate(msg);
  }
}

function formatPerformance(msg){
  // parse messages like: Performance check: estKrw=12345, pct=1.23%
  try{
    const m = msg.match(/estKrw=(\d+),?\s*pct=([\-\d\.]+)/i);
    if(m){
      const est = Number(m[1]);
      const pct = Number(m[2]);
      return `Performance check:\nEstimated balance: ₩${est.toLocaleString()}\nDaily P&L: ${pct.toFixed(2)}%`;
    }
  }catch(e){}
  return msg;
}

async function sendTelegram(text) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  let out = text;
  try{
    if(typeof text === 'string' && text.startsWith('Order attempted:')){
      out = formatOrderAttempt(text);
    } else if(typeof text === 'string' && text.startsWith('Performance check:')){
      out = formatPerformance(text);
    } else if(typeof text !== 'string'){
      out = JSON.stringify(text, null, 2);
    }
    out = safeTruncate(out, 1800);
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    await axios.post(url, { chat_id: CHAT_ID, text: out });
  }catch (err) {
    console.error('Telegram send error', err.message);
  }
}

module.exports = { sendTelegram };
