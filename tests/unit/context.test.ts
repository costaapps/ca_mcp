import type { ServerContext } from '@modelcontextprotocol/server';

import { describe, expect, it } from 'vitest';

import { extractCAMeta, getExecutionValue, getResolvedValue } from '../../src/mcp/context/caMeta.js';
import {
  optionalExecutionString,
  requireExecutionId,
  requireExecutionString,
  requireAgentExecutionContext,
  requireFlowExecutionContext,
  requireResolvedId
} from '../../src/mcp/context/requireContext.js';

function contextWithMeta(meta: unknown): Pick<ServerContext, 'mcpReq'> {
  return {
    mcpReq: {
      id: 1,
      method: 'tools/call',
      _meta: meta as never,
      requestState: (() => undefined) as ServerContext['mcpReq']['requestState'],
      signal: new AbortController().signal,
    } as unknown as ServerContext['mcpReq']
  };
}

describe('CAMeta', () => {
  it('extrai Execution.IdChat e Execution.IdProcessLine', () => {
    const meta = extractCAMeta(contextWithMeta({
      ca: { Execution: { IdChat: 123, IdProcessLine: 456 } }
    }));

    expect(getExecutionValue(meta, 'IdChat')).toBe(123);
    expect(getExecutionValue(meta, 'IdProcessLine')).toBe(456);
  });

  it('extrai valores de Resolved', () => {
    const meta = extractCAMeta(contextWithMeta({ ca: { Resolved: { IdDocument: 987 } } }));
    expect(getResolvedValue(meta, 'IdDocument')).toBe(987);
  });

  it('aceita metadata ausente como contexto vazio', () => {
    const meta = extractCAMeta(contextWithMeta(undefined));
    expect(meta).toEqual({});
  });

  it('rejeita metadata malformada', () => {
    expect(() => extractCAMeta(contextWithMeta({ ca: 'invalid' }))).toThrow('Metadata MCP inválida');
    expect(() => extractCAMeta(contextWithMeta({ ca: { Execution: 'invalid' } }))).toThrow('_meta.ca inválido');
  });
});

describe('requireContext', () => {
  it('passa para IDs inteiros positivos', () => {
    const meta = extractCAMeta(contextWithMeta({
      ca: { Execution: { IdChat: 123 }, Resolved: { IdDocument: 987 } }
    }));

    expect(requireExecutionId(meta, 'IdChat')).toBe(123);
    expect(requireResolvedId(meta, 'IdDocument')).toBe(987);
  });

  it('retorna MISSING_CONTEXT quando o requisito não existe', () => {
    const meta = extractCAMeta(contextWithMeta({ ca: { Execution: {} } }));
    expect(() => requireExecutionId(meta, 'IdChat')).toThrow('Execution.IdChat');
    try {
      requireExecutionId(meta, 'IdChat');
    } catch (error) {
      expect(error).toMatchObject({ code: 'MISSING_CONTEXT' });
    }
  });

  it('rejeita ID não inteiro', () => {
    const meta = extractCAMeta(contextWithMeta({ ca: { Execution: { IdChat: '123' } } }));
    expect(() => requireExecutionId(meta, 'IdChat')).toThrow('Contexto inválido: Execution.IdChat');
  });

  it('exige ExecutionUUID como string não vazia e aceita TurnUUID opcional', () => {
    const meta = extractCAMeta(contextWithMeta({
      ca: { Execution: {
        ExecutionUUID: 'execution-1',
        TurnUUID: 'turn-1',
        IdCompany: 1003,
        IdProcessLine: 456
      } }
    }));

    expect(requireExecutionString(meta, 'ExecutionUUID')).toBe('execution-1');
    expect(optionalExecutionString(meta, 'TurnUUID')).toBe('turn-1');
    expect(requireFlowExecutionContext(meta)).toEqual({
      ExecutionUUID: 'execution-1',
      TurnUUID: 'turn-1',
      IdCompany: 1003,
      IdProcessLine: 456
    });
  });

  it('retorna erro estruturado para ExecutionUUID ausente ou inválido', () => {
    const missing = extractCAMeta(contextWithMeta({
      ca: { Execution: { IdCompany: 1003, IdProcessLine: 456 } }
    }));
    expect(() => requireExecutionString(missing, 'ExecutionUUID')).toThrow('Execution.ExecutionUUID');

    const invalid = extractCAMeta(contextWithMeta({
      ca: { Execution: { ExecutionUUID: 123, IdCompany: 1003, IdProcessLine: 456 } }
    }));
    expect(() => requireExecutionString(invalid, 'ExecutionUUID')).toThrow('Contexto inválido: Execution.ExecutionUUID');
  });

  it('não aceita IDs técnicos em substituição ao contexto Execution', () => {
    const meta = extractCAMeta(contextWithMeta({
      ca: { Execution: { IdCompany: 1003, IdProcessLine: 456 }, Resolved: {
        ExecutionUUID: 'wrong-place',
        IdProcessLineFlow: 999
      } }
    }));

    expect(() => requireFlowExecutionContext(meta)).toThrow('Execution.ExecutionUUID');
  });

  it('exige TurnUUID no contexto genérico de Agent sem alterar o contexto de Flow', () => {
    const meta = extractCAMeta(contextWithMeta({
      ca: { Execution: {
        ExecutionUUID: 'execution-1',
        TurnUUID: 'turn-1',
        IdCompany: 1003,
        IdProcessLine: 456
      } }
    }));

    expect(requireAgentExecutionContext(meta)).toEqual({
      ExecutionUUID: 'execution-1',
      TurnUUID: 'turn-1',
      IdCompany: 1003,
      IdProcessLine: 456
    });

    const missingTurn = extractCAMeta(contextWithMeta({
      ca: { Execution: {
        ExecutionUUID: 'execution-1',
        IdCompany: 1003,
        IdProcessLine: 456
      } }
    }));
    expect(() => requireAgentExecutionContext(missingTurn)).toThrow('Execution.TurnUUID');
  });
});
