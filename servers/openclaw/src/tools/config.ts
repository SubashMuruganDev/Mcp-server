import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OpenClawClient } from "../openclaw-client.js";
import { wrapTool } from "./tool-wrapper.js";

export function registerConfigTools(
  server: McpServer,
  client: OpenClawClient
): void {
  server.tool(
    "get_config",
    "Get OpenClaw configuration — all settings or a specific key",
    {
      key: z
        .string()
        .optional()
        .describe("Specific config key to retrieve (omit for full config)"),
    },
    wrapTool(async ({ key }) => {
      const config = await client.getConfig(key);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(config, null, 2),
          },
        ],
      };
    })
  );

  server.tool(
    "update_config",
    "Update an OpenClaw configuration value",
    {
      key: z
        .string()
        .min(1)
        .describe("The config key to update (e.g. 'gateway.token', 'model')"),
      value: z.string().describe("The new value to set"),
    },
    wrapTool(async ({ key, value }) => {
      const result = await client.updateConfig(key, value);
      return {
        content: [
          {
            type: "text",
            text: `Config updated successfully.\n\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    })
  );
}
