# MCP Server Monorepo

A collection of MCP (Model Context Protocol) servers that extend Claude's capabilities.

## Structure

```
Mcp-server/
├── servers/
│   └── openclaw/      # Manage your OpenClaw AI assistant from Claude
├── shared/             # Shared auth, rate limiting, and security utilities
└── tsconfig.base.json  # Shared TypeScript config
```

## Servers

| Server | Description | Port |
|--------|-------------|------|
| [openclaw](./servers/openclaw/) | Full management of a local OpenClaw gateway | 3000 |

---

## Quick Start

### Prerequisites
- Node.js 22+ (`node --version`)
- OpenClaw installed and running locally (`openclaw gateway status`)

### 1. Clone & Install

```bash
git clone https://github.com/SubashMuruganDev/Mcp-server.git
cd Mcp-server
npm install
```

### 2. Build

```bash
npm run build
# Or build a single server:
npm run build:openclaw
```

### 3. Configure

```bash
cd servers/openclaw
cp .env.example .env
```

Edit `.env`:
```env
PORT=3000
BIND_HOST=127.0.0.1
MCP_AUTH_TOKEN=<generate with: openssl rand -hex 32>
OPENCLAW_BASE_URL=http://localhost:18789
OPENCLAW_TOKEN=<your openclaw gateway token>
ALLOWED_ORIGINS=https://claude.ai,https://anthropic.com
```

### 4. Start

```bash
# One-time test run
cd servers/openclaw && node dist/index.js

# Persistent (recommended) — using PM2
npm install -g pm2
cd servers/openclaw
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # auto-start on reboot
```

---

## Exposing to the Internet (for Claude Mobile / Web)

The server binds to `127.0.0.1` by default. To reach it remotely you need a reverse proxy with HTTPS.

### Option A — Caddy (auto HTTPS with Let's Encrypt)

1. [Install Caddy](https://caddyserver.com/docs/install)
2. Point your domain's DNS `A` record to your server's public IP
3. Copy and edit the example:

```bash
cp servers/openclaw/Caddyfile.example Caddyfile
# Replace "your-domain.com" with your actual domain
caddy run --config Caddyfile
```

### Option B — Cloudflare Tunnel (no open ports)

```bash
# Install cloudflared, then:
cloudflared tunnel --url http://localhost:3000
# Cloudflare gives you a public HTTPS URL like: https://random-name.trycloudflare.com
```

### Option C — ngrok (quick testing)

```bash
ngrok http 3000
# ngrok gives you a temporary HTTPS URL
```

---

## Registering with Claude

### Claude Mobile / Web (remote)

1. Go to **Claude.ai → Settings → MCP Servers → Add**
2. Fill in:
   - **URL**: `https://your-domain.com/mcp`
   - **Header name**: `Authorization`
   - **Header value**: `Bearer YOUR_MCP_AUTH_TOKEN`

### Claude CLI (local)

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "openclaw": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_AUTH_TOKEN"
      }
    }
  }
}
```

---

## Available Tools (OpenClaw server)

Once registered, Claude can use these tools in any conversation:

### Messaging
| Tool | What it does |
|------|-------------|
| `send_message` | Send a message to OpenClaw and get the reply |
| `get_messages` | Retrieve conversation history from a session |
| `list_sessions` | List all active OpenClaw sessions |
| `delete_session` | Delete a session and clear its history |

### Status & Monitoring
| Tool | What it does |
|------|-------------|
| `get_status` | Check OpenClaw gateway health, uptime, memory, and token stats |
| `get_logs` | Retrieve channel connectivity and status information |

### Configuration
| Tool | What it does |
|------|-------------|
| `get_config` | Read current OpenClaw configuration (all or a specific key) |
| `update_config` | Update an OpenClaw config value |

### System Management
| Tool | What it does |
|------|-------------|
| `restart_openclaw` | Restart the OpenClaw gateway process |
| `get_system_info` | Get machine hostname, CPU, memory, Node.js version, uptime |

---

## Security

The MCP server is protected by multiple layers:

| Layer | Detail |
|-------|--------|
| **Bearer token auth** | All `/mcp` requests require `Authorization: Bearer <MCP_AUTH_TOKEN>` |
| **Timing-safe comparison** | Uses `crypto.timingSafeEqual` to prevent token timing attacks |
| **Rate limiting** | 30 requests/minute per IP — excess requests get 429 |
| **CORS lockdown** | Only `claude.ai` and `anthropic.com` browser origins allowed |
| **Local binding** | Binds to `127.0.0.1` by default — not reachable externally without a proxy |
| **Security headers** | `X-Content-Type-Options`, `X-Frame-Options`, `Cache-Control: no-store` |

**Generate a strong token:**
```bash
openssl rand -hex 32
```

---

## Verifying it works

```bash
# Health check (no auth needed)
curl http://localhost:3000/health
# → {"status":"ok","service":"openclaw-mcp"}

# Should return 401
curl -X POST http://localhost:3000/mcp
# → {"error":"Unauthorized"}

# Should return 401
curl -X POST http://localhost:3000/mcp -H "Authorization: Bearer wrongtoken"
# → {"error":"Unauthorized"}

# List tools (replace token)
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer YOUR_MCP_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

---

## Adding a New MCP Server

```bash
# 1. Create the server directory
mkdir -p servers/my-new-server/src/tools

# 2. Copy openclaw's config as a starting point
cp servers/openclaw/package.json servers/my-new-server/
cp servers/openclaw/tsconfig.json servers/my-new-server/
# Edit the name field in package.json

# 3. Implement src/index.ts (use openclaw's as a template)
# 4. npm install && npm run build
```

The `shared` package's auth, rate limiting, and security utilities are available in any server via:
```ts
import { verifyBearerToken, RateLimiter, applySecurityHeaders } from "@mcp-server/shared";
```
