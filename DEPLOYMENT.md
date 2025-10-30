# Deploying ws-proxy to Render.com

This guide walks you through deploying the WebSocket Proxy service to Render.com.

## Prerequisites

- Git repository with your ws-proxy code
- Render.com account (free tier available)
- GitHub/GitLab repository connection

## Quick Deployment Steps

### 1. Connect Your Repository

1. Go to [Render.com](https://render.com) and sign in
2. Click **"New"** → **"Web Service"**
3. Connect your GitHub/GitLab repository containing this project
4. Select the repository: `ws-proxy`

### 2. Configure Service Settings

#### Basic Settings
- **Name**: `ws-proxy` (or your preferred name)
- **Environment**: `Node`
- **Region**: Choose closest to your users (Oregon, Frankfurt, Singapore)
- **Branch**: `main` (or your default branch)

#### Build & Deploy
- **Build Command**: `npm install --production` (auto-detected)
- **Start Command**: `npm start` (auto-detected)

#### Advanced Settings
- **Auto-Deploy**: `Yes` (deploys on every git push)
- **Health Check Path**: `/health`

### 3. Set Environment Variables

Configure these environment variables in Render dashboard:

| Variable | Value | Description |
|----------|-------|-------------|
| `PORT` | `10000` | Port number (auto-set by Render) |
| `LOG_LEVEL` | `info` | Logging level (`info` or `debug`) |
| `ALLOWED_ORIGINS` | `*` | Comma-separated origins or `*` for all |
| `REJECT_UNAUTHORIZED` | `true` | SSL certificate validation |

**Production Security Settings:**
```
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
LOG_LEVEL=info
REJECT_UNAUTHORIZED=true
```

### 4. Deploy

1. Click **"Create Web Service"**
2. Render will automatically:
   - Clone your repository
   - Install dependencies
   - Start your service
   - Provide a public URL

## Alternative: Using render.yaml (Recommended)

If you have the `render.yaml` file in your repository root, Render will automatically use those settings:

1. Push the `render.yaml` file to your repository
2. In Render dashboard, the settings will be pre-configured
3. Just click **"Create Web Service"**

## Service URLs

After deployment, your service will be available at:

- **HTTPS**: `https://your-service-name.onrender.com`
- **WSS**: `wss://your-service-name.onrender.com`

### Example Usage

```javascript
// Connect to your deployed proxy
const token = 'your-auth-token';
const brokerServer = 'wss://api.remarkets.primary.com.ar/';
const proxyUrl = 'wss://your-service-name.onrender.com';

const ws = new WebSocket(`${proxyUrl}?token=${token}&server=${encodeURIComponent(brokerServer)}`);
```

## Health Check

Your service includes a health check endpoint:
- **URL**: `https://your-service-name.onrender.com/health`
- **Response**: `{"status":"ok","timestamp":1698765432000}`

## Monitoring & Logs

### View Logs
1. Go to your service dashboard on Render
2. Click **"Logs"** tab
3. View real-time logs and errors

### Metrics
- **Events**: Connection events, errors
- **Logs**: Detailed WebSocket proxy operations
- **Performance**: Request latency, uptime

## Production Considerations

### Security
- Set specific `ALLOWED_ORIGINS` instead of `*`
- Use HTTPS/WSS only in production
- Monitor logs for suspicious activity

### Performance
- **Free Tier**: Limited resources, sleeps after inactivity
- **Paid Plans**: Better performance, no sleep, more resources
- **Scaling**: Render auto-scales based on traffic

### SSL/TLS
- Render provides free SSL certificates
- Use `wss://` (secure WebSocket) in production
- No additional configuration needed

## Upgrading Service Plan

For production workloads, consider upgrading:

| Plan | Price | RAM | CPU | Features |
|------|-------|-----|-----|----------|
| Free | $0 | 512MB | 0.1 CPU | Sleeps after inactivity |
| Starter | $7/month | 512MB | 0.5 CPU | No sleep, custom domains |
| Standard | $25/month | 2GB | 1 CPU | Better performance |

## Custom Domain (Optional)

1. Go to service **Settings** → **Custom Domains**
2. Add your domain: `api.yourdomain.com`
3. Configure DNS: CNAME to `your-service-name.onrender.com`
4. SSL certificate will be auto-generated

## Troubleshooting

### Common Issues

#### Build Fails
- Check `package.json` has all required dependencies
- Ensure Node.js version compatibility (`engines` field)
- Review build logs for specific errors

#### Service Won't Start
- Verify `npm start` works locally
- Check if `PORT` environment variable is used correctly
- Review startup logs

#### WebSocket Connection Issues
- Ensure client uses `wss://` (not `ws://`)
- Check `ALLOWED_ORIGINS` configuration
- Verify health check is responding

#### Free Tier Limitations
- Service sleeps after 15 minutes of inactivity
- First request after sleep takes ~30 seconds
- Upgrade to paid plan for always-on service

### Debug Commands

Check service health:
```bash
curl https://your-service-name.onrender.com/health
```

Test WebSocket connection:
```bash
# Install wscat if needed
npm install -g wscat

# Test connection
wscat -c "wss://your-service-name.onrender.com?token=test&server=wss://echo.websocket.org/"
```

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | Yes | `10000` | Port to listen on (set by Render) |
| `LOG_LEVEL` | No | `info` | `info` or `debug` |
| `ALLOWED_ORIGINS` | No | `null` | Comma-separated allowed origins |
| `REJECT_UNAUTHORIZED` | No | `true` | SSL certificate validation |

## Support

- **Render Support**: [https://render.com/docs](https://render.com/docs)
- **Service Logs**: Available in Render dashboard
- **Health Check**: `/health` endpoint for monitoring