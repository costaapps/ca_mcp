# Costa Apps MCP Server

MCP Server da PoC agentic Costa Apps. O serviço é somente leitura e expõe duas tools sobre o banco Msg4 de homologação:

- `get_chat_history`
- `get_process_line_flow_state`

## Requisitos

- Node.js 22+
- MySQL/MariaDB acessível pela aplicação

## Configuração e execução

```powershell
Copy-Item .env.example .env
npm install
npm run build
npm start
```

O processo escuta em `PORT` (padrão `3102`). Os endpoints são `GET /health` e `/mcp` via Streamable HTTP.

Não há migrations neste repositório: `Message` e `ProcessLineFlow` são tabelas existentes do Core.

## Metadata MCP

As tools não recebem IDs técnicos em `arguments`. O Agent Runtime envia somente o contexto necessário em `_meta.ca`:

```json
{
  "ca": {
    "Execution": {
      "IdChat": 123,
      "IdProcessLine": 456
    }
  }
}
```

`get_chat_history` exige `Execution.IdChat`. `get_process_line_flow_state` exige `Execution.IdProcessLine`.

## Structured content

Histórico:

```json
{
  "Messages": [
    { "Sender": "System", "Text": "Como posso ajudar?" },
    { "Sender": "Customer", "Text": "Quero comprar um carro." }
  ]
}
```

Estado do fluxo:

```json
{
  "Steps": [
    {
      "IdProcessLineFlow": 1001,
      "IdFlow": 11111,
      "IdProcessLine": 456,
      "IdChat": 123,
      "IdCompanyModule": 9,
      "DataType": "string",
      "Level": 1,
      "LevelOrder": 1,
      "FatherIdFlow": null,
      "Description": "Pergunta inicial",
      "ObjectDescription": "Pergunta",
      "ObjectType": "PROMPT",
      "Param": "Response",
      "HasResponse": true,
      "Value": "Quero comprar um carro.",
      "IdMessage": 70,
      "ResponseIdMessage": 71
    }
  ]
}
```

`Value` é convertido para objeto/array quando contém JSON válido; texto comum permanece string. Campos extensos de query, request, headers e opções não fazem parte da resposta inicial.

## Desenvolvimento

```powershell
npm test
npm run typecheck
npm run build
npm run lint
```

Os testes usam repositories falsos por padrão e não exigem banco de homologação. O teste MCP sobe um HTTP local e usa `StreamableHTTPClientTransport` do SDK v2.
