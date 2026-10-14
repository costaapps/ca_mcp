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
  CompanyUUID?: string;
  IdCompany?: number;
  IdDatabase?: number;
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
    // Errors may contain SQL, connection details, credentials, or business data.
    // Keep the operational signal without writing the raw error or stack.
    console.error('[MCP] erro interno', {
      name: error instanceof Error ? error.name : 'UnknownError'
    });
  }
};
