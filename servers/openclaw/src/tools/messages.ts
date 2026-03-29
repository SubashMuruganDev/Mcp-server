import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OpenClawClient } from "../openclaw-client.js";

export function registerMessageTools(
  server: McpServer,
  client: OpenClawClient
): void {
  server.tool(
    "send_message",
    "Send a message to the OpenClaw AI assistant and get the reply",
    {
      message: z.string().min(1).describe("The message to send to OpenClaw"),
      session_id: z
        .string()
        .optional()
        .default("main")
        .describe("Session ID (defaults to 'main')"),
    },
    async ({ message, session_id }) => {
      const reply = await client.sendMessage(message, session_id ?? "main");
      return {
        content: [
          {
            type: "text",
            text:
              typeof reply.content === "string"
                ? reply.content
                : JSON.stringify(reply, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "get_messages",
    "Retrieve conversation history from an OpenClaw session",
    {
      session_id: z
        .string()
        .optional()
        .default("main")
        .describe("Session ID to retrieve history from (defaults to 'main')"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .default(20)
        .describe("Maximum number of messages to return (default: 20)"),
    },
    async ({ session_id, limit }) => {
      const messages = await client.getMessages(session_id ?? "main", limit ?? 20);
      if (messages.length === 0) {
        return {
          content: [{ type: "text", text: "No messages found in this session." }],
        };
      }
      const formatted = messages
        .map(
          (m) =>
            `[${m.role.toUpperCase()}${m.timestamp ? ` @ ${m.timestamp}` : ""}]\n${m.content}`
        )
        .join("\n\n---\n\n");
      return {
        content: [{ type: "text", text: formatted }],
      };
    }
  );

  server.tool(
    "list_sessions",
    "List all active OpenClaw sessions",
    {},
    async () => {
      const sessions = await client.listSessions();
      if (sessions.length === 0) {
        return {
          content: [{ type: "text", text: "No active sessions found." }],
        };
      }
      const formatted = sessions
        .map(
          (s) =>
            `ID: ${s.id}${s.name ? ` | Name: ${s.name}` : ""}${s.messageCount !== undefined ? ` | Messages: ${s.messageCount}` : ""}${s.updatedAt ? ` | Updated: ${s.updatedAt}` : ""}`
        )
        .join("\n");
      return {
        content: [
          { type: "text", text: `Found ${sessions.length} session(s):\n\n${formatted}` },
        ],
      };
    }
  );

  server.tool(
    "delete_session",
    "Delete an OpenClaw session and clear its history",
    {
      session_id: z
        .string()
        .min(1)
        .describe("ID of the session to delete"),
    },
    async ({ session_id }) => {
      await client.deleteSession(session_id);
      return {
        content: [
          { type: "text", text: `Session '${session_id}' deleted successfully.` },
        ],
      };
    }
  );
}
