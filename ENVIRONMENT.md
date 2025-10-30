# Environment Variables Configuration

This document describes all environment variables used by the ws-proxy service for deployment on Render.com.

## Required Variables

### PORT
- **Required**: Yes (automatically set by Render)
- **Default**: `10000`
- **Description**: Port number the service listens on
- **Example**: `PORT=10000`
- **Note**: Render automatically sets this variable. Don't override unless necessary.

## Optional Variables

### LOG_LEVEL
- **Required**: No
- **Default**: `info`
- **Options**: `info`, `debug`
- **Description**: Controls verbosity of application logs
- **Example**: `LOG_LEVEL=debug`
- **Production**: Use `info` for better performance
- **Development**: Use `debug` for detailed logs

### ALLOWED_ORIGINS
- **Required**: No
- **Default**: `null` (allows all origins)
- **Description**: Comma-separated list of allowed origins for CORS
- **Examples**: 
  - Single origin: `ALLOWED_ORIGINS=https://myapp.com`
  - Multiple origins: `ALLOWED_ORIGINS=https://myapp.com,https://www.myapp.com`
  - Allow all: `ALLOWED_ORIGINS=*`
- **Security**: Always specify origins in production

### REJECT_UNAUTHORIZED
- **Required**: No
- **Default**: `true`
- **Options**: `true`, `false`
- **Description**: Whether to reject unauthorized SSL certificates
- **Example**: `REJECT_UNAUTHORIZED=true`
- **Production**: Always use `true`
- **Development**: Can use `false` for testing with self-signed certs

## Environment-Specific Configurations

### Development Environment
```bash
PORT=8080
LOG_LEVEL=debug
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8080
REJECT_UNAUTHORIZED=false
```

### Staging Environment
```bash
PORT=10000
LOG_LEVEL=info
ALLOWED_ORIGINS=https://staging.myapp.com
REJECT_UNAUTHORIZED=true
```

### Production Environment
```bash
PORT=10000
LOG_LEVEL=info
ALLOWED_ORIGINS=https://myapp.com,https://www.myapp.com
REJECT_UNAUTHORIZED=true
```

## Setting Variables in Render.com

### Via Dashboard
1. Go to your service dashboard
2. Navigate to **"Environment"** tab
3. Click **"Add Environment Variable"**
4. Enter **Key** and **Value**
5. Click **"Save Changes"**

### Via render.yaml
```yaml
envVars:
  - key: LOG_LEVEL
    value: info
  - key: ALLOWED_ORIGINS
    value: "https://myapp.com,https://www.myapp.com"
  - key: REJECT_UNAUTHORIZED
    value: true
```

## Security Best Practices

### 1. ALLOWED_ORIGINS
- **Never use `*` in production**
- Specify exact domains that should access your proxy
- Include both www and non-www versions if needed
- Use HTTPS origins only in production

### 2. LOG_LEVEL
- Use `info` in production to avoid verbose logs
- Use `debug` only for troubleshooting
- Monitor log volume for cost optimization

### 3. REJECT_UNAUTHORIZED
- Always `true` in production
- Only set to `false` for development with self-signed certificates
- Monitor SSL certificate validity

## Environment Variable Validation

The service validates environment variables on startup:

```javascript
// Automatic validations performed:
- PORT: Must be a valid port number
- LOG_LEVEL: Must be 'info' or 'debug'
- ALLOWED_ORIGINS: Must be valid URLs or '*'
- REJECT_UNAUTHORIZED: Must be boolean-convertible
```

## Troubleshooting

### Common Issues

#### "Port already in use"
- Check if PORT is correctly set
- Ensure no other service is using the same port

#### "Origin not allowed"
- Verify ALLOWED_ORIGINS includes your client domain
- Check for typos in domain names
- Ensure protocol (http/https) matches

#### "SSL certificate error"
- Check REJECT_UNAUTHORIZED setting
- Verify upstream server SSL certificate validity
- For testing, temporarily set REJECT_UNAUTHORIZED=false

### Debug Commands

Check current environment variables:
```bash
# In Render shell/logs
echo $PORT
echo $LOG_LEVEL
echo $ALLOWED_ORIGINS
echo $REJECT_UNAUTHORIZED
```

Test with different log levels:
```bash
# Temporary debug mode
LOG_LEVEL=debug npm start
```

## Default Values Reference

| Variable | Default | Production Recommended |
|----------|---------|----------------------|
| `PORT` | `10000` | (set by Render) |
| `LOG_LEVEL` | `info` | `info` |
| `ALLOWED_ORIGINS` | `null` | Specific domains |
| `REJECT_UNAUTHORIZED` | `true` | `true` |

## Integration Examples

### Frontend JavaScript
```javascript
// Use environment-specific proxy URL
const PROXY_URL = process.env.NODE_ENV === 'production' 
  ? 'wss://your-service.onrender.com'
  : 'ws://localhost:8080';

const ws = new WebSocket(`${PROXY_URL}?token=${token}&server=${brokerUrl}`);
```

### Environment Detection
```javascript
// The service automatically detects environment
const isDevelopment = process.env.NODE_ENV !== 'production';
const logLevel = isDevelopment ? 'debug' : 'info';
```

## Monitoring Variables

These variables help with monitoring and debugging:

- **LOG_LEVEL**: Controls what gets logged
- **PORT**: Affects health check endpoints
- **Environment variables are logged** (values masked) on service startup

## Notes

1. **Restart Required**: Changes to environment variables require service restart
2. **Case Sensitive**: Variable names are case-sensitive
3. **String Values**: All environment variables are strings, converted as needed
4. **Validation**: Invalid values will prevent service startup with clear error messages