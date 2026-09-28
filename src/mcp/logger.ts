export interface ToolLogEvent {
  tool: string;
  durationMs: number;
  success: boolean;
  errorCode?: string;
  ExecutionUUID?: string;
  TurnUUID?: string;
  RequestUUID?: string;
  InvocationUUID?: string;
  HandoffUUID?: string;
}

export interface McpLogger {
  toolCompleted(event: ToolLogEvent): void;
  serverError(error: unknown): void;
}

export const consoleMcpLogger: McpLogger = {
  toolCompleted(event) {
    console.info(JSON.stringify({ type: 'mcp_tool', ...event }));
  },
  serverError(error) {
    console.error('[MCP] erro interno', error);
  }
};
