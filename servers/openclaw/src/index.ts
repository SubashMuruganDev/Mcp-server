import * as http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  RateLimiter,
  verifyBearerToken,
  sendUnauthorized,
  sendTooManyRequests,
  applySecurityHeaders,
  applyCorsHeaders,
  isCorsAllowed,
  sendForbidden,
  getClientIp,
} from "@mcp-server/shared";
import { OpenClawClient } from "./openclaw-client.js";
import { registerMessageTools } from "./tools/messages.js";
import { registerStatusTools } from "./tools/status.js";
import { registerConfigTools } from "./tools/config.js";
import { registerSystemTools } from "./tools/system.js";

const PORT = parseInt(process.env["PORT"] ?? "3000", 10);
const MCP_AUTH_TOKEN = process.env["MCP_AUTH_TOKEN"] ?? "";
const ALLOWED_ORIGINS = process.env["ALLOWED_ORIGINS"];
const BIND_HOST = process.env["BIND_HOST"] ?? "127.0.0.1";

if (!MCP_AUTH_TOKEN) {
  console.error(
    "[openclaw-mcp] FATAL: MCP_AUTH_TOKEN is not set. Refusing to start without authentication."
  );
  process.exit(1);
}

if (MCP_AUTH_TOKEN.length < 16) {
  console.warn(
    "[openclaw-mcp] WARNING: MCP_AUTH_TOKEN is very short. Use at least 32 chars (e.g. openssl rand -hex 32)."
  );
}

const rateLimiter = new RateLimiter(60_000, 30);
const openClawClient = new OpenClawClient();

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "openclaw-manager",
    version: "1.0.0",
  });

  registerMessageTools(server, openClawClient);
  registerStatusTools(server, openClawClient);
  registerConfigTools(server, openClawClient);
  registerSystemTools(server);

  return server;
}

const httpServer = http.createServer(async (req, res) => {
  const ip = getClientIp(req);

  // Apply security headers to all responses
  applySecurityHeaders(res);
  applyCorsHeaders(req, res, ALLOWED_ORIGINS);

  // Health check — no auth required, useful for uptime monitoring
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "openclaw-mcp" }));
    return;
  }

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Only handle POST /mcp for the MCP protocol
  if (req.url !== "/mcp") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  // CORS check — reject non-allowed browser origins
  if (!isCorsAllowed(req, ALLOWED_ORIGINS)) {
    sendForbidden(res);
    return;
  }

  // Rate limiting
  if (!rateLimiter.check(ip)) {
    sendTooManyRequests(res);
    return;
  }

  // Auth — Bearer token required
  if (!verifyBearerToken(req, MCP_AUTH_TOKEN)) {
    sendUnauthorized(res);
    return;
  }

  // Handle MCP request — new server instance per request (stateless HTTP)
  const mcpServer = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
  });

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error("[openclaw-mcp] Error handling MCP request:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  }
});

httpServer.listen(PORT, BIND_HOST, () => {
  console.log(
    `[openclaw-mcp] Server running on http://${BIND_HOST}:${PORT}/mcp`
  );
  console.log(`[openclaw-mcp] Health check: http://${BIND_HOST}:${PORT}/health`);
  console.log(
    `[openclaw-mcp] OpenClaw base URL: ${process.env["OPENCLAW_BASE_URL"] ?? "http://localhost:18789"}`
  );
});

httpServer.on("error", (err) => {
  console.error("[openclaw-mcp] Server error:", err);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[openclaw-mcp] Shutting down...");
  httpServer.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  console.log("[openclaw-mcp] Shutting down...");
  httpServer.close(() => process.exit(0));
});
