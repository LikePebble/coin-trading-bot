// Example moving-average crossover strategy (pseudo)

function ma(values, window) {
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    out.push(slice.reduce((a,b)=>a+b,0)/slice.length);
  }
  return out;
}

function generateSignals(prices, short=5, long=20) {
  const shortMA = ma(prices, short);
  const longMA = ma(prices, long);
  const signals = [];
  for (let i = 1; i < prices.length; i++) {
    if (shortMA[i] > longMA[i] && shortMA[i-1] <= longMA[i-1]) signals.push({i, signal: 'buy'});
    if (shortMA[i] < longMA[i] && shortMA[i-1] >= longMA[i-1]) signals.push({i, signal: 'sell'});
  }
  return signals;
}

module.exports = { generateSignals };
