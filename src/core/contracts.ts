export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface CoreFlowContextRequest {
  ExecutionUUID: string;
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
  ObjectDescription?: string | null;
  Repeatable: boolean;
  Effect: 'READ' | 'WRITE' | 'EXTERNAL_READ' | 'EXTERNAL_WRITE' | 'OUTPUT' | 'CONTROL';
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
  Status: 'COMPLETED' | 'NEEDS_INPUT';
  MissingInformation: string[];
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

export interface CoreNavigationContextRequest {
  ExecutionUUID: string;
  IdCompany: number;
  IdProcessLine: number;
}

export type CoreListNavigationDestinationsRequest = CoreNavigationContextRequest;

export interface NavigationDestination {
  DestinationRef: string;
  Kind: 'MENU' | 'HOME';
  Description: string;
  MenuGroup: string | null;
  Keywords: string | null;
  AIReference?: string | null;
}

export interface CoreListNavigationDestinationsData {
  Destinations: NavigationDestination[];
}

export interface CoreRequestHandoffRequest extends CoreNavigationContextRequest {
  RequestUUID: string;
  DestinationRef: string;
  Reason: string;
  Summary: string;
}

export interface CoreRequestHandoffData {
  Accepted: true;
  Destination: string;
  Status: 'REQUESTED';
  HandoffUUID: string;
}

export interface CoreNavigationError {
  Code: string;
  Message: string;
}

export interface CoreNavigationSuccess<TData> {
  Success: true;
  ExecutionUUID: string;
  Data: TData;
}

export interface CoreNavigationFailure {
  Success: false;
  ExecutionUUID: string;
  Data: null;
  Error: CoreNavigationError;
}

export type CoreNavigationResponse<TData> =
  | CoreNavigationSuccess<TData>
  | CoreNavigationFailure;

export interface CoreNavigationClientContract {
  listNavigationDestinations(
    request: CoreListNavigationDestinationsRequest
  ): Promise<CoreNavigationResponse<CoreListNavigationDestinationsData>>;
  requestHandoff(
    request: CoreRequestHandoffRequest
  ): Promise<CoreNavigationResponse<CoreRequestHandoffData>>;
}
