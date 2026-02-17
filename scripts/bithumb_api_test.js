   require('dotenv').config();                                                                                         
   const axios = require('axios');                                                                                     
                                                                                                                       
   const API_KEY = process.env.BITHUMB_API_KEY;                                                                        
   const API_SECRET = process.env.BITHUMB_API_SECRET;                                                                  
                                                                                                                       
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
     if (!API_KEY || !API_SECRET) {                                                                                    
       console.error('❌ API KEY/SECRET 환경변수(.env) 미설정!');                                                      
       process.exit(1);                                                                                                
     }                                                                                                                 
     // 실제 거래 관련 함수는 주석 또는 차단                                                                           
     await fetchTicker('BTC_KRW'); // 예: 비트코인 시세 조회                                                           
   }                                                                                                                   
                                                                                                                       
   main();                
