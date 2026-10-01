import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CoreFlowClient } from '../../src/core/CoreFlowClient.js';

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Porta indisponível.');
    resolve(address.port);
  }));
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function bodyOf(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function respond(response: ServerResponse, data: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ Success: true, ExecutionUUID: 'execution-1', Data: data }));
}

describe('ponte HTTP MCP → Core para capabilities Agentic', () => {
  it('lista, descreve e executa capabilities, preserva falhas e rejeita status de sucesso inválido', async () => {
    const requests: Array<{ path: string | undefined; body: Record<string, unknown> }> = [];
    const core = createServer((request, response) => {
      void bodyOf(request).then((body) => {
        requests.push({ path: request.url, body });
        if (request.url?.endsWith('/list')) {
          respond(response, { Actions: [
            { Action: 'find_customer', Description: 'Consulta cliente.', ObjectType: 'AUTO' },
            { Action: 'set_delivery_date', Description: 'Define entrega.' },
            { Action: 'set_carrier', Description: 'Define transportadora.' }
          ] });
          return;
        }
        if (request.url?.endsWith('/describe')) {
          respond(response, {
            Action: body.Action, Description: 'Capability de teste.', Repeatable: true,
            Effect: body.Action === 'find_customer' ? 'READ' : 'WRITE',
            Available: true, ExecutionCount: 0, UnavailableReason: null,
            RequiredInputs: body.Action === 'find_customer' ? [] : ['Value'],
            ObjectType: 'CFL'
          });
          return;
        }
        const action = body.Action as string;
        if (action === 'execution_error') {
          response.writeHead(422, { 'content-type': 'application/json' });
          response.end(JSON.stringify({
            Success: false, ExecutionUUID: 'execution-1', Data: null,
            Error: { Code: 'FLOW_ACTION_ERROR', Message: 'Falha funcional retornada pelo Core.' }
          }));
          return;
        }
        if (action === 'invalid_success') {
          respond(response, {
            Action: action, Status: 'FAILED', MissingInformation: [], Output: null,
            Invocation: { InvocationUUID: 'invalid-invocation', IdFlow: 10, IdProcessLineFlow: 20 }
          });
          return;
        }
        const ambiguous = action === 'set_carrier' && body.Input &&
          (body.Input as Record<string, unknown>).Value === 'jadlog';
        respond(response, {
          Action: action,
          Status: ambiguous ? 'NEEDS_INPUT' : 'COMPLETED',
          MissingInformation: ambiguous ? ['Value'] : [],
          Output: ambiguous
            ? { Status: 'AMBIGUOUS', Candidates: [{ Value: '12', Label: 'Jadlog' }] }
            : { Status: 'RESOLVED', Value: action === 'find_customer' ? 'C001' : '12' },
          Invocation: { InvocationUUID: `invocation-${requests.length}`, IdFlow: 10, IdProcessLineFlow: 20 }
        });
      }).catch((error: unknown) => {
        response.writeHead(500);
        response.end(String(error));
      });
    });
    let mcp: Server | undefined;
    let client: Client | undefined;
    let transport: StreamableHTTPClientTransport | undefined;

    try {
      const corePort = await listen(core);
      const coreFlowClient = new CoreFlowClient({ baseUrl: `http://127.0.0.1:${corePort}`, timeoutMs: 1000 });
      const unavailable = vi.fn().mockRejectedValue(new Error('não deve ser chamado'));
      mcp = createServer(createApp({
        chatRepository: { getChatHistory: unavailable },
        flowRepository: { getProcessLineFlowState: unavailable },
        productRepository: { getProducts: unavailable, getProductById: unavailable },
        priceListRepository: { getPriceLists: unavailable },
        itemPriceRepository: { getProductsPriceLists: unavailable },
        coreFlowClient,
        coreNavigationClient: { listNavigationDestinations: unavailable, requestHandoff: unavailable },
        logger: { toolCompleted: vi.fn(), serverError: vi.fn() }
      }));
      const mcpPort = await listen(mcp);
      client = new Client({ name: 'agentic-flow-test', version: '1.0.0' });
      transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`));
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        'list_flow_actions', 'describe_flow_action', 'execute_flow_action'
      ]));

      const _meta = { ca: { Execution: {
        ExecutionUUID: 'execution-1', TurnUUID: 'turn-1', IdCompany: 1003, IdProcessLine: 456
      } } };
      const list = await client.callTool({ name: 'list_flow_actions', arguments: {}, _meta });
      expect(list.structuredContent).toEqual({ Actions: [
        { Action: 'find_customer', Description: 'Consulta cliente.' },
        { Action: 'set_delivery_date', Description: 'Define entrega.' },
        { Action: 'set_carrier', Description: 'Define transportadora.' }
      ] });

      for (const action of ['find_customer', 'set_delivery_date', 'set_carrier']) {
        const describe = await client.callTool({ name: 'describe_flow_action', arguments: { Action: action }, _meta });
        expect(describe.isError).not.toBe(true);
        expect(describe.structuredContent).toMatchObject({ Action: action, Effect: action === 'find_customer' ? 'READ' : 'WRITE' });
        expect(describe.structuredContent).not.toHaveProperty('ObjectType');
      }

      for (const [action, input] of [
        ['find_customer', {}],
        ['set_delivery_date', { Value: '2026-10-05' }],
        ['set_carrier', { Value: 'jadlog' }],
        ['set_carrier', { Value: '12' }]
      ] as const) {
        const result = await client.callTool({ name: 'execute_flow_action', arguments: { Action: action, Input: input }, _meta });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({
          Success: true, Action: action, Status: action === 'set_carrier' && input.Value === 'jadlog' ? 'NEEDS_INPUT' : 'COMPLETED'
        });
        expect(result.structuredContent).not.toHaveProperty('Invocation');
        expect(result._meta).toMatchObject({ ca: { FlowInvocation: { IdFlow: 10, IdProcessLineFlow: 20 } } });
      }

      for (const [action, code, message] of [
        ['execution_error', 'FLOW_ACTION_ERROR', 'Falha funcional retornada pelo Core.'],
        ['invalid_success', 'CORE_CONTRACT_ERROR', 'O Core retornou dados incompatíveis com o contrato da operação.']
      ]) {
        const result = await client.callTool({ name: 'execute_flow_action', arguments: { Action: action, Input: {} }, _meta });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toEqual({
          Success: false, Action: action, Output: null, Error: { Code: code, Message: message }
        });
        expect(result._meta).toBeUndefined();
      }

      const executeRequests = requests.filter((request) => request.path?.endsWith('/execute'));
      expect(executeRequests).toHaveLength(6);
      expect(new Set(executeRequests.map((request) => request.body.RequestUUID)).size).toBe(6);
      for (const request of requests) {
        expect(request.body).toMatchObject({ ExecutionUUID: 'execution-1', IdCompany: 1003, IdProcessLine: 456 });
        expect(request.body).not.toHaveProperty('TurnUUID');
      }
      expect(unavailable).not.toHaveBeenCalled();
    } finally {
      await transport?.close();
      await client?.close();
      if (mcp) await close(mcp);
      await close(core);
    }
  });
});
