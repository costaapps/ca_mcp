import { McpToolError } from '../errors/McpToolError.js';
import { ERROR_CODES } from '../errors/errorCodes.js';
import type {
  CoreDescribeFlowActionData,
  CoreDescribeFlowActionRequest,
  CoreExecuteFlowActionData,
  CoreExecuteFlowActionRequest,
  CoreFlowClientContract,
  CoreFlowResponse,
  CoreListFlowActionsData,
  CoreListFlowActionsRequest
} from './contracts.js';
import {
  coreDescribeFlowActionDataSchema,
  coreExecuteFlowActionDataSchema,
  coreFlowResponseSchema,
  coreListFlowActionsDataSchema
} from './schemas.js';

export interface CoreFlowClientOptions {
  baseUrl: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
}

const LIST_ENDPOINT = '/v1/ai-document/flow-actions/list';
const DESCRIBE_ENDPOINT = '/v1/ai-document/flow-actions/describe';
const EXECUTE_ENDPOINT = '/v1/ai-document/flow-actions/execute';

export class CoreFlowClient implements CoreFlowClientContract {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  public constructor(options: CoreFlowClientOptions) {
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new Error('CORE_API_TIMEOUT_MS deve ser um inteiro positivo.');
    }

    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  public listFlowActions(
    request: CoreListFlowActionsRequest
  ): Promise<CoreFlowResponse<CoreListFlowActionsData>> {
    return this.post(LIST_ENDPOINT, request, coreListFlowActionsDataSchema);
  }

  public describeFlowAction(
    request: CoreDescribeFlowActionRequest
  ): Promise<CoreFlowResponse<CoreDescribeFlowActionData>> {
    return this.post(DESCRIBE_ENDPOINT, request, coreDescribeFlowActionDataSchema);
  }

  public executeFlowAction(
    request: CoreExecuteFlowActionRequest
  ): Promise<CoreFlowResponse<CoreExecuteFlowActionData>> {
    return this.post(EXECUTE_ENDPOINT, request, coreExecuteFlowActionDataSchema);
  }

  private async post<TData>(
    endpoint: string,
    request: object,
    dataSchema: { safeParse(value: unknown): { success: true; data: TData } | { success: false } }
  ): Promise<CoreFlowResponse<TData>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response | undefined;
    let body: unknown;

    try {
      response = await this.fetchFn(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json'
        },
        body: JSON.stringify(request),
        signal: controller.signal
      });
      body = await response.json();
    } catch {
      if (controller.signal.aborted) {
        throw new McpToolError(
          ERROR_CODES.CORE_TIMEOUT,
          'O Core excedeu o tempo limite para responder.'
        );
      }

      if (response === undefined) {
        throw new McpToolError(
          ERROR_CODES.CORE_UNAVAILABLE,
          'O Core está indisponível para processar a solicitação.'
        );
      }

      throw new McpToolError(
        ERROR_CODES.CORE_CONTRACT_ERROR,
        'O Core retornou uma resposta inválida.'
      );
    } finally {
      clearTimeout(timeout);
    }

    const envelope = coreFlowResponseSchema.safeParse(body);
    if (!envelope.success) {
      throw new McpToolError(
        ERROR_CODES.CORE_CONTRACT_ERROR,
        'O Core retornou um envelope inválido.'
      );
    }

    if (!envelope.data.Success) return envelope.data;

    const data = dataSchema.safeParse(envelope.data.Data);
    if (!data.success) {
      throw new McpToolError(
        ERROR_CODES.CORE_CONTRACT_ERROR,
        'O Core retornou dados incompatíveis com o contrato da operação.'
      );
    }

    return {
      ...envelope.data,
      Data: data.data
    };
  }
}
