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

// Force a type to resolve to a plain object so tooling shows { subject: string; ... } instead of Pick<MapPropertiesToTS<...>, ...>. Recursive for expand shapes.
export type Simplify<T> = T extends readonly (infer U)[]
  ? Simplify<U>[]
  : T extends object
  ? { -readonly [K in keyof T]: Simplify<T[K]> }
  : T;

// ============================================================================
// Query Response Types
// ============================================================================

import type { QueryableEntity, ODataTypeToTS } from './types';
import type { Schema, ODataType } from './schema';
import type { CollectionQueryObject, SingleQueryObject, SingleExpandObject, QueryOperationOptions } from './query';

// Extract select keys as union type from query object
type ExtractSelectKeys<
  E extends QueryableEntity,
  Q extends { select?: readonly (keyof E['properties'])[] }
> = Q['select'] extends readonly (keyof E['properties'])[]
  ? Q['select'][number]
  : keyof E['properties']; // If no select, return all property keys

// Extract expand result shape recursively.
// Pass S explicitly to query types so nested expand resolution works (ResolveNavigationTarget needs S).
type ExtractExpandShape<
  E extends QueryableEntity,
  Q extends { expand?: Record<string, any> },
  S extends Schema<S> = Schema<any>
> = Q['expand'] extends Record<string, any>
  ? {
      [K in keyof Q['expand'] & keyof E['navigations']]: 
        Q['expand'][K] extends SingleExpandObject<E['navigations'][K]['target'], S> | SingleQueryObject<E['navigations'][K]['target'], S> | CollectionQueryObject<E['navigations'][K]['target'], S>
          ? E['navigations'][K]['collection'] extends true
            ? Array<ExtractQueryResultShape<E['navigations'][K]['target'], Q['expand'][K], S>>
            : ExtractQueryResultShape<E['navigations'][K]['target'], Q['expand'][K], S>
          : never;
    }
  : {};

// Extract the result shape from a query object (exported so method return types can use it without pulling in full schema).
export type ExtractQueryResultShape<
  E extends QueryableEntity,
  Q extends { select?: readonly (keyof E['properties'])[]; expand?: Record<string, any> },
  S extends Schema<S> = Schema<any>
> = Pick<E['properties'], ExtractSelectKeys<E, Q>> & ExtractExpandShape<E, Q, S>;

// Collection query result data.
// Sch is passed explicitly (infer S from Q fails when expand is present, same as SingleQueryData).
export type CollectionQueryData<
  E extends QueryableEntity = any,
  Q extends CollectionQueryObject<E, any> = any,
  O = any,
  Sch extends Schema<Sch> = Schema<any>
> = {
  value: ExtractQueryResultShape<E, Q, Sch>[];
} & ODataMetadata;

export type CollectionQueryError = ODataError;

// Response has .next only when the initial request included prefer.maxpagesize (paged request).
export type CollectionQueryResponse<
  E extends QueryableEntity = any,
  Q extends CollectionQueryObject<E, any> = any,
  O = any,
  Sch extends Schema<Sch> = Schema<any>
> = ODataResponse<
  CollectionQueryData<E, Q, O, Sch>,
  CollectionQueryError
> & (O extends { prefer: { maxpagesize: number } }
    ? {
        // Paged response: next() is present; options can be passed for subsequent pages (e.g. prefer.maxpagesize).
        next: (options?: QueryOperationOptions) => Promise<CollectionQueryResponse<E, Q, O, Sch>>;
      }
    : {
        // Non-paged response: next is not part of the type.
      });

// Single query result data
// S is passed from the client so we don't rely on infer S from Q (which fails when expand is present).
export type SingleQueryData<
  E extends QueryableEntity = any,
  Q extends SingleQueryObject<E, any> = any,
  S extends Schema<S> = Schema<any>
> = ExtractQueryResultShape<E, Q, S> & ODataMetadata;

export type SingleQueryError = ODataError;

export type SingleQueryResponse<
  E extends QueryableEntity = any,
  Q extends SingleQueryObject<E> = any,
  O = any,
  Sch extends Schema<Sch> = Schema<any>
> = ODataResponse<
  SingleQueryData<E, Q, Sch>,
  SingleQueryError
>;

// Optimized single-query return type: parameterized only by the result shape so method signatures stay small.
export type SingleQueryResponseByResult<TResult = any> = ODataResponse<
  TResult & ODataMetadata,
  SingleQueryError
>;

// Optimized collection-query return type: parameterized by result item shape and options (for next() typing).
export type CollectionQueryResponseByResult<
  TResult = any,
  O = any
> = ODataResponse<
  { value: TResult[] } & ODataMetadata,
  CollectionQueryError
> & (O extends { prefer: { maxpagesize: number } }
  ? {
      next: (options?: QueryOperationOptions) => Promise<CollectionQueryResponseByResult<TResult, O>>;
    }
  : {});

// ============================================================================
// Create Response Types
// ============================================================================

// Extract select keys as union type from options tuple (for create/update)
type ExtractSelectKeysForOperation<
  QE extends { properties: Record<string, any> },
  Select extends readonly (keyof QE['properties'])[]
> = Select[number];

// Determine data type based on options
type CreateDataShape<
  QE extends QueryableEntity,
  O extends { select?: readonly (keyof QE['properties'])[]; prefer?: { return_representation?: boolean } }
> = O['prefer'] extends { return_representation: true }
  ? QE['properties'] // Return all properties when return_representation is true
  : O['select'] extends readonly (keyof QE['properties'])[]
  ? Pick<QE['properties'], ExtractSelectKeysForOperation<QE, O['select']>> // Return selected properties
  : undefined; // No data returned when no select and no return_representation

export type CreateResultData<
  QE extends QueryableEntity = any,
  O extends { select?: readonly (keyof QE['properties'])[]; prefer?: { return_representation?: boolean } } = any
> = O['prefer'] extends { return_representation: true }
  ? CreateDataShape<QE, O> & ODataMetadata
  : O['select'] extends readonly (keyof QE['properties'])[]
  ? CreateDataShape<QE, O> & ODataMetadata
  : ODataMetadata;

export type CreateResultError = ODataError;

export type CreateResponse<
  QE extends QueryableEntity = any,
  O extends { select?: readonly (keyof QE['properties'])[]; prefer?: { return_representation?: boolean } } = any
> = ODataResponse<
  CreateResultData<QE, O>,
  CreateResultError
>;

// ============================================================================
// Update Response Types
// ============================================================================

export type UpdateResultData<
  QE extends QueryableEntity = any,
  O extends { select?: readonly (keyof QE['properties'])[]; prefer?: { return_representation?: boolean } } = any
> = CreateResultData<QE, O>;

export type UpdateResultError = CreateResultError;

export type UpdateResponse<
  QE extends QueryableEntity = any,
  O extends { select?: readonly (keyof QE['properties'])[]; prefer?: { return_representation?: boolean } } = any
> = CreateResponse<QE, O>;

// ============================================================================
// Delete Response Types
// ============================================================================

export type DeleteResultData = ODataMetadata;

export type DeleteResultError = ODataError;

export type DeleteResponse = ODataResponse<DeleteResultData, DeleteResultError>;

// ============================================================================
// Action & Function Response Types
// ============================================================================

// Action result data
export type ActionResultData<R = any> = R extends undefined | void
  ? ODataMetadata
  : R & ODataMetadata;

export type ActionResultError = ODataError;

export type ActionResponse<
  S extends Schema<S> = any, 
  R extends ODataType<any> | undefined = undefined
> = R extends undefined
  ? ODataResponse<ActionResultData<void>, ActionResultError>
  : ODataResponse<ActionResultData<ODataTypeToTS<Exclude<R, undefined>, S>>, ActionResultError>;

// Function result data
export type FunctionResultData<R = any> = R & ODataMetadata;

export type FunctionResultError = ODataError;

export type FunctionResponse<
  S extends Schema<S> = any, 
  R extends ODataType<any> = any
> = ODataResponse<
  FunctionResultData<ODataTypeToTS<R, S>>,
  FunctionResultError
>;
