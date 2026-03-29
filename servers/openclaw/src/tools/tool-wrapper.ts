/**
 * Wraps a tool handler so any thrown error is returned as readable content
 * rather than crashing the MCP server or surfacing a raw stack trace.
 */
export function wrapTool<T>(
  handler: (input: T) => Promise<{ content: Array<{ type: "text"; text: string }> }>
): (input: T) => Promise<{ content: Array<{ type: "text"; text: string }> }> {
  return async (input: T) => {
    try {
      return await handler(input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
      };
    }
  };
}
