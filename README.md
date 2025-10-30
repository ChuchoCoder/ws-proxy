# WebSocket Proxy for pyRofex Broker

A simple WebSocket proxy that enables browser applications to connect to pyRofex broker WebSocket servers by injecting the required `X-Auth-Token` header during the handshake.

## Problem

Browser WebSocket API doesn't allow setting custom headers during the connection handshake. The pyRofex broker requires the `X-Auth-Token` header for authentication. This proxy solves that limitation by accepting the token via querystring and injecting it as a header when connecting to the upstream broker.

## Features

- ✅ Accepts token and server address via querystring
- ✅ Injects `X-Auth-Token` header to upstream connection
- ✅ Bidirectional message forwarding (transparent tunnel)
- ✅ Preserves WebSocket compression (`Sec-WebSocket-Extensions`)
- ✅ Forwards binary and text frames
- ✅ Proper connection lifecycle management
- ✅ Origin validation (optional)
- ✅ Health check endpoint
- ✅ Detailed logging with token masking

## Installation

```bash
npm install
```

## Usage

### Start the proxy server

```bash
npm start
```

The proxy will start on port 8080 (or the port specified in `PORT` environment variable).

### Connect from browser or client

Connect to the proxy using this URL format:

```
ws://localhost:8080?token=YOUR_TOKEN&server=wss://api.remarkets.primary.com.ar/
```

**Parameters:**
- `token` (required): Your authentication token
- `server` (required): The upstream broker WebSocket URL (must start with `ws://` or `wss://`)

### Example: Browser JavaScript

```javascript
// Get your token (e.g., from pyRofex REST authentication)
const token = 'your-token-here';
const brokerServer = 'wss://api.remarkets.primary.com.ar/';

// Connect via proxy
const ws = new WebSocket(`ws://localhost:8080?token=${token}&server=${encodeURIComponent(brokerServer)}`);

ws.onopen = () => {
  console.log('Connected to broker via proxy');
  
  // Subscribe to market data (pyRofex format)
  const subscribeMsg = {
    "type": "smd",
    "level": 1,
    "entries": ["BI", "OF", "LA"],
    "products": [
      {"symbol": "DLR/DIC23", "marketId": "ROFX"},
      {"symbol": "DLR/ENE24", "marketId": "ROFX"}
    ]
  };
  
  ws.send(JSON.stringify(subscribeMsg));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Market data received:', data);
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = (event) => {
  console.log('Connection closed:', event.code, event.reason);
};
```

### Example: Using wscat for testing

Install wscat if you don't have it:
```bash
npm install -g wscat
```

Test the connection:
```bash
wscat -c "ws://localhost:8080?token=YOUR_TOKEN&server=wss://api.remarkets.primary.com.ar/"
```

## Configuration

Configure via environment variables:

```bash
# Port to listen on
PORT=8080

# Allowed origins (comma-separated, or use * for all)
ALLOWED_ORIGINS=http://localhost:3000,https://myapp.com

# Log level (info or debug)
LOG_LEVEL=info

# Disable SSL verification for testing (NOT for production)
# REJECT_UNAUTHORIZED=false
```

### Example with custom config

```bash
PORT=9000 ALLOWED_ORIGINS=* LOG_LEVEL=debug npm start
```

## Health Check

Check if the proxy is running:

```bash
curl http://localhost:8080/health
```

Response:
```json
{"status":"ok","timestamp":1698765432000}
```

## How It Works

1. Browser connects to proxy: `ws://localhost:8080?token=ABC&server=wss://broker.com/`
2. Proxy validates token and server parameters
3. Proxy creates upstream connection to `wss://broker.com/` with header `X-Auth-Token: ABC`
4. Proxy forwards all messages bidirectionally (client ↔ upstream)
5. Proxy handles connection lifecycle (close, errors, ping/pong)

## Security Considerations

⚠️ **Important Security Notes:**

- Always use TLS in production (`wss://` for both client and upstream)
- Configure `ALLOWED_ORIGINS` to restrict which domains can use the proxy
- Never log full tokens (proxy automatically masks them in logs)
- Consider rate limiting per IP in production
- Run behind a reverse proxy (nginx/Caddy) for TLS termination
- Monitor connections and implement timeouts

## Testing

### Unit Test

Run the test client with a mock echo server:

```bash
npm test
```

This will test the proxy with a mock echo server to verify:
- Token is correctly injected as `X-Auth-Token` header
- Messages are forwarded bidirectionally
- Connection lifecycle works correctly

### Integration Test

Run the full integration test with a real broker:

```bash
npm run test:integration
```

This comprehensive test:
1. Reads broker credentials from `tests/broker-credentials.json`
2. Authenticates with the broker REST API to get an X-Auth-Token
3. Launches the WebSocket proxy server
4. Connects to the broker WebSocket via the proxy
5. Subscribes to real market data for a specified instrument
6. Waits 10 seconds for market data messages
7. Validates the flow and reports results

**Setup for integration test:**

Create `tests/broker-credentials.json`:
```json
{
  "environment": "production",
  "user": "YOUR_USER",
  "password": "YOUR_PASSWORD",
  "baseUrl": "https://api.cocos.xoms.com.ar",
  "websocketUrl": "wss://api.cocos.xoms.com.ar"
}
```

⚠️ **Note:** Never commit real credentials to version control!

### Direct Broker Test (Without Proxy)

To test broker connectivity directly (bypassing the proxy) and verify that the broker is working:

```bash
npm run test:broker
```

This test:
- Authenticates directly with the broker REST API
- Opens a WebSocket connection with X-Auth-Token header
- Subscribes to market data
- Verifies messages are being received

This is useful for:
- Troubleshooting proxy issues by isolating the broker connection
- Confirming the broker is accessible and sending data
- Validating credentials and market data subscriptions

## Integration with pyRofex

### Step 1: Get authentication token using pyRofex

```python
import pyRofex

# Initialize and authenticate
pyRofex.initialize(
    user="YOUR_USER",
    password="YOUR_PASSWORD",
    account="YOUR_ACCOUNT",
    environment=pyRofex.Environment.REMARKET
)

# Get the token (this is stored internally by pyRofex)
# You'll need to expose it or store it when authenticating
```

### Step 2: Pass token to browser

Send the token to your browser application (via secure API endpoint).

### Step 3: Connect from browser via proxy

```javascript
const token = 'token-from-server';
const ws = new WebSocket(`ws://localhost:8080?token=${token}&server=wss://api.remarkets.primary.com.ar/`);
```

## Troubleshooting

### Connection refused
- Check that the proxy is running (`npm start`)
- Verify the port is correct

### 400 Bad Request
- Ensure both `token` and `server` parameters are provided
- Check that `server` starts with `ws://` or `wss://`

### 403 Forbidden
- Check `ALLOWED_ORIGINS` configuration
- Verify your origin is in the allowlist

### Upstream connection error
- Verify the broker server URL is correct
- Check your token is valid and not expired
- Ensure you have network access to the broker

### Enable debug logging
```bash
LOG_LEVEL=debug npm start
```

## License

MIT

## Deployment

### Deploy to Render.com

This application is ready for deployment to Render.com. See the detailed deployment guide:

📖 **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Complete deployment instructions
📋 **[ENVIRONMENT.md](./ENVIRONMENT.md)** - Environment variables guide

**Quick Deploy:**
1. Connect your GitHub repository to Render.com
2. The `render.yaml` file will automatically configure your service
3. Set environment variables (see ENVIRONMENT.md)
4. Deploy!

Your service will be available at: `wss://your-service-name.onrender.com`

**Example usage with deployed service:**
```javascript
const ws = new WebSocket('wss://your-service-name.onrender.com?token=YOUR_TOKEN&server=wss://api.remarkets.primary.com.ar/');
```
