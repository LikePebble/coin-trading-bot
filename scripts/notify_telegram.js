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

async function sendTelegram(text) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    await axios.post(url, { chat_id: CHAT_ID, text });
  } catch (err) {
    console.error('Telegram send error', err.message);
  }
}

module.exports = { sendTelegram };
