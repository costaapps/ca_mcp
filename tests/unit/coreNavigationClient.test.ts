import { describe, expect, it, vi } from 'vitest';

import { CoreNavigationClient } from '../../src/core/CoreNavigationClient.js';
import { canonicalRequestHandoffSuccess } from '../fixtures/coreNavigationContracts.js';

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

const context = {
  ExecutionUUID: 'execution-1',
  IdCompany: 1003,
  IdProcessLine: 456
};

describe('CoreNavigationClient', () => {
  it('envia a listagem para o endpoint correto e aceita lista vazia', async () => {
    const fetchFn = fetchMock();
    fetchFn.mockResolvedValueOnce(jsonResponse({
      ...successEnvelope,
      Data: { Destinations: [] }
    }));
    const client = new CoreNavigationClient({
      baseUrl: 'http://core.internal///',
      timeoutMs: 1000,
      fetchFn
    });

    await expect(client.listNavigationDestinations(context)).resolves.toEqual({
      ...successEnvelope,
      Data: { Destinations: [] }
    });
    expect(fetchFn).toHaveBeenCalledWith(
      'http://core.internal/v1/agent-platform/navigation/destinations/list',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(context),
        signal: expect.any(AbortSignal)
      })
    );
  });

  it('envia request_handoff com RequestUUID e contrato sem IDs técnicos', async () => {
    const fetchFn = fetchMock();
    fetchFn.mockResolvedValueOnce(jsonResponse(canonicalRequestHandoffSuccess));
    const client = new CoreNavigationClient({
      baseUrl: 'http://core.internal',
      timeoutMs: 1000,
      fetchFn
    });
    const request = {
      ...context,
      RequestUUID: 'request-1',
      DestinationRef: 'nav_opaque',
      Reason: 'Intenção de compra',
      Summary: 'Cliente deseja consultar memória RAM.'
    };

    await expect(client.requestHandoff(request)).resolves.toEqual(canonicalRequestHandoffSuccess);
    expect(fetchFn.mock.calls[0]?.[0]).toBe(
      'http://core.internal/v1/agent-platform/navigation/handoffs/request'
    );
    const body = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toEqual(request);
    expect(body).not.toHaveProperty('TurnUUID');
    expect(body).not.toHaveProperty('IdCompanyMenu');
    expect(body).not.toHaveProperty('IdCompanyModule');
  });

  it('preserva erro de negócio do Core, inclusive código externo', async () => {
    const fetchFn = fetchMock();
    fetchFn.mockResolvedValueOnce(jsonResponse({
      Success: false,
      ExecutionUUID: 'execution-1',
      Data: null,
      Error: {
        Code: 'NAVIGATION_DESTINATION_NOT_AVAILABLE',
        Message: 'O destino não está mais disponível.'
      }
    }, 409));
    const client = new CoreNavigationClient({
      baseUrl: 'http://core.internal',
      timeoutMs: 1000,
      fetchFn
    });

    await expect(client.requestHandoff({
      ...context,
      RequestUUID: 'request-1',
      DestinationRef: 'nav_opaque',
      Reason: 'Navegação',
      Summary: 'Solicitação de handoff.'
    })).resolves.toEqual({
      Success: false,
      ExecutionUUID: 'execution-1',
      Data: null,
      Error: {
        Code: 'NAVIGATION_DESTINATION_NOT_AVAILABLE',
        Message: 'O destino não está mais disponível.'
      }
    });
  });

  it('converte timeout de rede e timeout durante leitura do body', async () => {
    const networkFetch = fetchMock();
    networkFetch.mockImplementationOnce((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const networkClient = new CoreNavigationClient({
      baseUrl: 'http://core.internal',
      timeoutMs: 5,
      fetchFn: networkFetch
    });

    await expect(networkClient.listNavigationDestinations(context)).rejects.toMatchObject({
      code: 'CORE_TIMEOUT'
    });

    const bodyFetch = fetchMock();
    bodyFetch.mockResolvedValueOnce({
      json: () => new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('body aborted')), 50);
      })
    } as Response);
    const bodyClient = new CoreNavigationClient({
      baseUrl: 'http://core.internal',
      timeoutMs: 5,
      fetchFn: bodyFetch
    });

    await expect(bodyClient.listNavigationDestinations(context)).rejects.toMatchObject({
      code: 'CORE_TIMEOUT'
    });
  });

  it('converte indisponibilidade e contrato inválido', async () => {
    const unavailableFetch = fetchMock();
    unavailableFetch.mockRejectedValueOnce(new Error('connection refused'));
    const unavailableClient = new CoreNavigationClient({
      baseUrl: 'http://core.internal',
      timeoutMs: 1000,
      fetchFn: unavailableFetch
    });

    await expect(unavailableClient.listNavigationDestinations(context)).rejects.toMatchObject({
      code: 'CORE_UNAVAILABLE'
    });

    const invalidFetch = fetchMock();
    invalidFetch.mockResolvedValueOnce(jsonResponse({
      ...successEnvelope,
      Data: {
        Destinations: [{
          DestinationRef: 'nav_invalid',
          Kind: 'OTHER',
          Description: 'Inválido',
          MenuGroup: null,
          Keywords: null
        }]
      }
    }));
    const invalidClient = new CoreNavigationClient({
      baseUrl: 'http://core.internal',
      timeoutMs: 1000,
      fetchFn: invalidFetch
    });

    await expect(invalidClient.listNavigationDestinations(context)).rejects.toMatchObject({
      code: 'CORE_CONTRACT_ERROR'
    });
  });

  it('converte JSON inválido e envelope inválido em erro de contrato', async () => {
    const invalidJsonFetch = fetchMock();
    invalidJsonFetch.mockResolvedValueOnce({
      json: () => Promise.reject(new SyntaxError('JSON inválido'))
    } as Response);
    const invalidJsonClient = new CoreNavigationClient({
      baseUrl: 'http://core.internal',
      timeoutMs: 1000,
      fetchFn: invalidJsonFetch
    });

    await expect(invalidJsonClient.listNavigationDestinations(context)).rejects.toMatchObject({
      code: 'CORE_CONTRACT_ERROR'
    });

    const invalidEnvelopeFetch = fetchMock();
    invalidEnvelopeFetch.mockResolvedValueOnce(jsonResponse({
      Success: true,
      Data: { Destinations: [] }
    }));
    const invalidEnvelopeClient = new CoreNavigationClient({
      baseUrl: 'http://core.internal',
      timeoutMs: 1000,
      fetchFn: invalidEnvelopeFetch
    });

    await expect(invalidEnvelopeClient.listNavigationDestinations(context)).rejects.toMatchObject({
      code: 'CORE_CONTRACT_ERROR'
    });
  });

  it('rejeita o contrato canônico de handoff quando Destination desaparece', async () => {
    const fetchFn = fetchMock();
    const invalidResponse = structuredClone(canonicalRequestHandoffSuccess);
    delete (invalidResponse.Data as { Destination?: string }).Destination;
    fetchFn.mockResolvedValueOnce(jsonResponse(invalidResponse));
    const client = new CoreNavigationClient({
      baseUrl: 'http://core.internal',
      timeoutMs: 1000,
      fetchFn
    });

    await expect(client.requestHandoff({
      ...context,
      RequestUUID: 'request-1',
      DestinationRef: 'random-opaque-reference',
      Reason: 'Navegação',
      Summary: 'Solicitação de handoff.'
    })).rejects.toMatchObject({ code: 'CORE_CONTRACT_ERROR' });
  });

  it('rejeita resposta de handoff sem HandoffUUID interno', async () => {
    const fetchFn = fetchMock();
    const invalidResponse = structuredClone(canonicalRequestHandoffSuccess);
    delete (invalidResponse.Data as { HandoffUUID?: string }).HandoffUUID;
    fetchFn.mockResolvedValueOnce(jsonResponse(invalidResponse));
    const client = new CoreNavigationClient({
      baseUrl: 'http://core.internal',
      timeoutMs: 1000,
      fetchFn
    });

    await expect(client.requestHandoff({
      ...context,
      RequestUUID: 'request-1',
      DestinationRef: 'random-opaque-reference',
      Reason: 'Navegação',
      Summary: 'Solicitação de handoff.'
    })).rejects.toMatchObject({ code: 'CORE_CONTRACT_ERROR' });
  });

  it('não faz retry automático de request_handoff', async () => {
    const fetchFn = fetchMock();
    fetchFn.mockImplementationOnce((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('timeout after write')));
    }));
    const client = new CoreNavigationClient({
      baseUrl: 'http://core.internal',
      timeoutMs: 5,
      fetchFn
    });

    await expect(client.requestHandoff({
      ...context,
      RequestUUID: 'request-1',
      DestinationRef: 'nav_opaque',
      Reason: 'Navegação',
      Summary: 'Solicitação de handoff.'
    })).rejects.toMatchObject({ code: 'CORE_TIMEOUT' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
