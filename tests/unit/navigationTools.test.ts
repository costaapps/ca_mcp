import type { CallToolResult, McpServer, ServerContext } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';

import type { CoreNavigationClientContract } from '../../src/core/contracts.js';
import { listNavigationDestinationsInputSchema } from '../../src/mcp/tools/listNavigationDestinations.js';
import { registerListNavigationDestinationsTool } from '../../src/mcp/tools/listNavigationDestinations.js';
import { registerRequestHandoffTool, requestHandoffInputSchema } from '../../src/mcp/tools/requestHandoff.js';
import type { McpLogger } from '../../src/mcp/logger.js';

function contextWithMeta(meta: unknown): ServerContext {
  return {
    mcpReq: {
      id: 1,
      method: 'tools/call',
      _meta: meta as never,
      requestState: (() => undefined) as ServerContext['mcpReq']['requestState'],
      signal: new AbortController().signal
    } as unknown as ServerContext['mcpReq']
  } as ServerContext;
}

function captureCallback(register: (server: McpServer) => void):
  (arguments_: unknown, ctx: ServerContext) => Promise<CallToolResult> {
  const registerTool = vi.fn();
  register({ registerTool } as unknown as McpServer);
  const callback = registerTool.mock.calls[0]?.[2];
  if (typeof callback !== 'function') throw new Error('Tool não foi registrada.');
  return callback as (arguments_: unknown, ctx: ServerContext) => Promise<CallToolResult>;
}

function logger(): McpLogger {
  return {
    toolCompleted: vi.fn(),
    serverError: vi.fn()
  };
}

function coreClient(overrides: Partial<CoreNavigationClientContract> = {}): CoreNavigationClientContract {
  return {
    listNavigationDestinations: vi.fn(),
    requestHandoff: vi.fn(),
    ...overrides
  };
}

const executionMeta = {
  ca: {
    Execution: {
      ExecutionUUID: 'execution-1',
      TurnUUID: 'turn-1',
      IdCompany: 1003,
      IdProcessLine: 456,
      IdCompanyModule: 999
    }
  }
};

describe('Navigation MCP tools', () => {
  it('list_navigation_destinations aceita input vazio, MENU/HOME e lista vazia', async () => {
    const listNavigationDestinations = vi.fn().mockResolvedValue({
      Success: true,
      ExecutionUUID: 'execution-1',
      Data: {
        Destinations: [
          {
            DestinationRef: 'nav_opaque/menu%2Fsales',
            Kind: 'MENU',
            Description: 'Vendas',
            MenuGroup: 'Atendimento',
            Keywords: 'comprar produto'
          },
          {
            DestinationRef: 'nav_opaque/home',
            Kind: 'HOME',
            Description: 'Início',
            MenuGroup: null,
            Keywords: null
          }
        ]
      }
    });
    const log = logger();
    const callback = captureCallback((server) => registerListNavigationDestinationsTool(server, {
      coreNavigationClient: coreClient({ listNavigationDestinations }),
      logger: log
    }));

    const result = await callback({}, contextWithMeta(executionMeta));

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      Destinations: [
        {
          DestinationRef: 'nav_opaque/menu%2Fsales',
          Kind: 'MENU',
          Description: 'Vendas',
          MenuGroup: 'Atendimento',
          Keywords: 'comprar produto'
        },
        {
          DestinationRef: 'nav_opaque/home',
          Kind: 'HOME',
          Description: 'Início',
          MenuGroup: null,
          Keywords: null
        }
      ]
    });
    expect(listNavigationDestinations).toHaveBeenCalledWith({
      ExecutionUUID: 'execution-1',
      IdCompany: 1003,
      IdProcessLine: 456
    });
    expect(log.toolCompleted).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'list_navigation_destinations',
      success: true,
      ExecutionUUID: 'execution-1',
      TurnUUID: 'turn-1'
    }));

    vi.mocked(listNavigationDestinations).mockResolvedValueOnce({
      Success: true,
      ExecutionUUID: 'execution-1',
      Data: { Destinations: [] }
    });
    await expect(callback({}, contextWithMeta(executionMeta))).resolves.toMatchObject({
      structuredContent: { Destinations: [] }
    });
  });

  it('list_navigation_destinations exige todo o contexto confiável e não consulta Core sem ele', async () => {
    const listNavigationDestinations = vi.fn();
    const callback = captureCallback((server) => registerListNavigationDestinationsTool(server, {
      coreNavigationClient: coreClient({ listNavigationDestinations }),
      logger: logger()
    }));

    const result = await callback({}, contextWithMeta({
      ca: { Execution: { ExecutionUUID: 'execution-1', IdCompany: 1003, IdProcessLine: 456 } }
    }));

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      Code: 'MISSING_CONTEXT',
      Required: 'Execution.TurnUUID'
    });
    expect(listNavigationDestinations).not.toHaveBeenCalled();
  });

  it('request_handoff gera RequestUUID, encaminha apenas contrato permitido e registra HandoffUUID', async () => {
    const requestHandoff = vi.fn().mockResolvedValue({
      Success: true,
      ExecutionUUID: 'execution-1',
      Data: {
        Accepted: true,
        Destination: 'Vendas',
        Status: 'REQUESTED',
        HandoffUUID: 'handoff-1'
      }
    });
    const log = logger();
    const callback = captureCallback((server) => registerRequestHandoffTool(server, {
      coreNavigationClient: coreClient({ requestHandoff }),
      logger: log,
      requestUUID: () => 'request-1'
    }));

    const result = await callback({
      DestinationRef: 'nav_opaque/menu%2Fsales',
      Reason: 'Intenção inequívoca de compra',
      Summary: 'Cliente quer comprar memória RAM.'
    }, contextWithMeta(executionMeta));

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      Accepted: true,
      Destination: 'Vendas',
      Status: 'REQUESTED'
    });
    expect(result.structuredContent).not.toHaveProperty('HandoffUUID');
    expect(requestHandoff).toHaveBeenCalledWith({
      ExecutionUUID: 'execution-1',
      IdCompany: 1003,
      IdProcessLine: 456,
      RequestUUID: 'request-1',
      DestinationRef: 'nav_opaque/menu%2Fsales',
      Reason: 'Intenção inequívoca de compra',
      Summary: 'Cliente quer comprar memória RAM.'
    });
    expect(log.toolCompleted).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'request_handoff',
      success: true,
      RequestUUID: 'request-1',
      HandoffUUID: 'handoff-1'
    }));
  });

  it('request_handoff exige DestinationRef e não aceita IDs técnicos como roteamento', async () => {
    const requestHandoff = vi.fn();
    const callback = captureCallback((server) => registerRequestHandoffTool(server, {
      coreNavigationClient: coreClient({ requestHandoff }),
      logger: logger(),
      requestUUID: () => 'request-1'
    }));

    const missingDestination = await callback({
      Reason: 'Navegação',
      Summary: 'Solicitação.'
    }, contextWithMeta(executionMeta));
    expect(missingDestination.isError).toBe(true);
    expect(requestHandoffInputSchema.safeParse({
      DestinationRef: '',
      Reason: 'Navegação',
      Summary: 'Solicitação.'
    }).success).toBe(false);

    const technicalId = await callback({
      IdCompanyMenu: 123,
      Reason: 'Navegação',
      Summary: 'Solicitação.'
    }, contextWithMeta(executionMeta));
    expect(technicalId.isError).toBe(true);
    expect(requestHandoff).not.toHaveBeenCalled();
  });

  it('request_handoff preserva erro de destino indisponível e exige contexto', async () => {
    const requestHandoff = vi.fn().mockResolvedValue({
      Success: false,
      ExecutionUUID: 'execution-1',
      Data: null,
      Error: {
        Code: 'NAVIGATION_DESTINATION_NOT_AVAILABLE',
        Message: 'O destino não está mais disponível.'
      }
    });
    const callback = captureCallback((server) => registerRequestHandoffTool(server, {
      coreNavigationClient: coreClient({ requestHandoff }),
      logger: logger(),
      requestUUID: () => 'request-1'
    }));

    const businessFailure = await callback({
      DestinationRef: 'nav_opaque',
      Reason: 'Navegação',
      Summary: 'Solicitação.'
    }, contextWithMeta(executionMeta));
    expect(businessFailure.isError).toBe(true);
    expect(businessFailure.structuredContent).toEqual({
      Code: 'NAVIGATION_DESTINATION_NOT_AVAILABLE'
    });
    expect(businessFailure.content).toEqual([
      { type: 'text', text: 'O destino não está mais disponível.' }
    ]);

    const missingContext = await callback({
      DestinationRef: 'nav_opaque',
      Reason: 'Navegação',
      Summary: 'Solicitação.'
    }, contextWithMeta(undefined));
    expect(missingContext.isError).toBe(true);
    expect(missingContext.structuredContent).toEqual({
      Code: 'MISSING_CONTEXT',
      Required: 'Execution.ExecutionUUID'
    });
  });

  it('rejeita contrato inválido retornado pelo Core', async () => {
    const listNavigationDestinations = vi.fn().mockResolvedValue({
      Success: true,
      ExecutionUUID: 'execution-1',
      Data: {
        Destinations: [{
          DestinationRef: 'nav_opaque',
          Kind: 'MENU',
          Description: 'Vendas',
          MenuGroup: null,
          Keywords: null,
          IdCompanyModule: 123
        }]
      }
    });
    const callback = captureCallback((server) => registerListNavigationDestinationsTool(server, {
      coreNavigationClient: coreClient({ listNavigationDestinations }),
      logger: logger()
    }));

    const result = await callback({}, contextWithMeta(executionMeta));
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ Code: 'CORE_CONTRACT_ERROR' });
  });

  it('não expõe IDs técnicos na entrada da listagem', () => {
    expect(listNavigationDestinationsInputSchema.safeParse({ IdCompanyMenu: 1 }).success).toBe(false);
    expect(requestHandoffInputSchema.safeParse({
      DestinationRef: 'nav_opaque',
      Reason: 'Navegação',
      Summary: 'Solicitação.',
      IdCompanyModule: 2
    }).success).toBe(false);
  });
});
