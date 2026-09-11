export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface CoreFlowContextRequest {
  ExecutionUUID: string;
  TurnUUID?: string;
  IdCompany: number;
  IdProcessLine: number;
}

export type CoreListFlowActionsRequest = CoreFlowContextRequest;

export interface CoreDescribeFlowActionRequest extends CoreFlowContextRequest {
  Action: string;
}

export interface CoreExecuteFlowActionRequest extends CoreFlowContextRequest {
  RequestUUID: string;
  Action: string;
  Input: JsonObject;
}

export interface CoreFlowActionSummary {
  Action: string;
  Description: string;
}

export interface CoreListFlowActionsData {
  Actions: CoreFlowActionSummary[];
}

export interface CoreDescribeFlowActionData {
  Action: string;
  Description: string;
  Repeatable: boolean;
  Available: boolean;
  ExecutionCount: number;
  UnavailableReason: string | null;
  RequiredInputs: string[];
}

export interface CoreFlowInvocation {
  InvocationUUID: string;
  IdFlow: number;
  IdProcessLineFlow: number;
}

export interface CoreExecuteFlowActionData {
  Action: string;
  Output: JsonValue;
  Invocation: CoreFlowInvocation;
}

export interface CoreFlowError {
  Code: string;
  Message: string;
}

export interface CoreFlowSuccess<TData> {
  Success: true;
  ExecutionUUID: string;
  Data: TData;
}

export interface CoreFlowFailure {
  Success: false;
  ExecutionUUID: string;
  Data: null;
  Error: CoreFlowError;
}

export type CoreFlowResponse<TData> = CoreFlowSuccess<TData> | CoreFlowFailure;

export interface CoreFlowClientContract {
  listFlowActions(
    request: CoreListFlowActionsRequest
  ): Promise<CoreFlowResponse<CoreListFlowActionsData>>;
  describeFlowAction(
    request: CoreDescribeFlowActionRequest
  ): Promise<CoreFlowResponse<CoreDescribeFlowActionData>>;
  executeFlowAction(
    request: CoreExecuteFlowActionRequest
  ): Promise<CoreFlowResponse<CoreExecuteFlowActionData>>;
}
