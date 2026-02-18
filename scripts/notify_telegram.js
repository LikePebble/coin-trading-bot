require('dotenv').config();
const axios = require('axios');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN || !CHAT_ID) {
  // do not throw; allow scripts to run without telegram configured
  console.warn('Telegram not fully configured: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env to enable notifications.');
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
