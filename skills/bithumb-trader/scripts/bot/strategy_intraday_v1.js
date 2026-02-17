const indicators = require('./indicators');

// Very small reference implementation: consumes arrays of candles and returns signal
// candles: [{time, open, high, low, close, volume}] newest last
function decideSignal(candles5m, candles1h) {
  const closes5 = candles5m.map(c=>c.close);
  const closes1 = candles1h.map(c=>c.close);
  const ema9 = indicators.ema(closes5, 9);
  const ema21 = indicators.ema(closes5, 21);
  const ema50_1h = indicators.ema(closes1, 50).slice(-1)[0];
  const ema200_1h = indicators.ema(closes1, 200).slice(-1)[0];
  const rsi = indicators.rsi(closes5, 14).slice(-1)[0];
  const atr = indicators.atr(candles5m.map(c=>c.high), candles5m.map(c=>c.low), closes5, 14).slice(-1)[0];

  const regimeBull = ema50_1h && ema200_1h && (ema50_1h > ema200_1h);
  const lastIdx = closes5.length -1;
  const entry = closes5[lastIdx];
  const stop = entry - 1.2 * (atr || 1000);
  const take = entry + 1.8 * (atr || 1000);

  const ema9v = ema9.slice(-1)[0];
  const ema21v = ema21.slice(-1)[0];
  const cross = ema9v && ema21v && (ema9v > ema21v);

  const enter = regimeBull && cross && rsi >=45 && rsi <=68;
  return { enter, entry, stop, take, indicators: { rsi, atr, ema9v, ema21v, regimeBull } };
}
module.exports = { decideSignal };
