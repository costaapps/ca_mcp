export const canonicalRequestHandoffSuccess = {
  Success: true,
  ExecutionUUID: 'execution-1',
  Data: {
    Accepted: true,
    Destination: 'Vendas',
    Status: 'REQUESTED',
    HandoffUUID: 'handoff-1'
  }
} as const;

export const navigationDestinationsWithAIReference = {
  Success: true,
  ExecutionUUID: 'execution-1',
  Data: {
    Destinations: [
      {
        DestinationRef: 'opaque-menu-1',
        Kind: 'MENU',
        Description: 'Catálogo de produtos',
        MenuGroup: 'Comercial',
        Keywords: 'produtos preços',
        AIReference: 'Consulta produtos ativos no ERP e gera um PDF.'
      },
      {
        DestinationRef: 'opaque-menu-2',
        Kind: 'MENU',
        Description: 'Pedidos',
        MenuGroup: 'Comercial',
        Keywords: 'pedido',
        AIReference: 'Acompanha o estado dos pedidos.'
      },
      {
        DestinationRef: 'opaque-home',
        Kind: 'HOME',
        Description: 'Início',
        MenuGroup: null,
        Keywords: null,
        AIReference: null
      }
    ]
  }
} as const;
