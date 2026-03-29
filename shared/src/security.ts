import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Applies security headers to a response.
 */
export function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
}

/**
 * Checks the Origin header against an allowed origins list.
 * If the request has no Origin header (e.g., direct API call from Claude), it is allowed.
 * If the Origin is present but not in the allowlist, returns false.
 *
 * @param allowedOrigins - comma-separated string of allowed origins, or undefined to allow all
 */
export function isCorsAllowed(
  req: IncomingMessage,
  allowedOrigins: string | undefined
): boolean {
  const origin = req.headers["origin"];
  if (!origin) return true; // Non-browser requests (Claude API) don't send Origin
  if (!allowedOrigins) return true; // No restriction configured

  const allowed = allowedOrigins.split(",").map((o) => o.trim());
  return allowed.includes(origin);
}

/**
 * Applies CORS headers for allowed origins.
 */
export function applyCorsHeaders(
  req: IncomingMessage,
  res: ServerResponse,
  allowedOrigins: string | undefined
): void {
  const origin = req.headers["origin"];
  if (!origin || !allowedOrigins) return;

  const allowed = allowedOrigins.split(",").map((o) => o.trim());
  if (allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Vary", "Origin");
  }
}

/**
 * Sends a 403 Forbidden response.
 */
export function sendForbidden(res: ServerResponse): void {
  res.writeHead(403, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Forbidden" }));
}

/**
 * Gets the real client IP from request headers (handles proxies).
 */
export function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0];
    return first.trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}
