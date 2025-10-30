/**
 * WebSocket Proxy for pyRofex Broker Connections
 * 
 * Accepts browser WebSocket connections with token and server in querystring,
 * injects X-Auth-Token header, and proxies to upstream broker WebSocket.
 * 
 * Usage: ws://localhost:8080?token=YOUR_TOKEN&server=wss://api.remarkets.primary.com.ar/
 */

const WebSocket = require('ws');
const http = require('http');
const url = require('url');

// Configuration
const PORT = process.env.PORT || 8080;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : null;
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// Logging utility
function log(level, message, meta = {}) {
  if (LOG_LEVEL === 'debug' || level !== 'debug') {
    const timestamp = new Date().toISOString();
    const metaStr = Object.keys(meta).length > 0 ? JSON.stringify(meta) : '';
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message} ${metaStr}`);
  }
}

// Mask token for logging (show first 4 and last 4 characters)
function maskToken(token) {
  if (!token || token.length <= 8) return '****';
  return `${token.substring(0, 4)}...${token.substring(token.length - 4)}`;
}

// Create HTTP server for WebSocket upgrade
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

// Create WebSocket server
const wss = new WebSocket.Server({ noServer: true });

// Handle WebSocket upgrade
server.on('upgrade', (request, socket, head) => {
  const parsedUrl = url.parse(request.url, true);
  const { token, server: upstreamServer } = parsedUrl.query;
  const origin = request.headers.origin;
  
  log('info', 'Incoming connection request', {
    origin,
    path: parsedUrl.pathname,
    hasToken: !!token,
    hasServer: !!upstreamServer
  });

  // Validate token
  if (!token) {
    log('warn', 'Rejected: Missing token parameter');
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\nMissing token parameter');
    socket.destroy();
    return;
  }

  // Validate server
  if (!upstreamServer) {
    log('warn', 'Rejected: Missing server parameter');
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\nMissing server parameter');
    socket.destroy();
    return;
  }

  // Validate upstream server format
  if (!upstreamServer.startsWith('ws://') && !upstreamServer.startsWith('wss://')) {
    log('warn', 'Rejected: Invalid server format', { server: upstreamServer });
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\nInvalid server parameter (must start with ws:// or wss://)');
    socket.destroy();
    return;
  }

  // Check origin if allowlist is configured
  if (ALLOWED_ORIGINS && origin) {
    if (!ALLOWED_ORIGINS.includes(origin) && !ALLOWED_ORIGINS.includes('*')) {
      log('warn', 'Rejected: Origin not allowed', { origin });
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\nOrigin not allowed');
      socket.destroy();
      return;
    }
  }

  // Accept the WebSocket connection
  wss.handleUpgrade(request, socket, head, (clientWs) => {
    wss.emit('connection', clientWs, request, { token, upstreamServer });
  });
});

// Handle WebSocket connections
wss.on('connection', (clientWs, request, { token, upstreamServer }) => {
  const clientId = `client-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const startTime = Date.now();
  
  log('info', 'Client connected', {
    clientId,
    server: upstreamServer,
    token: maskToken(token)
  });

  let upstreamWs = null;
  let isClosing = false;

  // Create upstream connection with X-Auth-Token header
  try {
    const headers = {
      'X-Auth-Token': token
    };

    // Preserve subprotocol if client requested it
    if (request.headers['sec-websocket-protocol']) {
      headers['Sec-WebSocket-Protocol'] = request.headers['sec-websocket-protocol'];
    }

    log('debug', 'Connecting to upstream', {
      clientId,
      server: upstreamServer,
      headers: { 'X-Auth-Token': maskToken(token) }
    });

    upstreamWs = new WebSocket(upstreamServer, {
      headers,
      rejectUnauthorized: process.env.REJECT_UNAUTHORIZED !== 'false' // Allow disabling for dev
    });

    // Buffer for messages received from client before upstream is ready
    const messageBuffer = [];

    // Upstream connection opened
    upstreamWs.on('open', () => {
      log('info', 'Upstream connection established', { clientId });
      
      // Send any buffered messages
      if (messageBuffer.length > 0) {
        log('debug', `Sending ${messageBuffer.length} buffered message(s)`, { clientId });
        messageBuffer.forEach(({ data, isBinary }) => {
          upstreamWs.send(data, { binary: isBinary });
        });
        messageBuffer.length = 0; // Clear buffer
      }
    });

    // Forward messages from upstream to client
    upstreamWs.on('message', (data, isBinary) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data, { binary: isBinary });
        log('debug', 'Forwarded message upstream->client', {
          clientId,
          bytes: data.length,
          binary: isBinary
        });
      }
    });

    // Forward messages from client to upstream
    clientWs.on('message', (data, isBinary) => {
      if (upstreamWs && upstreamWs.readyState === WebSocket.OPEN) {
        upstreamWs.send(data, { binary: isBinary });
        log('debug', 'Forwarded message client->upstream', {
          clientId,
          bytes: data.length,
          binary: isBinary
        });
      } else {
        // Buffer message if upstream is not ready yet
        log('debug', 'Buffering message (upstream not ready)', {
          clientId,
          bytes: data.length
        });
        messageBuffer.push({ data, isBinary });
      }
    });

    // Handle upstream errors
    upstreamWs.on('error', (error) => {
      log('error', 'Upstream error', {
        clientId,
        error: error.message
      });
      if (!isClosing) {
        isClosing = true;
        clientWs.close(1011, 'Upstream connection error');
      }
    });

    // Handle upstream close
    upstreamWs.on('close', (code, reason) => {
      const duration = Date.now() - startTime;
      log('info', 'Upstream connection closed', {
        clientId,
        code: code || 1000,
        reason: reason ? reason.toString() : '',
        duration: `${duration}ms`
      });
      if (!isClosing) {
        isClosing = true;
        try {
          clientWs.close(code || 1000, reason || '');
        } catch (err) {
          log('warn', 'Error closing client connection', { clientId, error: err.message });
        }
      }
    });

    // Handle client close
    clientWs.on('close', (code, reason) => {
      const duration = Date.now() - startTime;
      log('info', 'Client connection closed', {
        clientId,
        code: code || 1000,
        reason: reason ? reason.toString() : '',
        duration: `${duration}ms`
      });
      if (!isClosing && upstreamWs) {
        isClosing = true;
        try {
          upstreamWs.close(code || 1000, reason || '');
        } catch (err) {
          log('warn', 'Error closing upstream connection', { clientId, error: err.message });
        }
      }
    });

    // Handle client errors
    clientWs.on('error', (error) => {
      log('error', 'Client error', {
        clientId,
        error: error.message
      });
      if (!isClosing && upstreamWs) {
        isClosing = true;
        upstreamWs.close(1011, 'Client connection error');
      }
    });

  } catch (error) {
    log('error', 'Failed to create upstream connection', {
      clientId,
      error: error.message
    });
    clientWs.close(1011, 'Failed to connect to upstream server');
  }
});

// Start server
server.listen(PORT, () => {
  log('info', `WebSocket proxy server started`, {
    port: PORT,
    allowedOrigins: ALLOWED_ORIGINS || 'all',
    logLevel: LOG_LEVEL
  });
  log('info', `Health check available at http://localhost:${PORT}/health`);
  log('info', `Example usage: ws://localhost:${PORT}?token=YOUR_TOKEN&server=wss://api.remarkets.primary.com.ar/`);
});

// Handle shutdown gracefully
process.on('SIGTERM', () => {
  log('info', 'SIGTERM received, closing server...');
  server.close(() => {
    log('info', 'Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  log('info', 'SIGINT received, closing server...');
  server.close(() => {
    log('info', 'Server closed');
    process.exit(0);
  });
});
