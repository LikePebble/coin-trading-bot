module.exports = {
  SYMBOL: 'BTC_KRW',
  TIMEFRAMES: { signal: '5m', regime: '1h' },
  LOOP_MS: 60 * 1000,
  RISK: {
    RISK_PER_TRADE_PCT: 0.0025, // 0.25%
    MAX_EXPOSURE_PCT: 0.1, // 10%
    MAX_CONCURRENT_POSITIONS: 1,
    MAX_DAILY_LOSS_PCT: 0.015 // 1.5%
  },
  SAFETY: {
    DEFAULT_DRY_RUN: true,
    REQUIRED_LIVE_VARS: ['EXECUTE_ORDER','LIVE_APPROVAL_TOKEN'],
    KILL_SWITCH_FILE: './runtime/KILL_SWITCH'
  }
};
