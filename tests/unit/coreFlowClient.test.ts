import { describe, expect, it, vi } from 'vitest';

import { CoreFlowClient } from '../../src/core/CoreFlowClient.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function fetchMock(): ReturnType<typeof vi.fn> & typeof fetch {
  return vi.fn() as unknown as ReturnType<typeof vi.fn> & typeof fetch;
}

const successEnvelope = {
  Success: true,
  ExecutionUUID: 'execution-1'
};

describe('CoreFlowClient', () => {
  it('normaliza a URL base e envia a requisição de listagem exata', async () => {
    const request = {
      ExecutionUUID: 'execution-1',
      IdCompany: 1003,
      IdProcessLine: 456
    };
    const fetchFn = fetchMock();
    fetchFn.mockResolvedValueOnce(jsonResponse({
      ...successEnvelope,
      Data: { Actions: [] }
    }));
    const client = new CoreFlowClient({
      baseUrl: 'http://core.internal///',
      timeoutMs: 1000,
      fetchFn
    });

    await expect(client.listFlowActions(request)).resolves.toEqual({
      ...successEnvelope,
      Data: { Actions: [] }
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith(
      'http://core.internal/v1/ai-document/flow-actions/list',
      expect.objectContaining({
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json'
        },
        body: JSON.stringify(request),
        signal: expect.any(AbortSignal)
      })
    );
  });

  it('envia describe com Action e execute com RequestUUID/Input exatos', async () => {
    const fetchFn = fetchMock();
    fetchFn
      .mockResolvedValueOnce(jsonResponse({
        ...successEnvelope,
        Data: {
          Action: 'create_sales_order',
          Description: 'Cria pedido.',
          Repeatable: false,
          Effect: 'EXTERNAL_WRITE',
          Available: true,
          ExecutionCount: 0,
          UnavailableReason: null,
          RequiredInputs: ['CustomerCode']
        }
      }))
      .mockResolvedValueOnce(jsonResponse({
        ...successEnvelope,
        Data: {
          Action: 'create_sales_order',
          Status: 'COMPLETED',
          MissingInformation: [],
          Output: ['created'],
          Invocation: {
            InvocationUUID: 'invocation-1',
            IdFlow: 11023,
            IdProcessLineFlow: 82361
          }
        }
      }));
    const client = new CoreFlowClient({
      baseUrl: 'http://core.internal',
      timeoutMs: 1000,
      fetchFn
    });

    await client.describeFlowAction({
      ExecutionUUID: 'execution-1',
      IdCompany: 1003,
      IdProcessLine: 456,
      Action: 'create_sales_order'
    });
    await client.executeFlowAction({
      ExecutionUUID: 'execution-1',
      IdCompany: 1003,
      IdProcessLine: 456,
      RequestUUID: 'request-1',
      Action: 'create_sales_order',
      Input: { CustomerCode: 'C000123' }
    });

    expect(fetchFn.mock.calls[0]?.[0]).toBe(
      'http://core.internal/v1/ai-document/flow-actions/describe'
    );
    expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({
        ExecutionUUID: 'execution-1',
        IdCompany: 1003,
        IdProcessLine: 456,
        Action: 'create_sales_order'
      })
    });
    expect(fetchFn.mock.calls[1]?.[0]).toBe(
      'http://core.internal/v1/ai-document/flow-actions/execute'
    );
    expect(fetchFn.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({
        ExecutionUUID: 'execution-1',
        IdCompany: 1003,
        IdProcessLine: 456,
        RequestUUID: 'request-1',
        Action: 'create_sales_order',
        Input: { CustomerCode: 'C000123' }
      })
    });
  });

  it.each([409, 422, 500])('preserva erro Core em HTTP %i', async (status) => {
    const fetchFn = fetchMock();
    fetchFn.mockResolvedValueOnce(jsonResponse({
      Success: false,
      ExecutionUUID: 'execution-1',
      Data: null,
      Error: {
        Code: 'EXTERNAL_SERVICE_ERROR',
        Message: 'Falha reportada pelo serviço externo.'
      }
    }, status));
    const client = new CoreFlowClient({
      baseUrl: 'http://core.internal',
      timeoutMs: 1000,
      fetchFn
    });

    await expect(client.listFlowActions({
      ExecutionUUID: 'execution-1',
      IdCompany: 1003,
      IdProcessLine: 456
    })).resolves.toEqual({
      Success: false,
      ExecutionUUID: 'execution-1',
      Data: null,
      Error: {
        Code: 'EXTERNAL_SERVICE_ERROR',
        Message: 'Falha reportada pelo serviço externo.'
      }
    });
  });

  it('converte timeout em CORE_TIMEOUT', async () => {
    const fetchFn = fetchMock();
    fetchFn.mockImplementationOnce((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const client = new CoreFlowClient({
      baseUrl: 'http://core.internal',
      timeoutMs: 5,
      fetchFn
    });

    await expect(client.listFlowActions({
      ExecutionUUID: 'execution-1',
      IdCompany: 1003,
      IdProcessLine: 456
    })).rejects.toMatchObject({ code: 'CORE_TIMEOUT' });
  });

  it('mantém o timeout ativo durante a leitura do body', async () => {
    const fetchFn = fetchMock();
    fetchFn.mockResolvedValueOnce({
      json: () => new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('body aborted')), 50);
      })
    } as Response);
    const client = new CoreFlowClient({
      baseUrl: 'http://core.internal',
      timeoutMs: 5,
      fetchFn
    });

    await expect(client.listFlowActions({
      ExecutionUUID: 'execution-1',
      IdCompany: 1003,
      IdProcessLine: 456
    })).rejects.toMatchObject({ code: 'CORE_TIMEOUT' });
  });

  it('converte falha de rede em CORE_UNAVAILABLE', async () => {
    const fetchFn = fetchMock();
    fetchFn.mockRejectedValueOnce(new Error('connection refused'));
    const client = new CoreFlowClient({
      baseUrl: 'http://core.internal',
      timeoutMs: 1000,
      fetchFn
    });

    await expect(client.listFlowActions({
      ExecutionUUID: 'execution-1',
      IdCompany: 1003,
      IdProcessLine: 456
    })).rejects.toMatchObject({ code: 'CORE_UNAVAILABLE' });
  });

  it('converte envelope ou Data malformado em CORE_CONTRACT_ERROR', async () => {
    const fetchFn = fetchMock();
    fetchFn
      .mockResolvedValueOnce(jsonResponse({ Success: true, Data: {} }))
      .mockResolvedValueOnce(jsonResponse({
        ...successEnvelope,
        Data: { Actions: [{ Action: 123, Description: 'inválida' }] }
      }));
    const client = new CoreFlowClient({
      baseUrl: 'http://core.internal',
      timeoutMs: 1000,
      fetchFn
    });

    const request = {
      ExecutionUUID: 'execution-1',
      IdCompany: 1003,
      IdProcessLine: 456
    };
    await expect(client.listFlowActions(request)).rejects.toMatchObject({
      code: 'CORE_CONTRACT_ERROR'
    });
    await expect(client.listFlowActions(request)).rejects.toMatchObject({
      code: 'CORE_CONTRACT_ERROR'
    });
  });

  it('exige Effect válido, Status e MissingInformation no contrato Core', async () => {
    const fetchFn = fetchMock();
    fetchFn
      .mockResolvedValueOnce(jsonResponse({ ...successEnvelope, Data: {
        Action: 'set_carrier', Description: 'Define transportadora.', Repeatable: true,
        Effect: 'UNKNOWN', Available: true, ExecutionCount: 0,
        UnavailableReason: null, RequiredInputs: ['Value']
      } }))
      .mockResolvedValueOnce(jsonResponse({ ...successEnvelope, Data: {
        Action: 'set_carrier', Output: null,
        Invocation: { InvocationUUID: 'invocation-1', IdFlow: 1, IdProcessLineFlow: 2 }
      } }))
      .mockResolvedValueOnce(jsonResponse({ ...successEnvelope, Data: {
        Action: 'set_carrier', Status: 'NEEDS_INPUT', Output: null,
        Invocation: { InvocationUUID: 'invocation-1', IdFlow: 1, IdProcessLineFlow: 2 }
      } }));
    const client = new CoreFlowClient({ baseUrl: 'http://core.internal', timeoutMs: 1000, fetchFn });
    const context = { ExecutionUUID: 'execution-1', IdCompany: 1003, IdProcessLine: 456 };
    await expect(client.describeFlowAction({ ...context, Action: 'set_carrier' })).rejects.toMatchObject({ code: 'CORE_CONTRACT_ERROR' });
    for (let index = 0; index < 2; index++) {
      await expect(client.executeFlowAction({ ...context, RequestUUID: 'request-1', Action: 'set_carrier', Input: {} }))
        .rejects.toMatchObject({ code: 'CORE_CONTRACT_ERROR' });
    }
  });

  it('rejeita FAILED em envelope de sucesso sem fazer retry', async () => {
    const fetchFn = fetchMock();
    fetchFn.mockResolvedValueOnce(jsonResponse({
      ...successEnvelope,
      Data: {
        Action: 'set_carrier', Status: 'FAILED', MissingInformation: [], Output: null,
        Invocation: { InvocationUUID: 'invocation-1', IdFlow: 1, IdProcessLineFlow: 2 }
      }
    }));
    const client = new CoreFlowClient({ baseUrl: 'http://core.internal', timeoutMs: 1000, fetchFn });

    await expect(client.executeFlowAction({
      ExecutionUUID: 'execution-1', IdCompany: 1003, IdProcessLine: 456,
      RequestUUID: 'request-1', Action: 'set_carrier', Input: {}
    })).rejects.toMatchObject({ code: 'CORE_CONTRACT_ERROR' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('não faz retry automático de execute', async () => {
    const fetchFn = fetchMock();
    fetchFn.mockRejectedValue(new Error('timeout after write'));
    const client = new CoreFlowClient({
      baseUrl: 'http://core.internal',
      timeoutMs: 1000,
      fetchFn
    });

    await expect(client.executeFlowAction({
      ExecutionUUID: 'execution-1',
      IdCompany: 1003,
      IdProcessLine: 456,
      RequestUUID: 'request-1',
      Action: 'create_sales_order',
      Input: {}
    })).rejects.toMatchObject({ code: 'CORE_UNAVAILABLE' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
