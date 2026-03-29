import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OpenClawClient } from "../openclaw-client.js";

export function registerStatusTools(
  server: McpServer,
  client: OpenClawClient
): void {
  server.tool(
    "get_status",
    "Check the OpenClaw gateway health, version, and uptime",
    {},
    async () => {
      const status = await client.getStatus();
      const lines: string[] = [`Status: ${status.status ?? "unknown"}`];
      if (status.version) lines.push(`Version: ${status.version}`);
      if (status.uptime !== undefined) {
        const uptimeSecs = Number(status.uptime);
        const h = Math.floor(uptimeSecs / 3600);
        const m = Math.floor((uptimeSecs % 3600) / 60);
        const s = Math.floor(uptimeSecs % 60);
        lines.push(`Uptime: ${h}h ${m}m ${s}s`);
      }
      if (status.activeConnections !== undefined) {
        lines.push(`Active connections: ${status.activeConnections}`);
      }
      // Include any other fields
      const extra = Object.entries(status).filter(
        ([k]) => !["status", "version", "uptime", "activeConnections"].includes(k)
      );
      for (const [k, v] of extra) {
        lines.push(`${k}: ${JSON.stringify(v)}`);
      }
      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  server.tool(
    "get_logs",
    "Retrieve recent OpenClaw gateway logs",
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .default(50)
        .describe("Number of log entries to retrieve (default: 50)"),
      level: z
        .enum(["debug", "info", "warn", "error"])
        .optional()
        .describe("Filter logs by level"),
    },
    async ({ limit, level }) => {
      const logs = await client.getLogs(limit ?? 50, level);
      if (logs.length === 0) {
        return {
          content: [{ type: "text", text: "No log entries found." }],
        };
      }
      const formatted = logs
        .map((entry) => {
          const ts = entry.timestamp ? `[${entry.timestamp}] ` : "";
          const lvl = entry.level ? `[${entry.level.toUpperCase()}] ` : "";
          return `${ts}${lvl}${entry.message}`;
        })
        .join("\n");
      return {
        content: [{ type: "text", text: formatted }],
      };
    }
  );
}
