const nt = require('./notify_telegram');
(async ()=>{
  console.log('enqueue 1', await nt.sendTelegram('TEST DUP', { dedupeKey: 'testdup' }));
  console.log('enqueue 2', await nt.sendTelegram('TEST DUP', { dedupeKey: 'testdup' }));
  console.log('enqueue 3', await nt.sendTelegram('TEST DUP', {}));
  setTimeout(async ()=>{
    console.log('queue stats', nt.getTelegramQueueStats());
    process.exit(0);
  }, 1000);
})();
