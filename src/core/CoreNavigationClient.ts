import { McpToolError } from '../errors/McpToolError.js';
import { ERROR_CODES } from '../errors/errorCodes.js';
import type {
  CoreListNavigationDestinationsData,
  CoreListNavigationDestinationsRequest,
  CoreNavigationClientContract,
  CoreNavigationResponse,
  CoreRequestHandoffData,
  CoreRequestHandoffRequest
} from './contracts.js';
import {
  coreListNavigationDestinationsDataSchema,
  coreNavigationResponseSchema,
  coreRequestHandoffDataSchema
} from './schemas.js';

export interface CoreNavigationClientOptions {
  baseUrl: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
}

const LIST_ENDPOINT = '/v1/agent-platform/navigation/destinations/list';
const HANDOFF_ENDPOINT = '/v1/agent-platform/navigation/handoffs/request';

export class CoreNavigationClient implements CoreNavigationClientContract {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  public constructor(options: CoreNavigationClientOptions) {
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new Error('CORE_API_TIMEOUT_MS deve ser um inteiro positivo.');
    }

    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  public listNavigationDestinations(
    request: CoreListNavigationDestinationsRequest
  ): Promise<CoreNavigationResponse<CoreListNavigationDestinationsData>> {
    return this.post(
      LIST_ENDPOINT,
      request,
      coreListNavigationDestinationsDataSchema
    );
  }

  public requestHandoff(
    request: CoreRequestHandoffRequest
  ): Promise<CoreNavigationResponse<CoreRequestHandoffData>> {
    return this.post(HANDOFF_ENDPOINT, request, coreRequestHandoffDataSchema);
  }

  private async post<TData>(
    endpoint: string,
    request: object,
    dataSchema: { safeParse(value: unknown): { success: true; data: TData } | { success: false } }
  ): Promise<CoreNavigationResponse<TData>> {
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

    const envelope = coreNavigationResponseSchema.safeParse(body);
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

export const coreNavigationClientInternals = {
  LIST_ENDPOINT,
  HANDOFF_ENDPOINT
};
