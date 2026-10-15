import type { ErrorCode } from './errorCodes.js';

export class McpToolError extends Error {
  public constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly required?: string
  ) {
    super(message);
    this.name = 'McpToolError';
  }
}
