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

  /** GET /api/status — public, no auth needed */
  async getStatus(): Promise<OpenClawStatus> {
    return this.request<OpenClawStatus>("GET", "/api/status", undefined, false);
  }

  /** GET /api/sessions — list all active sessions */
  async listSessions(): Promise<OpenClawSession[]> {
    const result = await this.request<OpenClawSession[] | { sessions: OpenClawSession[] }>(
      "GET",
      "/api/sessions"
    );
    return Array.isArray(result) ? result : result.sessions ?? [];
  }

  /** POST /api/sessions/{sessionId}/messages — send a message */
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

  /** GET /api/sessions/{sessionId}/messages — get message history */
  async getMessages(
    sessionId = "main",
    limit = 20
  ): Promise<OpenClawMessage[]> {
    const result = await this.request<
      OpenClawMessage[] | { messages: OpenClawMessage[] }
    >("GET", `/api/sessions/${encodeURIComponent(sessionId)}/messages?limit=${limit}`);
    return Array.isArray(result) ? result : result.messages ?? [];
  }

  /** DELETE /api/sessions/{sessionId} — delete a session */
  async deleteSession(sessionId: string): Promise<void> {
    await this.request<unknown>(
      "DELETE",
      `/api/sessions/${encodeURIComponent(sessionId)}`
    );
  }

  /** GET /api/logs — get recent logs */
  async getLogs(limit = 50, level?: string): Promise<OpenClawLogEntry[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (level) params.set("level", level);
    const result = await this.request<
      OpenClawLogEntry[] | { logs: OpenClawLogEntry[] }
    >("GET", `/api/logs?${params}`);
    return Array.isArray(result) ? result : result.logs ?? [];
  }

  /** GET /api/config — get configuration */
  async getConfig(key?: string): Promise<OpenClawConfig> {
    const path = key
      ? `/api/config/${encodeURIComponent(key)}`
      : "/api/config";
    return this.request<OpenClawConfig>("GET", path);
  }

  /** POST /api/config — update a config value */
  async updateConfig(key: string, value: string): Promise<OpenClawConfig> {
    return this.request<OpenClawConfig>("POST", "/api/config", { key, value });
  }
}
