export interface OpenClawMessage {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
}

export interface OpenClawSession {
  id: string;
  name?: string;
  createdAt?: string;
  updatedAt?: string;
  messageCount?: number;
}

export interface OpenClawStatus {
  status: string;
  version?: string;
  uptime?: number;
  activeConnections?: number;
  [key: string]: unknown;
}

export interface OpenClawConfig {
  [key: string]: unknown;
}

export interface OpenClawLogEntry {
  timestamp?: string;
  level?: string;
  message: string;
  [key: string]: unknown;
}

export class OpenClawClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor() {
    this.baseUrl = (
      process.env["OPENCLAW_BASE_URL"] ?? "http://localhost:18789"
    ).replace(/\/$/, "");
    this.token = process.env["OPENCLAW_TOKEN"] ?? "";
    if (!this.token) {
      console.warn(
        "[openclaw-client] OPENCLAW_TOKEN is not set — authenticated requests will fail"
      );
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    requireAuth = true
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (requireAuth && this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      let detail = "";
      try {
        const text = await res.text();
        detail = text ? ` — ${text.slice(0, 200)}` : "";
      } catch {
        // ignore
      }
      throw new Error(
        `OpenClaw API error ${res.status} ${res.statusText} on ${method} ${path}${detail}`
      );
    }

    // Some endpoints return empty body on success
    const text = await res.text();
    if (!text) return {} as T;

    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  /**
   * GET /health/stats — runtime statistics (uptime, memory, CPU, tokens, etc.)
   * Falls back to GET /health for basic status.
   */
  async getStatus(): Promise<OpenClawStatus> {
    try {
      return await this.request<OpenClawStatus>(
        "GET",
        "/health/stats",
        undefined,
        false
      );
    } catch {
      return this.request<OpenClawStatus>("GET", "/health", undefined, false);
    }
  }

  /**
   * List sessions via POST /tools/invoke with tool "sessions_list".
   */
  async listSessions(): Promise<OpenClawSession[]> {
    const result = await this.request<
      | OpenClawSession[]
      | { sessions: OpenClawSession[] }
      | { result: OpenClawSession[] }
    >("POST", "/tools/invoke", {
      tool: "sessions_list",
      action: "json",
      args: {},
    });
    if (Array.isArray(result)) return result;
    if ("sessions" in result && Array.isArray(result.sessions))
      return result.sessions;
    if ("result" in result && Array.isArray(result.result)) return result.result;
    return [];
  }

  /**
   * POST /api/sessions/{sessionKey}/messages — send a message to a session.
   * Also supports the OpenAI-compatible endpoint POST /v1/chat/completions.
   */
  async sendMessage(
    message: string,
    sessionId = "main"
  ): Promise<OpenClawMessage> {
    return this.request<OpenClawMessage>(
      "POST",
      `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
      { content: message, role: "user" }
    );
  }

  /**
   * Get session history via POST /tools/invoke with tool "sessions_history".
   */
  async getMessages(
    sessionId = "main",
    limit = 20
  ): Promise<OpenClawMessage[]> {
    const result = await this.request<
      | OpenClawMessage[]
      | { messages: OpenClawMessage[] }
      | { result: OpenClawMessage[] }
    >("POST", "/tools/invoke", {
      tool: "sessions_history",
      action: "json",
      args: { sessionKey: sessionId, limit },
    });
    if (Array.isArray(result)) return result;
    if ("messages" in result && Array.isArray(result.messages))
      return result.messages;
    if ("result" in result && Array.isArray(result.result)) return result.result;
    return [];
  }

  /**
   * Delete a session via POST /tools/invoke with tool "sessions_delete".
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.request<unknown>("POST", "/tools/invoke", {
      tool: "sessions_delete",
      action: "json",
      args: { sessionKey: sessionId },
    });
  }

  /**
   * GET /health/channels — per-channel statistics and connectivity.
   * Used as the log source since OpenClaw has no dedicated HTTP log endpoint.
   */
  async getLogs(
    limit = 50,
    _level?: string
  ): Promise<OpenClawLogEntry[]> {
    // OpenClaw doesn't expose an HTTP log endpoint; use channel stats as status info
    const result = await this.request<
      | OpenClawLogEntry[]
      | { channels: OpenClawLogEntry[] }
      | Record<string, unknown>
    >("GET", "/health/channels", undefined, false);

    if (Array.isArray(result)) return result.slice(0, limit);
    if ("channels" in result && Array.isArray(result.channels))
      return result.channels.slice(0, limit);

    // Flatten key/value pairs from the health response as log-like entries
    return Object.entries(result)
      .slice(0, limit)
      .map(([k, v]) => ({
        message: `${k}: ${JSON.stringify(v)}`,
      }));
  }

  /**
   * Get config via openclaw CLI (no HTTP endpoint for config in OpenClaw).
   * Runs: openclaw config get [key]
   */
  async getConfig(key?: string): Promise<OpenClawConfig> {
    const { execAsync } = await import("./exec-helper.js");
    const cmd = key
      ? `openclaw config get ${key}`
      : "openclaw config list --json";
    const { stdout } = await execAsync(cmd);
    try {
      return JSON.parse(stdout.trim()) as OpenClawConfig;
    } catch {
      return { output: stdout.trim() };
    }
  }

  /**
   * Update config via openclaw CLI: openclaw config set <key> <value>
   */
  async updateConfig(key: string, value: string): Promise<OpenClawConfig> {
    const { execAsync } = await import("./exec-helper.js");
    const { stdout } = await execAsync(
      `openclaw config set ${key} ${JSON.stringify(value)}`
    );
    return { output: stdout.trim(), key, value };
  }
}
