import * as crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Verifies the Authorization: Bearer <token> header against the expected token.
 * Uses constant-time comparison to prevent timing attacks.
 * Returns the extracted token string if present, or null.
 */
export function extractBearerToken(req: IncomingMessage): string | null {
  const header = req.headers["authorization"];
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice(7);
}

/**
 * Timing-safe token comparison.
 * Returns true if the provided token matches the expected token.
 */
export function verifyBearerToken(
  req: IncomingMessage,
  expectedToken: string
): boolean {
  const provided = extractBearerToken(req);
  if (!provided) return false;

  // Pad both to same length to prevent length-based timing leaks
  const a = Buffer.from(provided.padEnd(128).slice(0, 128));
  const b = Buffer.from(expectedToken.padEnd(128).slice(0, 128));

  if (a.length !== b.length) return false;
  return (
    crypto.timingSafeEqual(a, b) && provided.length === expectedToken.length
  );
}

/**
 * Sends a 401 Unauthorized response.
 */
export function sendUnauthorized(res: ServerResponse): void {
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Unauthorized" }));
}

/**
 * Simple in-memory rate limiter.
 * Tracks request counts per IP within a sliding window.
 */
export class RateLimiter {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly store = new Map<string, { count: number; resetAt: number }>();

  constructor(windowMs = 60_000, maxRequests = 30) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    // Clean up stale entries every minute
    setInterval(() => this.cleanup(), 60_000).unref();
  }

  /**
   * Checks whether the given IP is within the rate limit.
   * Returns true if the request is allowed, false if rate limited.
   */
  check(ip: string): boolean {
    const now = Date.now();
    const entry = this.store.get(ip);

    if (!entry || now > entry.resetAt) {
      this.store.set(ip, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    if (entry.count >= this.maxRequests) return false;
    entry.count++;
    return true;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [ip, entry] of this.store) {
      if (now > entry.resetAt) this.store.delete(ip);
    }
  }
}

/**
 * Sends a 429 Too Many Requests response.
 */
export function sendTooManyRequests(res: ServerResponse): void {
  res.writeHead(429, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Too many requests" }));
}
