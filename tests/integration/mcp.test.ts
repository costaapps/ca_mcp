import { createServer, type Server } from 'node:http';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import type { ChatRepositoryContract } from '../../src/database/repositories/chatRepository.js';
import type { FlowRepositoryContract } from '../../src/database/repositories/flowRepository.js';
import type { McpLogger } from '../../src/mcp/logger.js';

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Não foi possível obter a porta de teste.');
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe('MCP HTTP server', () => {
  let server: Server;
  let client: Client;
  let transport: StreamableHTTPClientTransport;
  let chatRepository: ChatRepositoryContract;
  let flowRepository: FlowRepositoryContract;
  let logger: McpLogger;

  beforeEach(async () => {
    chatRepository = {
      getChatHistory: vi.fn().mockResolvedValue([
        { Sender: 'System', Text: 'Como posso ajudar?' },
        { Sender: 'Customer', Text: 'Quero comprar um carro.' }
      ])
    };
    flowRepository = {
      getProcessLineFlowState: vi.fn().mockResolvedValue([
        {
          IdProcessLineFlow: 1001,
          IdFlow: 11111,
          IdProcessLine: 456,
          IdChat: 123,
          IdCompanyModule: 9,
          DataType: 'string',
          Level: 1,
          LevelOrder: 1,
          FatherIdFlow: null,
          Description: 'Pergunta inicial',
          ObjectDescription: 'Pergunta',
          ObjectType: 'PROMPT',
          Param: 'Response',
          HasResponse: true,
          Value: 'Quero comprar um carro.',
          IdMessage: 70,
          ResponseIdMessage: 71
        }
      ])
    };
    logger = {
      toolCompleted: vi.fn(),
      serverError: vi.fn()
    };

    server = createServer(createApp({ chatRepository, flowRepository, logger }));
    const port = await listen(server);
    client = new Client({ name: 'ca-mcp-test-client', version: '0.1.0' });
    transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
    await client.connect(transport);
  });

  afterEach(async () => {
    await client.close();
    await transport.close();
    await close(server);
  });

  it('inicializa, lista somente as duas tools e responde health', async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'get_chat_history',
      'get_process_line_flow_state'
    ]);

    const health = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ status: 'ok' });
  });

  it('executa get_chat_history com contexto, structuredContent e somente IdChat', async () => {
    const result = await client.callTool({
      name: 'get_chat_history',
      arguments: {},
      _meta: { ca: { Execution: { IdChat: 123, IdProcessLine: 456 } } }
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      Messages: [
        { Sender: 'System', Text: 'Como posso ajudar?' },
        { Sender: 'Customer', Text: 'Quero comprar um carro.' }
      ]
    });
    expect(chatRepository.getChatHistory).toHaveBeenCalledWith(123);
    expect(flowRepository.getProcessLineFlowState).not.toHaveBeenCalled();
  });

  it('executa get_process_line_flow_state com contexto e somente IdProcessLine', async () => {
    const result = await client.callTool({
      name: 'get_process_line_flow_state',
      arguments: {},
      _meta: { ca: { Execution: { IdChat: 123, IdProcessLine: 456 } } }
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      Steps: [
        {
          IdProcessLineFlow: 1001,
          IdFlow: 11111,
          IdProcessLine: 456,
          IdChat: 123,
          IdCompanyModule: 9,
          DataType: 'string',
          Level: 1,
          LevelOrder: 1,
          FatherIdFlow: null,
          Description: 'Pergunta inicial',
          ObjectDescription: 'Pergunta',
          ObjectType: 'PROMPT',
          Param: 'Response',
          HasResponse: true,
          Value: 'Quero comprar um carro.',
          IdMessage: 70,
          ResponseIdMessage: 71
        }
      ]
    });
    expect(flowRepository.getProcessLineFlowState).toHaveBeenCalledWith(456);
    expect(chatRepository.getChatHistory).not.toHaveBeenCalled();
  });

  it('retorna erro MCP estruturado quando falta o contexto obrigatório', async () => {
    const result = await client.callTool({
      name: 'get_chat_history',
      arguments: {}
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      Code: 'MISSING_CONTEXT',
      Required: 'Execution.IdChat'
    });
    expect(chatRepository.getChatHistory).not.toHaveBeenCalled();
  });

  it('exige Execution.IdProcessLine para get_process_line_flow_state', async () => {
    const result = await client.callTool({
      name: 'get_process_line_flow_state',
      arguments: {},
      _meta: { ca: { Execution: { IdChat: 123 } } }
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      Code: 'MISSING_CONTEXT',
      Required: 'Execution.IdProcessLine'
    });
    expect(flowRepository.getProcessLineFlowState).not.toHaveBeenCalled();
  });

  it('retorna DATABASE_ERROR sem expor stack quando o repository falha', async () => {
    vi.mocked(chatRepository.getChatHistory).mockRejectedValueOnce(new Error('segredo do banco'));

    const result = await client.callTool({
      name: 'get_chat_history',
      arguments: {},
      _meta: { ca: { Execution: { IdChat: 123 } } }
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ Code: 'DATABASE_ERROR' });
    expect(result.content).toEqual([
      { type: 'text', text: 'Não foi possível consultar o histórico da conversa.' }
    ]);
    expect(logger.serverError).toHaveBeenCalledWith(expect.objectContaining({ message: 'segredo do banco' }));
  });
});
