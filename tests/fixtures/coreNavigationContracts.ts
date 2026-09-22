export const canonicalRequestHandoffSuccess = {
  Success: true,
  ExecutionUUID: 'execution-1',
  Data: {
    Accepted: true,
    Destination: 'Vendas',
    Status: 'REQUESTED',
    HandoffUUID: 'handoff-1'
  }
} as const;
