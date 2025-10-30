/**
 * Integration Test for WebSocket Proxy with Real Broker
 * 
 * This test:
 * 1. Reads broker credentials from broker-credentials.json
 * 2. Authenticates via REST API to get X-Auth-Token
 * 3. Launches the WebSocket proxy server
 * 4. Connects to broker via the proxy (passing token + server in querystring)
 * 5. Subscribes to market data for a real instrument
 * 6. Waits for market data messages
 * 7. Validates messages and closes gracefully
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const http = require('http');

// Try to load axios, if not available, use http
let axios;
try {
  axios = require('axios');
} catch (e) {
  console.log('[INFO] axios not installed, using native https module');
  axios = null;
}

// Configuration
const CREDENTIALS_FILE = path.join(__dirname, 'broker-credentials.json');
const PROXY_PORT = 8080;
const PROXY_STARTUP_TIMEOUT = 5000; // 5 seconds
const TEST_DURATION = 10000; // 10 seconds to wait for market data
// Try different instrument formats - the broker might be picky about format
const TEST_INSTRUMENTS = [
  { symbol: 'MERV - XMEV - AL30 - CI', marketId: 'ROFX', description: 'Original format' },
  { symbol: 'AL30', marketId: 'ROFX', description: 'Short symbol' },
  { symbol: 'AL30 - 48HS', marketId: 'ROFX', description: 'Settlement format' },
  { symbol: 'DLR/DIC25', marketId: 'ROFX', description: 'DLR future (from sample)' }
];

// Use first one by default
const INSTRUMENT_SYMBOL = TEST_INSTRUMENTS[0].symbol;
const MARKET_ID = TEST_INSTRUMENTS[0].marketId;

// Test state
let proxyProcess = null;
let testResults = {
  authSuccess: false,
  proxyStarted: false,
  connectionEstablished: false,
  subscriptionSent: false,
  marketDataReceived: false,
  messageCount: 0,
  errors: []
};

console.log('='.repeat(70));
console.log('WebSocket Proxy Integration Test');
console.log('='.repeat(70));
console.log();

// Step 1: Read broker credentials
console.log('[STEP 1] Reading broker credentials...');
let credentials;
try {
  const credentialsData = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
  credentials = JSON.parse(credentialsData);
  console.log('[OK] Credentials loaded');
  console.log(`     Environment: ${credentials.environment}`);
  console.log(`     User: ${credentials.user}`);
  console.log(`     Base URL: ${credentials.baseUrl}`);
  console.log(`     WebSocket URL: ${credentials.websocketUrl}`);
  console.log();
} catch (error) {
  console.error('[FAIL] Could not read credentials file:', error.message);
  process.exit(1);
}

// Step 2: Authenticate and get token
async function authenticateAndGetToken() {
  console.log('[STEP 2] Authenticating with broker API...');
  
  const authUrl = `${credentials.baseUrl}/auth/getToken`;
  const headers = {
    'X-Username': credentials.user,
    'X-Password': credentials.password
  };
  
  try {
    if (axios) {
      // Use axios if available
      const response = await axios.post(authUrl, null, {
        headers,
        validateStatus: () => true // Accept any status to handle errors
      });
      
      if (!response.headers['x-auth-token']) {
        throw new Error(`Authentication failed. Status: ${response.status}. Response: ${JSON.stringify(response.data)}`);
      }
      
      const token = response.headers['x-auth-token'];
      testResults.authSuccess = true;
      console.log('[OK] Authentication successful');
      console.log(`     Token: ${maskToken(token)}`);
      console.log();
      return token;
    } else {
      // Fallback to native https
      return await authenticateWithHttps(authUrl, headers);
    }
  } catch (error) {
    testResults.errors.push(`Auth error: ${error.message}`);
    console.error('[FAIL] Authentication failed:', error.message);
    throw error;
  }
}

function authenticateWithHttps(authUrl, headers) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const url = new URL(authUrl);
    
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
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
          testResults.authSuccess = true;
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

// Step 3: Start proxy server
function startProxyServer() {
  return new Promise((resolve, reject) => {
    console.log('[STEP 3] Starting WebSocket proxy server...');
    
    // Launch src/proxy.js as a child process
    proxyProcess = spawn('node', ['src/proxy.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: PROXY_PORT }
    });
    
    let startupOutput = '';
    
    proxyProcess.stdout.on('data', (data) => {
      const output = data.toString();
      startupOutput += output;
      // Look for startup message
      if (output.includes('WebSocket proxy server started')) {
        testResults.proxyStarted = true;
        console.log('[OK] Proxy server started on port', PROXY_PORT);
        console.log();
        resolve();
      }
    });
    
    proxyProcess.stderr.on('data', (data) => {
      console.error('[PROXY ERROR]', data.toString());
    });
    
    proxyProcess.on('error', (error) => {
      testResults.errors.push(`Proxy spawn error: ${error.message}`);
      reject(error);
    });
    
    proxyProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.log(`[WARN] Proxy exited with code ${code}`);
      }
    });
    
    // Timeout if proxy doesn't start
    setTimeout(() => {
      if (!testResults.proxyStarted) {
        reject(new Error('Proxy startup timeout. Output: ' + startupOutput));
      }
    }, PROXY_STARTUP_TIMEOUT);
  });
}

// Wait for proxy health check
function waitForProxyHealth() {
  return new Promise((resolve, reject) => {
    const healthUrl = `http://localhost:${PROXY_PORT}/health`;
    const maxRetries = 10;
    let retries = 0;
    
    const checkHealth = () => {
      http.get(healthUrl, (res) => {
        if (res.statusCode === 200) {
          console.log('[OK] Proxy health check passed');
          console.log();
          resolve();
        } else {
          retry();
        }
      }).on('error', () => {
        retry();
      });
    };
    
    const retry = () => {
      retries++;
      if (retries >= maxRetries) {
        reject(new Error('Proxy health check failed after max retries'));
      } else {
        setTimeout(checkHealth, 500);
      }
    };
    
    checkHealth();
  });
}

// Step 4: Connect to broker via proxy
function connectViaBroker(token) {
  return new Promise((resolve, reject) => {
    console.log('[STEP 4] Connecting to broker via proxy...');
    
    const proxyUrl = `ws://localhost:${PROXY_PORT}?token=${encodeURIComponent(token)}&server=${encodeURIComponent(credentials.websocketUrl)}`;
    console.log(`     Proxy URL: ws://localhost:${PROXY_PORT}?token=${maskToken(token)}&server=${credentials.websocketUrl}`);
    
    const ws = new WebSocket(proxyUrl);
    let connectionTimeout;
    
    ws.on('open', () => {
      clearTimeout(connectionTimeout);
      testResults.connectionEstablished = true;
      console.log('[OK] Connected to broker via proxy');
      console.log();
      resolve(ws);
    });
    
    ws.on('error', (error) => {
      clearTimeout(connectionTimeout);
      testResults.errors.push(`WebSocket error: ${error.message}`);
      console.error('[FAIL] WebSocket error:', error.message);
      reject(error);
    });
    
    connectionTimeout = setTimeout(() => {
      ws.close();
      reject(new Error('Connection timeout'));
    }, 10000);
  });
}

// Step 5: Subscribe to market data
function subscribeToMarketData(ws) {
  console.log('[STEP 5] Subscribing to market data...');
  console.log(`     Instrument: ${INSTRUMENT_SYMBOL}`);
  console.log(`     Market ID: ${MARKET_ID}`);
  
  // Construct subscription message matching pyRofex format
  const subscriptionMessage = {
    type: "smd",
    level: 1,
    depth: 1,
    entries: ["BI", "OF", "LA"], // BIDS, OFFERS, LAST
    products: [
      {
        symbol: INSTRUMENT_SYMBOL,
        marketId: MARKET_ID
      }
    ]
  };
  
  const messageStr = JSON.stringify(subscriptionMessage);
  console.log(`     Message: ${messageStr}`);
  
  ws.send(messageStr);
  testResults.subscriptionSent = true;
  console.log('[OK] Subscription message sent');
  console.log();
}

// Step 6: Wait for market data
function waitForMarketData(ws) {
  return new Promise((resolve) => {
    console.log('[STEP 6] Waiting for market data...');
    console.log(`     Timeout: ${TEST_DURATION / 1000} seconds`);
    console.log();
    
    let timeout;
    let receivedAnyMessage = false;
    
    ws.on('message', (data) => {
      receivedAnyMessage = true;
      try {
        const message = JSON.parse(data.toString());
        testResults.messageCount++;
        
        console.log(`[DATA ${testResults.messageCount}] Message received:`);
        console.log(JSON.stringify(message, null, 2));
        
        // Check if this is market data (type: Md) or error
        if (message.type === 'Md') {
          testResults.marketDataReceived = true;
          console.log('[OK] ✅ Market data received!');
        } else if (message.status === 'ERROR') {
          console.log('[WARN] ⚠️ Error message from broker:', message.description || message.message || 'No description');
          testResults.errors.push(`Broker error: ${message.description || message.message || JSON.stringify(message)}`);
        } else if (message.type) {
          console.log(`[INFO] Message type: ${message.type}`);
        } else {
          console.log('[INFO] Unknown message format');
        }
        console.log();
      } catch (error) {
        console.error('[WARN] Could not parse message:', data.toString());
        testResults.errors.push(`Parse error: ${error.message}`);
      }
    });
    
    ws.on('close', (code, reason) => {
      clearTimeout(timeout);
      console.log(`[INFO] Connection closed (code: ${code}, reason: ${reason || 'none'})`);
      if (!receivedAnyMessage) {
        console.log('[WARN] ⚠️ No messages received from broker before close');
        testResults.errors.push('No messages received from broker');
      }
      resolve();
    });
    
    ws.on('error', (error) => {
      console.error('[ERROR] WebSocket error during data wait:', error.message);
      testResults.errors.push(`WebSocket error: ${error.message}`);
    });
    
    // Wait for the specified duration
    timeout = setTimeout(() => {
      console.log('[INFO] Test duration completed');
      if (receivedAnyMessage) {
        console.log(`[INFO] Received ${testResults.messageCount} message(s) total`);
      } else {
        console.log('[WARN] ⚠️ No messages received during test period');
      }
      ws.close();
    }, TEST_DURATION);
  });
}

// Main test flow
async function runIntegrationTest() {
  try {
    // Step 1: Already done (read credentials)
    
    // Step 2: Authenticate
    const token = await authenticateAndGetToken();
    
    // Step 3: Start proxy
    await startProxyServer();
    await waitForProxyHealth();
    
    // Step 4: Connect via proxy
    const ws = await connectViaBroker(token);
    
    // Step 5: Subscribe to market data
    subscribeToMarketData(ws);
    
    // Step 6: Wait for market data
    await waitForMarketData(ws);
    
  } catch (error) {
    console.error('[FATAL]', error.message);
    testResults.errors.push(`Fatal: ${error.message}`);
  } finally {
    // Cleanup
    console.log();
    console.log('='.repeat(70));
    console.log('Test Results');
    console.log('='.repeat(70));
    console.log();
    console.log('Steps completed:');
    console.log(`  ✓ Read credentials: YES`);
    console.log(`  ${testResults.authSuccess ? '✓' : '✗'} Authentication: ${testResults.authSuccess ? 'YES' : 'NO'}`);
    console.log(`  ${testResults.proxyStarted ? '✓' : '✗'} Proxy started: ${testResults.proxyStarted ? 'YES' : 'NO'}`);
    console.log(`  ${testResults.connectionEstablished ? '✓' : '✗'} Connection established: ${testResults.connectionEstablished ? 'YES' : 'NO'}`);
    console.log(`  ${testResults.subscriptionSent ? '✓' : '✗'} Subscription sent: ${testResults.subscriptionSent ? 'YES' : 'NO'}`);
    console.log(`  ${testResults.marketDataReceived ? '✓' : '✗'} Market data received: ${testResults.marketDataReceived ? 'YES' : 'NO'}`);
    console.log();
    console.log(`Messages received: ${testResults.messageCount}`);
    
    if (testResults.errors.length > 0) {
      console.log();
      console.log('Errors:');
      testResults.errors.forEach((err, idx) => {
        console.log(`  ${idx + 1}. ${err}`);
      });
    }
    
    console.log();
    console.log('='.repeat(70));
    
    const allPassed = testResults.authSuccess &&
                      testResults.proxyStarted &&
                      testResults.connectionEstablished &&
                      testResults.subscriptionSent &&
                      testResults.marketDataReceived;
    
    if (allPassed) {
      console.log('✅ INTEGRATION TEST PASSED');
    } else {
      console.log('❌ INTEGRATION TEST FAILED');
    }
    console.log('='.repeat(70));
    
    // Kill proxy process
    if (proxyProcess) {
      console.log();
      console.log('[CLEANUP] Stopping proxy server...');
      proxyProcess.kill('SIGTERM');
      
      // Give it time to close gracefully
      setTimeout(() => {
        if (proxyProcess && !proxyProcess.killed) {
          proxyProcess.kill('SIGKILL');
        }
        process.exit(allPassed ? 0 : 1);
      }, 1000);
    } else {
      process.exit(allPassed ? 0 : 1);
    }
  }
}

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log();
  console.log('[INTERRUPT] Test interrupted by user');
  if (proxyProcess) {
    proxyProcess.kill('SIGTERM');
  }
  process.exit(1);
});

// Run the test
runIntegrationTest();
