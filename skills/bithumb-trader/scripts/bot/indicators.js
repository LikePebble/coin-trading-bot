const technical = require('technicalindicators');

function ema(values, period) {
  return technical.EMA.calculate({ period, values });
}
function rsi(values, period) {
  return technical.RSI.calculate({ period, values });
}
function atr(high, low, close, period) {
  return technical.ATR.calculate({ high, low, close, period });
}

module.exports = { ema, rsi, atr };
