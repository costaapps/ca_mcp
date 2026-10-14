import type { CallToolResult, McpServer, ServerContext } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';

import type {
  CoreFlowClientContract,
  JsonValue
} from '../../src/core/contracts.js';
import { describeFlowActionOutputSchema, registerDescribeFlowActionTool } from '../../src/mcp/tools/describeFlowAction.js';
import { executeFlowActionOutputSchema, registerExecuteFlowActionTool } from '../../src/mcp/tools/executeFlowAction.js';
import { registerListFlowActionsTool } from '../../src/mcp/tools/listFlowActions.js';
import type { McpLogger } from '../../src/mcp/logger.js';
import { addTenantUUID, createTenantFixture } from '../fixtures/tenantContext.js';

function contextWithMeta(meta: unknown): ServerContext {
  return {
    mcpReq: {
      id: 1,
      method: 'tools/call',
      _meta: addTenantUUID(meta) as never,
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

const executionMeta = {
  ca: {
    Execution: {
      ExecutionUUID: 'execution-1',
      TurnUUID: 'turn-1',
      IdCompany: 1003,
      IdDatabase: 22,
      IdProcessLine: 456,
      IdProcessLineFlow: 999
    }
  }
};

function coreClient(overrides: Partial<CoreFlowClientContract> = {}): CoreFlowClientContract {
  return {
    listFlowActions: vi.fn(),
    describeFlowAction: vi.fn(),
    executeFlowAction: vi.fn(),
    ...overrides
  };
}

function toolDependencies(
  coreFlowClient: CoreFlowClientContract,
  log: McpLogger,
  requestUUID?: () => string
) {
  return {
    tenantContextProvider: createTenantFixture({ coreFlowClient }).provider,
    logger: log,
    ...(requestUUID === undefined ? {} : { requestUUID })
  };
}

describe('Flow MCP tools', () => {
  it.each([
    {},
    { ObjectDescription: null },
    { ObjectDescription: '' },
    { ObjectDescription: 'Resposta deve estar toda em maiúsculo' },
    { ObjectDescription: '  Orientação empresarial livre.\nNão resumir: ç / "Value".  ' }
  ])('describe preserva ObjectDescription em structuredContent: %j', async (description) => {
    const data = {
      Action: 'inform_code', Description: 'Informar código.', Repeatable: true,
      Effect: 'WRITE', Available: true, ExecutionCount: 0,
      UnavailableReason: null, RequiredInputs: ['Value'],
      ...description
    };
    const describeFlowAction = vi.fn().mockResolvedValue({
      Success: true, ExecutionUUID: 'execution-1',
      Data: { ...data, IdFlow: 123, ObjectType: 'PROMPT', DataType: 'string' }
    });
    const log = logger();
    const callback = captureCallback((server) => registerDescribeFlowActionTool(server,
      toolDependencies(coreClient({ describeFlowAction }), log)));

    const result = await callback({ Action: 'inform_code' }, contextWithMeta(executionMeta));

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(data);
    expect(result._meta).toBeUndefined();
    expect(describeFlowAction).toHaveBeenCalledWith({
      ExecutionUUID: 'execution-1', IdCompany: 1003, IdProcessLine: 456, Action: 'inform_code'
    });
    expect(log.toolCompleted).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'describe_flow_action', durationMs: expect.any(Number), success: true,
      ExecutionUUID: 'execution-1', TurnUUID: 'turn-1',
      CompanyUUID: '550e8400-e29b-41d4-a716-446655440000', IdCompany: 1003, IdDatabase: 22
    }));
    expect(log.serverError).not.toHaveBeenCalled();
    if (!('ObjectDescription' in description)) {
      expect(result.structuredContent).not.toHaveProperty('ObjectDescription');
    }
  });

  it.each([123, {}, []])('o schema da tool rejeita ObjectDescription inválido: %j', (value) => {
    expect(describeFlowActionOutputSchema.safeParse({
      Action: 'inform_code', Description: 'Informar código.', ObjectDescription: value,
      Repeatable: true, Effect: 'WRITE', Available: true, ExecutionCount: 0,
      UnavailableReason: null, RequiredInputs: ['Value']
    }).success).toBe(false);
  });

  it('list_flow_actions aceita input vazio, retorna lista vazia e registra sucesso', async () => {
    const listFlowActions = vi.fn().mockResolvedValue({
      Success: true,
      ExecutionUUID: 'execution-1',
      Data: { Actions: [] }
    });
    const log = logger();
    const callback = captureCallback((server) => registerListFlowActionsTool(server,
      toolDependencies(coreClient({ listFlowActions }), log)));

    const result = await callback({}, contextWithMeta(executionMeta));

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ Actions: [] });
    expect(listFlowActions).toHaveBeenCalledWith({
      ExecutionUUID: 'execution-1',
      IdCompany: 1003,
      IdProcessLine: 456
    });
    expect(log.toolCompleted).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'list_flow_actions',
      success: true,
      ExecutionUUID: 'execution-1',
      TurnUUID: 'turn-1'
    }));
  });

  it('list_flow_actions mantém as capabilities devolvidas pelo Core sem consultar banco', async () => {
    const actions = [{
      Action: 'get_customer_details',
      Description: 'Consulta cliente.',
      IdFlow: 123,
      ObjectType: 'AUTO'
    }];
    const listFlowActions = vi.fn().mockResolvedValue({
      Success: true,
      ExecutionUUID: 'execution-1',
      Data: { Actions: actions }
    });
    const callback = captureCallback((server) => registerListFlowActionsTool(server,
      toolDependencies(coreClient({ listFlowActions }), logger())));

    const result = await callback({}, contextWithMeta(executionMeta));

    expect(result.structuredContent).toEqual({ Actions: [{
      Action: 'get_customer_details', Description: 'Consulta cliente.'
    }] });
  });

  it('describe_flow_action retorna RequiredInputs e trata Available=false como sucesso', async () => {
    const describeFlowAction = vi.fn().mockResolvedValue({
      Success: true,
      ExecutionUUID: 'execution-1',
      Data: {
        Action: 'create_sales_order',
        Description: 'Cria o pedido.',
        Repeatable: false,
        Effect: 'EXTERNAL_WRITE',
        Available: false,
        ExecutionCount: 1,
        UnavailableReason: 'Já executada.',
        RequiredInputs: ['CustomerCode', 'Items']
      }
    });
    const callback = captureCallback((server) => registerDescribeFlowActionTool(server,
      toolDependencies(coreClient({ describeFlowAction }), logger())));

    const result = await callback(
      { Action: 'create_sales_order' },
      contextWithMeta(executionMeta)
    );

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      Action: 'create_sales_order',
      Description: 'Cria o pedido.',
      Repeatable: false,
      Effect: 'EXTERNAL_WRITE',
      Available: false,
      ExecutionCount: 1,
      UnavailableReason: 'Já executada.',
      RequiredInputs: ['CustomerCode', 'Items']
    });
    expect(describeFlowAction).toHaveBeenCalledWith({
      ExecutionUUID: 'execution-1',
      IdCompany: 1003,
      IdProcessLine: 456,
      Action: 'create_sales_order'
    });
  });

  it.each([
    { name: 'objeto', value: { DocEntry: 123 } },
    { name: 'array', value: [{ ItemCode: 'A' }] },
    { name: 'string', value: 'created' },
    { name: 'number', value: 123.45 },
    { name: 'boolean', value: true },
    { name: 'null', value: null }
  ])('execute_flow_action preserva Output %s', async ({ value }) => {
    const executeFlowAction = vi.fn().mockResolvedValue({
      Success: true,
      ExecutionUUID: 'execution-1',
      Data: {
        Action: 'create_sales_order',
        Status: 'COMPLETED',
        MissingInformation: [],
        Output: value as JsonValue,
        Invocation: {
          InvocationUUID: 'invocation-1',
          IdFlow: 11023,
          IdProcessLineFlow: 82361
        }
      }
    });
    const callback = captureCallback((server) => registerExecuteFlowActionTool(server,
      toolDependencies(coreClient({ executeFlowAction }), logger(), () => 'request-1')));

    const result = await callback({
      Action: 'create_sales_order',
      Input: {}
    }, contextWithMeta(executionMeta));

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      Success: true,
      Action: 'create_sales_order',
      Status: 'COMPLETED',
      MissingInformation: [],
      Output: value
    });
    expect(result.structuredContent).not.toHaveProperty('Invocation');
    expect(result._meta).toEqual({
      ca: {
        FlowInvocation: {
          InvocationUUID: 'invocation-1',
          IdFlow: 11023,
          IdProcessLineFlow: 82361
        }
      }
    });
    expect(executeFlowAction).toHaveBeenCalledWith({
      ExecutionUUID: 'execution-1',
      IdCompany: 1003,
      IdProcessLine: 456,
      RequestUUID: 'request-1',
      Action: 'create_sales_order',
      Input: {}
    });
  });

  it('execute_flow_action retorna NEEDS_INPUT sem erro e preserva candidatos e Invocation em meta', async () => {
    const output = {
      Status: 'AMBIGUOUS',
      RequestedValue: 'jadlog',
      Candidates: [{ Value: '12', Label: 'Jadlog' }, { Value: '18', Label: 'Jadlog Transportes' }]
    };
    const executeFlowAction = vi.fn().mockResolvedValue({
      Success: true,
      ExecutionUUID: 'execution-1',
      Data: {
        Action: 'set_carrier', Status: 'NEEDS_INPUT', MissingInformation: ['Value'], Output: output,
        Invocation: { InvocationUUID: 'invocation-2', IdFlow: 3, IdProcessLineFlow: 4 }
      }
    });
    const callback = captureCallback((server) => registerExecuteFlowActionTool(server,
      toolDependencies(coreClient({ executeFlowAction }), logger(), () => 'request-2')));

    const result = await callback({ Action: 'set_carrier', Input: { Value: 'jadlog' } }, contextWithMeta(executionMeta));

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      Success: true, Action: 'set_carrier', Status: 'NEEDS_INPUT', MissingInformation: ['Value'], Output: output
    });
    expect(result._meta).toEqual({ ca: { FlowInvocation: {
      InvocationUUID: 'invocation-2', IdFlow: 3, IdProcessLineFlow: 4
    } } });
    expect(executeFlowAction).toHaveBeenCalledTimes(1);
  });

  it('o schema público rejeita FAILED em sucesso e aceita o envelope de falha', () => {
    expect(executeFlowActionOutputSchema.safeParse({
      Success: true, Action: 'set_carrier', Status: 'FAILED', MissingInformation: [], Output: null
    }).success).toBe(false);
    expect(executeFlowActionOutputSchema.safeParse({
      Success: false, Action: 'set_carrier', Output: null,
      Error: { Code: 'FLOW_ACTION_ERROR', Message: 'Não foi possível executar a capability.' }
    }).success).toBe(true);
  });

  it('execute_flow_action preserva código/mensagem de erro externo no envelope funcional', async () => {
    const executeFlowAction = vi.fn().mockResolvedValue({
      Success: false,
      ExecutionUUID: 'execution-1',
      Data: null,
      Error: {
        Code: 'EXTERNAL_SERVICE_ERROR',
        Message: 'Falha retornada pelo serviço externo.'
      }
    });
    const log = logger();
    const callback = captureCallback((server) => registerExecuteFlowActionTool(server,
      toolDependencies(coreClient({ executeFlowAction }), log, () => 'request-1')));

    const result = await callback({
      Action: 'create_sales_order',
      Input: { CustomerCode: 'C000123' }
    }, contextWithMeta(executionMeta));

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      Success: false,
      Action: 'create_sales_order',
      Output: null,
      Error: {
        Code: 'EXTERNAL_SERVICE_ERROR',
        Message: 'Falha retornada pelo serviço externo.'
      }
    });
    const content = result.content[0];
    if (content?.type !== 'text') throw new Error('Envelope de falha deve ser texto JSON.');
    expect(JSON.parse(content.text)).toEqual(result.structuredContent);
    expect(log.toolCompleted).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'execute_flow_action',
      success: false,
      errorCode: 'EXTERNAL_SERVICE_ERROR'
    }));
  });

  it('falha de contexto do execute também não chama o Core', async () => {
    const executeFlowAction = vi.fn();
    const callback = captureCallback((server) => registerExecuteFlowActionTool(server,
      toolDependencies(coreClient({ executeFlowAction }), logger(), () => 'request-1')));

    const result = await callback({
      Action: 'create_sales_order',
      Input: {}
    }, contextWithMeta({ ca: { Execution: { IdCompany: 1003, IdProcessLine: 456 } } }));

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      Success: false,
      Action: 'create_sales_order',
      Output: null,
      Error: {
        Code: 'MISSING_CONTEXT',
        Message: 'Contexto obrigatório ausente: Execution.ExecutionUUID'
      }
    });
    const content = result.content[0];
    if (content?.type !== 'text') throw new Error('Envelope de falha deve ser texto JSON.');
    expect(JSON.parse(content.text)).toEqual(result.structuredContent);
    expect(executeFlowAction).not.toHaveBeenCalled();
  });
});
