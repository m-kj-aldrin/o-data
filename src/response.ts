// ============================================================================
// Response Types
// ============================================================================

// OData metadata properties
export type ODataMetadata = {
  '@odata.context'?: string;
  '@odata.count'?: number;
  '@odata.nextLink'?: string;
  [key: string]: any;
};

// Base discriminated union for all OData responses
export type ODataResponse<TSuccess, TError = { error: any }> =
  | {
      ok: true;
      status: number;
      statusText: string;
      headers?: Headers;
      result: TSuccess;
    }
  | {
      ok: false;
      status: number;
      statusText: string;
      headers?: Headers;
      result: TError;
    };

// Error types
export type ODataError = { error: any };

// ============================================================================
// Query Response Types
// ============================================================================

// Collection query result data (will be properly typed in query.ts)
export type CollectionQueryData<E = any, Q = any, O = any> = {
  data: any[];
} & ODataMetadata;

export type CollectionQueryError = ODataError;

export type CollectionQueryResponse<E = any, Q = any, O = any> = ODataResponse<
  CollectionQueryData<E, Q, O>,
  CollectionQueryError
> & {
  // Pagination support - added conditionally based on options
  next?: () => Promise<CollectionQueryResponse<E, Q, O>>;
};

// Single query result data
export type SingleQueryData<E = any, Q = any> = {
  data: any;
} & ODataMetadata;

export type SingleQueryError = ODataError;

export type SingleQueryResponse<E = any, Q = any, O = any> = ODataResponse<
  SingleQueryData<E, Q>,
  SingleQueryError
>;

// ============================================================================
// Create Response Types
// ============================================================================

export type CreateResultData<QE = any, O = any> =
  | ({ data: any } & ODataMetadata)
  | { data: undefined };

export type CreateResultError = ODataError;

export type CreateResponse<QE = any, O = any> = ODataResponse<
  CreateResultData<QE, O>,
  CreateResultError
>;

// ============================================================================
// Update Response Types
// ============================================================================

export type UpdateResultData<QE = any, O = any> =
  | ({ data: any } & ODataMetadata)
  | { data: undefined };

export type UpdateResultError = ODataError;

export type UpdateResponse<QE = any, O = any> = ODataResponse<
  UpdateResultData<QE, O>,
  UpdateResultError
>;

// ============================================================================
// Delete Response Types
// ============================================================================

export type DeleteResultData = { data: undefined } & ODataMetadata;

export type DeleteResultError = ODataError;

export type DeleteResponse = ODataResponse<DeleteResultData, DeleteResultError>;

// ============================================================================
// Action & Function Response Types
// ============================================================================

// Action result data
export type ActionResultData<R = any> = {
  data: R extends undefined ? void : R;
} & ODataMetadata;

export type ActionResultError = ODataError;

export type ActionResponse<S = any, R = any> = ODataResponse<
  ActionResultData<R>,
  ActionResultError
>;

// Function result data
export type FunctionResultData<R = any> = {
  data: R;
} & ODataMetadata;

export type FunctionResultError = ODataError;

export type FunctionResponse<S = any, R = any> = ODataResponse<
  FunctionResultData<R>,
  FunctionResultError
>;
