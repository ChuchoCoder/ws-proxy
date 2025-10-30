/**
 * Direct Connection Test (No Proxy)
 * 
 * This test connects directly to the broker WebSocket to verify:
 * 1. We can authenticate and get a valid token
 * 2. We can connect directly with X-Auth-Token header
 * 3. We can receive market data without the proxy
 * 
 * This helps isolate whether issues are with the proxy or the broker/subscription.
 */

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const https = require('https');

// Configuration
const CREDENTIALS_FILE = path.join(__dirname, 'broker-credentials.json');
const TEST_DURATION = 15000; // 15 seconds to wait for market data
const INSTRUMENTS_TO_TEST = [
  { symbol: 'MERV - XMEV - AL30 - CI', marketId: 'ROFX' }
];

console.log('='.repeat(70));
console.log('Direct Broker Connection Test (No Proxy)');
console.log('='.repeat(70));
console.log();

// Step 1: Read credentials
console.log('[STEP 1] Reading broker credentials...');
let credentials;
try {
  const credentialsData = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
  credentials = JSON.parse(credentialsData);
  console.log('[OK] Credentials loaded');
  console.log(`     Base URL: ${credentials.baseUrl}`);
  console.log(`     WebSocket URL: ${credentials.websocketUrl}`);
  console.log();
} catch (error) {
  console.error('[FAIL] Could not read credentials:', error.message);
  process.exit(1);
}

// Step 2: Authenticate
function authenticate() {
  return new Promise((resolve, reject) => {
    console.log('[STEP 2] Authenticating...');
    
    const authUrl = new URL(`${credentials.baseUrl}/auth/getToken`);
    const headers = {
      'X-Username': credentials.user,
      'X-Password': credentials.password
    };
    
    const options = {
      hostname: authUrl.hostname,
      port: authUrl.port || 443,
      path: authUrl.pathname,
      method: 'POST',
      headers
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const token = res.headers['x-auth-token'];
        if (!token) {
          reject(new Error(`No token in response. Status: ${res.statusCode}. Body: ${data}`));
        } else {
          console.log('[OK] Authentication successful');
          console.log(`     Token: ${maskToken(token)}`);
          console.log();
          resolve(token);
        }
      });
    });
    
    req.on('error', reject);
    req.end();
  });
}

function maskToken(token) {
  if (!token || token.length <= 8) return '****';
  return `${token.substring(0, 6)}...${token.substring(token.length - 6)}`;
}

// Step 3: Connect directly to broker WebSocket
function connectDirectly(token) {
  return new Promise((resolve, reject) => {
    console.log('[STEP 3] Connecting directly to broker WebSocket...');
    console.log(`     URL: ${credentials.websocketUrl}`);
    console.log(`     Auth: X-Auth-Token: ${maskToken(token)}`);
    console.log();
    
    const ws = new WebSocket(credentials.websocketUrl, {
      headers: {
        'X-Auth-Token': token
      }
    });
    
    let connectionTimeout = setTimeout(() => {
      console.error('[FAIL] Connection timeout');
      ws.close();
      reject(new Error('Connection timeout'));
    }, 10000);
    
    ws.on('open', () => {
      clearTimeout(connectionTimeout);
      console.log('[OK] Connected to broker');
      console.log();
      resolve(ws);
    });
    
    ws.on('error', (error) => {
      clearTimeout(connectionTimeout);
      console.error('[FAIL] WebSocket error:', error.message);
      reject(error);
    });
  });
}

// Step 4: Subscribe to market data
function subscribeToMarketData(ws) {
  console.log('[STEP 4] Subscribing to market data...');
  console.log(`     Testing ${INSTRUMENTS_TO_TEST.length} instruments`);
  console.log();
  
  // Try all instruments at once
  const subscriptionMessage = {
    type: "smd",
    level: 1,
    depth: 1,
    entries: ["BI", "OF", "LA"],
    products: INSTRUMENTS_TO_TEST
  };
  
  const messageStr = JSON.stringify(subscriptionMessage);
  console.log('[SUBSCRIPTION] Sending:', messageStr);
  console.log();
  
  ws.send(messageStr);
  console.log('[OK] Subscription sent');
  console.log();
}

// Step 5: Listen for messages
function listenForMessages(ws) {
  return new Promise((resolve) => {
    console.log('[STEP 5] Listening for messages...');
    console.log(`     Waiting ${TEST_DURATION / 1000} seconds`);
    console.log();
    
    let messageCount = 0;
    let marketDataCount = 0;
    let errorCount = 0;
    const receivedMessageTypes = new Set();
    
    ws.on('message', (data) => {
      messageCount++;
      
      try {
        const message = JSON.parse(data.toString());
        const msgType = message.type || (message.status === 'ERROR' ? 'ERROR' : 'UNKNOWN');
        receivedMessageTypes.add(msgType);
        
        console.log(`[MESSAGE ${messageCount}] Type: ${msgType}`);
        console.log(JSON.stringify(message, null, 2));
        console.log();
        
        if (msgType === 'MD') {
          marketDataCount++;
          console.log(`[✓] Market data received! (${marketDataCount} total)`);
          if (message.marketData) {
            console.log(`    Symbol: ${message.marketData.symbol || 'N/A'}`);
            console.log(`    Instrument: ${JSON.stringify(message.instrumentId || 'N/A')}`);
          }
          console.log();
        } else if (msgType === 'ERROR' || message.status === 'ERROR') {
          errorCount++;
          console.log(`[ERROR] ${message.description || JSON.stringify(message)}`);
          console.log();
        }
      } catch (error) {
        console.log(`[PARSE ERROR] Could not parse: ${data.toString()}`);
        console.log();
      }
    });
    
    ws.on('close', (code, reason) => {
      console.log(`[CONNECTION] Closed (code: ${code}, reason: ${reason || 'none'})`);
      console.log();
    });
    
    ws.on('error', (error) => {
      console.error('[CONNECTION ERROR]', error.message);
      console.log();
    });
    
    // Wait for duration, then close
    setTimeout(() => {
      console.log('[INFO] Test duration complete');
      console.log();
      console.log('='.repeat(70));
      console.log('RESULTS');
      console.log('='.repeat(70));
      console.log(`Total messages received: ${messageCount}`);
      console.log(`Market data messages: ${marketDataCount}`);
      console.log(`Error messages: ${errorCount}`);
      console.log(`Message types seen: ${Array.from(receivedMessageTypes).join(', ') || 'none'}`);
      console.log();
      
      if (marketDataCount > 0) {
        console.log('✅ SUCCESS: Market data received directly from broker');
        console.log('   The broker connection and subscription work correctly.');
        console.log('   Any issues are likely with the proxy implementation.');
      } else if (messageCount > 0) {
        console.log('⚠️  PARTIAL: Received messages but no market data');
        console.log('   Check if subscription format or instrument symbols are correct.');
      } else {
        console.log('❌ FAILURE: No messages received at all');
        console.log('   Possible issues:');
        console.log('   - Token is invalid or expired');
        console.log('   - WebSocket URL is incorrect');
        console.log('   - Network/firewall blocking connection');
        console.log('   - Broker requires additional handshake');
      }
      console.log('='.repeat(70));
      
      ws.close();
      resolve(messageCount);
    }, TEST_DURATION);
  });
}

// Main test
async function runDirectTest() {
  try {
    const token = await authenticate();
    const ws = await connectDirectly(token);
    subscribeToMarketData(ws);
    await listenForMessages(ws);
    
    process.exit(0);
  } catch (error) {
    console.error('[FATAL]', error.message);
    process.exit(1);
  }
}

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log();
  console.log('[INTERRUPT] Test interrupted');
  process.exit(1);
});

runDirectTest();
