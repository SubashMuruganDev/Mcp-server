import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export function registerSystemTools(server: McpServer): void {
  server.tool(
    "get_system_info",
    "Get system information for the machine running OpenClaw and this MCP server",
    {},
    async () => {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const uptimeSecs = os.uptime();
      const h = Math.floor(uptimeSecs / 3600);
      const m = Math.floor((uptimeSecs % 3600) / 60);
      const s = Math.floor(uptimeSecs % 60);

      const lines = [
        `Hostname: ${os.hostname()}`,
        `Platform: ${os.platform()} ${os.release()}`,
        `Architecture: ${os.arch()}`,
        `CPUs: ${os.cpus().length}x ${os.cpus()[0]?.model ?? "unknown"}`,
        `Memory: ${toMB(usedMem)} MB used / ${toMB(totalMem)} MB total (${Math.round((usedMem / totalMem) * 100)}%)`,
        `System uptime: ${h}h ${m}m ${s}s`,
        `Node.js: ${process.version}`,
        `MCP server PID: ${process.pid}`,
      ];
      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  server.tool(
    "restart_openclaw",
    "Restart the OpenClaw gateway process on the local machine",
    {},
    async () => {
      // Try PM2 first, then fallback to openclaw CLI
      try {
        const { stdout, stderr } = await execAsync("pm2 restart openclaw 2>&1", {
          timeout: 15_000,
        });
        const output = (stdout + stderr).trim();
        return {
          content: [
            {
              type: "text",
              text: `OpenClaw restarted via PM2.\n\n${output}`,
            },
          ],
        };
      } catch {
        // PM2 not managing openclaw, try the openclaw CLI
        try {
          const { stdout, stderr } = await execAsync("openclaw restart 2>&1", {
            timeout: 15_000,
          });
          const output = (stdout + stderr).trim();
          return {
            content: [
              {
                type: "text",
                text: `OpenClaw restarted via CLI.\n\n${output}`,
              },
            ],
          };
        } catch (err2) {
          const msg = err2 instanceof Error ? err2.message : String(err2);
          throw new Error(
            `Failed to restart OpenClaw. Tried PM2 and openclaw CLI.\n\nLast error: ${msg}\n\nHint: Make sure OpenClaw is managed by PM2 (pm2 start openclaw) or the 'openclaw' CLI is in PATH.`
          );
        }
      }
    }
  );
}

function toMB(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}
