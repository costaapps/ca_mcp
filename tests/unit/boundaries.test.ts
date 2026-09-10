import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('PoC MCP boundaries', () => {
  it('não contém migrations do ERP ou dependências OpenAI', () => {
    expect(existsSync(resolve(process.cwd(), 'drizzle'))).toBe(false);
    expect(existsSync(resolve(process.cwd(), 'migrations'))).toBe(false);
    const packageJson = readFileSync(resolve(process.cwd(), 'package.json'), 'utf8');
    expect(packageJson).not.toContain('openai');
  });

  it('mantém SQL encapsulado no Drizzle dos repositories', () => {
    const chatRepository = readFileSync(
      resolve(process.cwd(), 'src/database/repositories/chatRepository.ts'),
      'utf8'
    );
    const flowRepository = readFileSync(
      resolve(process.cwd(), 'src/database/repositories/flowRepository.ts'),
      'utf8'
    );
    const erpRepositories = [
      'productRepository.ts',
      'priceListRepository.ts',
      'itemPriceRepository.ts'
    ].map((file) => readFileSync(
      resolve(process.cwd(), 'src/database/repositories', file),
      'utf8'
    )).join('\n');
    const tools = [
      readFileSync(resolve(process.cwd(), 'src/mcp/tools/getChatHistory.ts'), 'utf8'),
      readFileSync(resolve(process.cwd(), 'src/mcp/tools/getProcessLineFlowState.ts'), 'utf8')
    ].join('\n');

    expect(chatRepository).toContain('eq(message.idChat, idChat)');
    expect(flowRepository).toContain('eq(processLineFlow.idProcessLine, idProcessLine)');
    expect(erpRepositories).toContain("eq(erpItem.idCompany, search.idCompany)");
    expect(erpRepositories).toContain("eq(erpPriceList.idCompany, search.idCompany)");
    expect(erpRepositories).toContain("eq(erpItemPrice.idItem, search.idItem)");
    expect(erpRepositories).not.toContain('sql.raw');
    expect(tools).not.toMatch(/\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
  });
});
