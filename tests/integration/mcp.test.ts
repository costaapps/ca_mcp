import { createServer, type Server } from 'node:http';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import type { ChatRepositoryContract } from '../../src/database/repositories/chatRepository.js';
import type { FlowRepositoryContract } from '../../src/database/repositories/flowRepository.js';
import type { ProductRepositoryContract } from '../../src/database/repositories/productRepository.js';
import type { PriceListRepositoryContract } from '../../src/database/repositories/priceListRepository.js';
import type { ItemPriceRepositoryContract } from '../../src/database/repositories/itemPriceRepository.js';
import type { CoreFlowClientContract } from '../../src/core/contracts.js';
import type { CoreNavigationClientContract } from '../../src/core/contracts.js';
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
  let productRepository: ProductRepositoryContract;
  let priceListRepository: PriceListRepositoryContract;
  let itemPriceRepository: ItemPriceRepositoryContract;
  let coreFlowClient: CoreFlowClientContract;
  let coreNavigationClient: CoreNavigationClientContract;
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
    productRepository = {
      getProducts: vi.fn().mockResolvedValue([
        {
          IdItem: 10,
          ItemCode: 'CAR-10',
          ItemName: 'Carro',
          LongDescription: 'Descrição do carro',
          Price: 100
        }
      ]),
      getProductById: vi.fn().mockResolvedValue({
        IdItem: 10,
        ItemCode: 'CAR-10',
        ItemName: 'Carro',
        LongDescription: 'Descrição do carro',
        Price: 100
      })
    };
    priceListRepository = {
      getPriceLists: vi.fn().mockResolvedValue([
        { IdPriceList: 20, Code: 'STANDARD', Description: 'Tabela padrão' }
      ])
    };
    itemPriceRepository = {
      getProductsPriceLists: vi.fn().mockResolvedValue([
        { IdItemPrice: 30, IdItem: 10, IdPriceList: 20, Price: 95 }
      ])
    };
    coreFlowClient = {
      listFlowActions: vi.fn().mockResolvedValue({
        Success: true,
        ExecutionUUID: 'execution-1',
        Data: {
          Actions: [{ Action: 'get_customer_details', Description: 'Consulta cliente.' }]
        }
      }),
      describeFlowAction: vi.fn().mockResolvedValue({
        Success: true,
        ExecutionUUID: 'execution-1',
        Data: {
          Action: 'get_customer_details',
          Description: 'Consulta cliente.',
          Repeatable: true,
          Effect: 'READ',
          Available: false,
          ExecutionCount: 1,
          UnavailableReason: 'Já executada neste estado.',
          RequiredInputs: ['CustomerCode']
        }
      }),
      executeFlowAction: vi.fn().mockResolvedValue({
        Success: true,
        ExecutionUUID: 'execution-1',
        Data: {
          Action: 'get_customer_details',
          Status: 'COMPLETED',
          MissingInformation: [],
          Output: { CustomerCode: 'C000123' },
          Invocation: {
            InvocationUUID: 'invocation-1',
            IdFlow: 11023,
            IdProcessLineFlow: 82361
          }
        }
      })
    };
    coreNavigationClient = {
      listNavigationDestinations: vi.fn().mockResolvedValue({
        Success: true,
        ExecutionUUID: 'execution-1',
        Data: {
          Destinations: [
            {
              DestinationRef: 'nav_sales_opaque',
              Kind: 'MENU',
              Description: 'Vendas',
              MenuGroup: 'Atendimento',
              Keywords: 'comprar catálogo orçamento produto'
            },
            {
              DestinationRef: 'nav_home_opaque',
              Kind: 'HOME',
              Description: 'Início',
              MenuGroup: null,
              Keywords: null
            }
          ]
        }
      }),
      requestHandoff: vi.fn().mockResolvedValue({
        Success: true,
        ExecutionUUID: 'execution-1',
        Data: {
          Accepted: true,
          Destination: 'Vendas',
          Status: 'REQUESTED',
          HandoffUUID: 'handoff-1'
        }
      })
    };
    logger = {
      toolCompleted: vi.fn(),
      serverError: vi.fn()
    };

    server = createServer(createApp({
      chatRepository,
      flowRepository,
      productRepository,
      priceListRepository,
      itemPriceRepository,
      coreFlowClient,
      coreNavigationClient,
      logger
    }));
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

  it('inicializa, lista as onze tools e responde health', async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'get_chat_history',
      'get_process_line_flow_state',
      'get_products',
      'get_pricelists',
      'get_products_pricelists',
      'resolve_product',
      'list_flow_actions',
      'describe_flow_action',
      'execute_flow_action',
      'list_navigation_destinations',
      'request_handoff'
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

  it('executa get_products com IdCompany, filtros funcionais e structuredContent enxuto', async () => {
    const result = await client.callTool({
      name: 'get_products',
      arguments: { ItemCode: 'car', ItemName: 'carro', Limit: 20 },
      _meta: { ca: { Execution: { IdCompany: 1003, IdChat: 123 } } }
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      Products: [{
        IdItem: 10,
        ItemCode: 'CAR-10',
        ItemName: 'Carro',
        LongDescription: 'Descrição do carro',
        Price: 100
      }]
    });
    expect(result._meta).toBeUndefined();
    expect(productRepository.getProducts).toHaveBeenCalledWith({
      idCompany: 1003,
      itemCode: 'car',
      itemName: 'carro',
      limit: 20
    });
    expect(chatRepository.getChatHistory).not.toHaveBeenCalled();
    expect(flowRepository.getProcessLineFlowState).not.toHaveBeenCalled();
  });

  it('aplica limite padrão em get_products e exige Execution.IdCompany', async () => {
    const result = await client.callTool({
      name: 'get_products',
      arguments: {},
      _meta: { ca: { Execution: { IdCompany: 1003 } } }
    });

    expect(result.isError).not.toBe(true);
    expect(productRepository.getProducts).toHaveBeenCalledWith({
      idCompany: 1003,
      itemCode: undefined,
      itemName: undefined,
      limit: 50
    });

    const missingContext = await client.callTool({
      name: 'get_products',
      arguments: {}
    });
    expect(missingContext.isError).toBe(true);
    expect(missingContext.structuredContent).toEqual({
      Code: 'MISSING_CONTEXT',
      Required: 'Execution.IdCompany'
    });
  });

  it('executa get_pricelists somente com Execution.IdCompany', async () => {
    const result = await client.callTool({
      name: 'get_pricelists',
      arguments: { Limit: 10 },
      _meta: { ca: { Execution: { IdCompany: 1003, IdItem: 999 } } }
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      PriceLists: [{ IdPriceList: 20, Code: 'STANDARD', Description: 'Tabela padrão' }]
    });
    expect(priceListRepository.getPriceLists).toHaveBeenCalledWith({
      idCompany: 1003,
      limit: 10
    });
    expect(itemPriceRepository.getProductsPriceLists).not.toHaveBeenCalled();
  });

  it('executa get_products_pricelists com Execution.IdCompany e Resolved.IdItem', async () => {
    const result = await client.callTool({
      name: 'get_products_pricelists',
      arguments: {},
      _meta: { ca: { Execution: { IdCompany: 1003, IdChat: 123 }, Resolved: { IdItem: 10 } } }
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      ProductsPriceLists: [{ IdItemPrice: 30, IdItem: 10, IdPriceList: 20, Price: 95 }]
    });
    expect(itemPriceRepository.getProductsPriceLists).toHaveBeenCalledWith({
      idCompany: 1003,
      idItem: 10
    });
    expect(productRepository.getProducts).not.toHaveBeenCalled();
  });

  it('exige Resolved.IdItem para get_products_pricelists', async () => {
    const result = await client.callTool({
      name: 'get_products_pricelists',
      arguments: {},
      _meta: { ca: { Execution: { IdCompany: 1003 } } }
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      Code: 'MISSING_CONTEXT',
      Required: 'Resolved.IdItem'
    });
    expect(itemPriceRepository.getProductsPriceLists).not.toHaveBeenCalled();
  });

  it('retorna DATABASE_ERROR para falha nas consultas ERP', async () => {
    vi.mocked(priceListRepository.getPriceLists).mockRejectedValueOnce(new Error('erro ERP'));

    const result = await client.callTool({
      name: 'get_pricelists',
      arguments: {},
      _meta: { ca: { Execution: { IdCompany: 1003 } } }
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ Code: 'DATABASE_ERROR' });
    expect(logger.serverError).toHaveBeenCalledWith(expect.objectContaining({ message: 'erro ERP' }));
  });

  it('resolve_product confirma o item e publica Resolved.IdItem', async () => {
    const result = await client.callTool({
      name: 'resolve_product',
      arguments: { IdItem: 10 },
      _meta: { ca: { Execution: { IdCompany: 1003, IdChat: 123 } } }
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      Product: {
        IdItem: 10,
        ItemCode: 'CAR-10',
        ItemName: 'Carro',
        LongDescription: 'Descrição do carro',
        Price: 100
      }
    });
    expect(result._meta).toEqual({ ca: { Resolved: { IdItem: 10 } } });
    expect(productRepository.getProductById).toHaveBeenCalledWith({
      idCompany: 1003,
      idItem: 10
    });
  });

  it('resolve_product exige empresa e não resolve produto inexistente', async () => {
    const missingCompany = await client.callTool({
      name: 'resolve_product',
      arguments: { IdItem: 10 }
    });
    expect(missingCompany.isError).toBe(true);
    expect(missingCompany.structuredContent).toEqual({
      Code: 'MISSING_CONTEXT',
      Required: 'Execution.IdCompany'
    });
    expect(productRepository.getProductById).not.toHaveBeenCalled();

    vi.mocked(productRepository.getProductById).mockResolvedValueOnce(null);
    const notFound = await client.callTool({
      name: 'resolve_product',
      arguments: { IdItem: 999 },
      _meta: { ca: { Execution: { IdCompany: 1003 } } }
    });
    expect(notFound.isError).toBe(true);
    expect(notFound.structuredContent).toEqual({ Code: 'PRODUCT_NOT_FOUND' });
    expect(notFound._meta).toBeUndefined();
  });

  it('rejeita IdItem inválido em resolve_product', async () => {
    const result = await client.callTool({
      name: 'resolve_product',
      arguments: { IdItem: 0 },
      _meta: { ca: { Execution: { IdCompany: 1003 } } }
    });

    expect(result.isError).toBe(true);
    expect(productRepository.getProductById).not.toHaveBeenCalled();
  });

  it('integra list_flow_actions com o Core usando apenas Execution', async () => {
    const result = await client.callTool({
      name: 'list_flow_actions',
      arguments: {},
      _meta: {
        ca: {
          Execution: {
            ExecutionUUID: 'execution-1',
            TurnUUID: 'turn-1',
            IdCompany: 1003,
            IdProcessLine: 456,
            IdProcessLineFlow: 999
          }
        }
      }
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      Actions: [{ Action: 'get_customer_details', Description: 'Consulta cliente.' }]
    });
    expect(coreFlowClient.listFlowActions).toHaveBeenCalledWith({
      ExecutionUUID: 'execution-1',
      IdCompany: 1003,
      IdProcessLine: 456
    });
    expect(flowRepository.getProcessLineFlowState).not.toHaveBeenCalled();
  });

  it('integra describe_flow_action e mantém Available=false como sucesso', async () => {
    const result = await client.callTool({
      name: 'describe_flow_action',
      arguments: { Action: 'get_customer_details' },
      _meta: { ca: { Execution: {
        ExecutionUUID: 'execution-1',
        IdCompany: 1003,
        IdProcessLine: 456
      } } }
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      Action: 'get_customer_details',
      Description: 'Consulta cliente.',
      Repeatable: true,
      Effect: 'READ',
      Available: false,
      ExecutionCount: 1,
      UnavailableReason: 'Já executada neste estado.',
      RequiredInputs: ['CustomerCode']
    });
    expect(coreFlowClient.describeFlowAction).toHaveBeenCalledWith({
      ExecutionUUID: 'execution-1',
      IdCompany: 1003,
      IdProcessLine: 456,
      Action: 'get_customer_details'
    });
  });

  it('integra execute_flow_action, gera RequestUUID e oculta FlowInvocation no conteúdo', async () => {
    const requestUUID = 'request-1';
    const result = await client.callTool({
      name: 'execute_flow_action',
      arguments: {
        Action: 'get_customer_details',
        Input: { CustomerCode: 'C000123', IncludeAddresses: true }
      },
      _meta: { ca: { Execution: {
        ExecutionUUID: 'execution-1',
        TurnUUID: 'turn-1',
        IdCompany: 1003,
        IdProcessLine: 456
      } } }
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      Success: true,
      Action: 'get_customer_details',
      Status: 'COMPLETED',
      MissingInformation: [],
      Output: { CustomerCode: 'C000123' }
    });
    expect(result.structuredContent).not.toHaveProperty('Invocation');
    expect(result._meta).toEqual({ ca: { FlowInvocation: {
      InvocationUUID: 'invocation-1',
      IdFlow: 11023,
      IdProcessLineFlow: 82361
    } } });
    expect(coreFlowClient.executeFlowAction).toHaveBeenCalledWith({
      ExecutionUUID: 'execution-1',
      IdCompany: 1003,
      IdProcessLine: 456,
      RequestUUID: expect.any(String),
      Action: 'get_customer_details',
      Input: { CustomerCode: 'C000123', IncludeAddresses: true }
    });
    const request = vi.mocked(coreFlowClient.executeFlowAction).mock.calls[0]?.[0];
    expect(request?.RequestUUID).toEqual(expect.any(String));
    expect(request?.RequestUUID).not.toBe('execution-1');
    expect(request?.RequestUUID).not.toBe(requestUUID);
  });

  it('integra falha de execute com isError e envelope funcional completo', async () => {
    vi.mocked(coreFlowClient.executeFlowAction).mockResolvedValueOnce({
      Success: false,
      ExecutionUUID: 'execution-1',
      Data: null,
      Error: {
        Code: 'FLOW_ACTION_ALREADY_EXECUTED',
        Message: 'A capability já foi executada.'
      }
    });

    const result = await client.callTool({
      name: 'execute_flow_action',
      arguments: { Action: 'get_customer_details', Input: {} },
      _meta: { ca: { Execution: {
        ExecutionUUID: 'execution-1',
        IdCompany: 1003,
        IdProcessLine: 456
      } } }
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      Success: false,
      Action: 'get_customer_details',
      Output: null,
      Error: {
        Code: 'FLOW_ACTION_ALREADY_EXECUTED',
        Message: 'A capability já foi executada.'
      }
    });
    const content = result.content[0];
    if (content?.type !== 'text') throw new Error('Envelope de falha deve ser texto JSON.');
    expect(JSON.parse(content.text)).toEqual(result.structuredContent);
  });

  it('integra list_navigation_destinations com MENU/HOME e contexto confiável', async () => {
    const result = await client.callTool({
      name: 'list_navigation_destinations',
      arguments: {},
      _meta: { ca: { Execution: {
        ExecutionUUID: 'execution-1',
        TurnUUID: 'turn-1',
        IdCompany: 1003,
        IdProcessLine: 456,
        IdCompanyMenu: 999
      } } }
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      Destinations: [
        {
          DestinationRef: 'nav_sales_opaque',
          Kind: 'MENU',
          Description: 'Vendas',
          MenuGroup: 'Atendimento',
          Keywords: 'comprar catálogo orçamento produto'
        },
        {
          DestinationRef: 'nav_home_opaque',
          Kind: 'HOME',
          Description: 'Início',
          MenuGroup: null,
          Keywords: null
        }
      ]
    });
    expect(coreNavigationClient.listNavigationDestinations).toHaveBeenCalledWith({
      ExecutionUUID: 'execution-1',
      IdCompany: 1003,
      IdProcessLine: 456
    });
  });

  it('integra request_handoff, gera RequestUUID e não expõe HandoffUUID', async () => {
    const result = await client.callTool({
      name: 'request_handoff',
      arguments: {
        DestinationRef: 'nav_sales_opaque',
        Reason: 'Intenção de compra',
        Summary: 'Cliente quer comprar memória RAM.'
      },
      _meta: { ca: { Execution: {
        ExecutionUUID: 'execution-1',
        TurnUUID: 'turn-1',
        IdCompany: 1003,
        IdProcessLine: 456
      } } }
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      Accepted: true,
      Destination: 'Vendas',
      Status: 'REQUESTED'
    });
    expect(result.structuredContent).not.toHaveProperty('HandoffUUID');
    expect(coreNavigationClient.requestHandoff).toHaveBeenCalledWith({
      ExecutionUUID: 'execution-1',
      IdCompany: 1003,
      IdProcessLine: 456,
      RequestUUID: expect.any(String),
      DestinationRef: 'nav_sales_opaque',
      Reason: 'Intenção de compra',
      Summary: 'Cliente quer comprar memória RAM.'
    });
    expect(logger.toolCompleted).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'request_handoff',
      success: true,
      RequestUUID: expect.any(String),
      HandoffUUID: 'handoff-1'
    }));
  });

  it('propaga erro de destino indisponível e mantém Flow tools operacionais', async () => {
    vi.mocked(coreNavigationClient.requestHandoff).mockResolvedValueOnce({
      Success: false,
      ExecutionUUID: 'execution-1',
      Data: null,
      Error: {
        Code: 'NAVIGATION_DESTINATION_NOT_AVAILABLE',
        Message: 'O destino não está mais disponível.'
      }
    });

    const failedHandoff = await client.callTool({
      name: 'request_handoff',
      arguments: {
        DestinationRef: 'nav_sales_opaque',
        Reason: 'Navegação',
        Summary: 'Solicitação.'
      },
      _meta: { ca: { Execution: {
        ExecutionUUID: 'execution-1',
        TurnUUID: 'turn-1',
        IdCompany: 1003,
        IdProcessLine: 456
      } } }
    });
    expect(failedHandoff.isError).toBe(true);
    expect(failedHandoff.structuredContent).toEqual({
      Code: 'NAVIGATION_DESTINATION_NOT_AVAILABLE'
    });
    expect(failedHandoff.content).toEqual([
      { type: 'text', text: 'O destino não está mais disponível.' }
    ]);

    const flowResult = await client.callTool({
      name: 'list_flow_actions',
      arguments: {},
      _meta: { ca: { Execution: {
        ExecutionUUID: 'execution-1',
        TurnUUID: 'turn-1',
        IdCompany: 1003,
        IdProcessLine: 456
      } } }
    });
    expect(flowResult.isError).not.toBe(true);
    expect(flowResult.structuredContent).toEqual({
      Actions: [{ Action: 'get_customer_details', Description: 'Consulta cliente.' }]
    });
  });
});
