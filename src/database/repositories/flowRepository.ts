import { and, asc, eq } from 'drizzle-orm';

import type { McpDatabase } from '../connection.js';
import { companyModule } from '../schema/companyModule.js';
import { processLine } from '../schema/processLine.js';
import { processLineFlow } from '../schema/processLineFlow.js';

export interface ProcessLineFlowStep {
  IdProcessLineFlow: number;
  IdFlow: number | null;
  IdProcessLine: number | null;
  IdChat: number | null;
  IdCompanyModule: number | null;
  DataType: string | null;
  Level: number | null;
  LevelOrder: number | null;
  FatherIdFlow: string | null;
  Description: string | null;
  ObjectDescription: string | null;
  ObjectType: string | null;
  Param: string | null;
  HasResponse: boolean;
  Value: unknown | null;
  IdMessage: number | null;
  ResponseIdMessage: number | null;
}

export interface FlowRepositoryContract {
  getProcessLineFlowState(idProcessLine: number, idCompany: number): Promise<ProcessLineFlowStep[]>;
}

function parseValue(value: string | null): unknown | null {
  if (value === null) return null;

  const text = String(value);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function hasResponse(param: string | null, value: string | null): boolean {
  return param?.trim().toUpperCase() === 'RESPONSE' && value !== null && value.trim().length > 0;
}

function parseLevel(level: string | null): number | null {
  if (level === null || level.trim().length === 0) return null;
  const parsed = Number(level);
  return Number.isFinite(parsed) ? parsed : null;
}

export class FlowRepository implements FlowRepositoryContract {
  public constructor(
    private readonly db: McpDatabase,
    private readonly boundCompanyId?: number
  ) {}

  public async getProcessLineFlowState(
    idProcessLine: number,
    idCompany: number
  ): Promise<ProcessLineFlowStep[]> {
    if (this.boundCompanyId !== undefined && this.boundCompanyId !== idCompany) {
      throw new Error('Flow repository company scope mismatch.');
    }

    const rows = await this.db
      .select({
        idProcessLineFlow: processLineFlow.idProcessLineFlow,
        idFlow: processLineFlow.idFlow,
        idProcessLine: processLineFlow.idProcessLine,
        idChat: processLineFlow.idChat,
        idCompanyModule: processLineFlow.idCompanyModule,
        dataType: processLineFlow.dataType,
        level: processLineFlow.level,
        levelOrder: processLineFlow.levelOrder,
        fatherIdFlow: processLineFlow.fatherIdFlow,
        description: processLineFlow.description,
        objectDescription: processLineFlow.objectDescription,
        objectType: processLineFlow.objectType,
        param: processLineFlow.param,
        value: processLineFlow.value,
        idMessage: processLineFlow.idMessage,
        responseIdMessage: processLineFlow.responseIdMessage
      })
      .from(processLineFlow)
      .innerJoin(processLine, eq(processLineFlow.idProcessLine, processLine.idProcessLine))
      .innerJoin(companyModule, eq(processLine.idCompanyModule, companyModule.idCompanyModule))
      .where(and(
        eq(processLineFlow.idProcessLine, idProcessLine),
        eq(companyModule.idCompany, idCompany)
      ))
      .orderBy(
        asc(processLineFlow.level),
        asc(processLineFlow.levelOrder),
        asc(processLineFlow.idProcessLineFlow)
      );

    return rows.map((row) => ({
      IdProcessLineFlow: row.idProcessLineFlow,
      IdFlow: row.idFlow,
      IdProcessLine: row.idProcessLine,
      IdChat: row.idChat,
      IdCompanyModule: row.idCompanyModule,
      DataType: row.dataType,
      Level: parseLevel(row.level),
      LevelOrder: row.levelOrder,
      FatherIdFlow: row.fatherIdFlow,
      Description: row.description,
      ObjectDescription: row.objectDescription,
      ObjectType: row.objectType,
      Param: row.param,
      HasResponse: hasResponse(row.param, row.value),
      Value: parseValue(row.value),
      IdMessage: row.idMessage,
      ResponseIdMessage: row.responseIdMessage
    }));
  }
}

export const flowRepositoryInternals = {
  parseValue,
  hasResponse,
  parseLevel
};
