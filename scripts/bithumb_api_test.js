require('dotenv').config();
const axios = require('axios');

// 실제 거래/주문 X! 시세 데이터 조회만
async function fetchTicker(symbol = 'BTC_KRW') {
  try {
    const { data } = await axios.get(`https://api.bithumb.com/public/ticker/${symbol}`);
    console.log(`${symbol} 실시간 시세`, data.data);
  } catch (err) {
    console.error('시세 조회 실패:', err.message);
  }
}

async function main() {
  // Public ticker endpoint does not require API key/secret.
  await fetchTicker('BTC_KRW'); // 예: 비트코인 시세 조회
}

main();
