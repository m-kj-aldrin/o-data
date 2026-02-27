// ============================================================================
// Operation Types
// ============================================================================

import type { QueryableEntity, ODataTypeToTS, EntitySetsForEntityType, EntitySetToQueryableEntity } from './types';
import type { Schema, ODataType, NavigationType } from './schema';

// ============================================================================
// Helper Types
// ============================================================================

// Check if a type includes null (is nullable)
type IsNullable<T> = null extends T ? true : false;

// Make properties writable (remove readonly)
type Writable<T> = {
  -readonly [K in keyof T]: T[K];
};

// Extract property types and make writable
type WritablePropertyTypes<QE extends QueryableEntity> = Writable<QE['properties']>;

// ============================================================================
// Property Types for Create/Update
// ============================================================================

// Required properties (non-nullable) - required in CreateObject
type RequiredCreateProperties<QE extends QueryableEntity> = {
  [K in keyof QE['properties'] as IsNullable<QE['properties'][K]> extends true 
    ? never 
    : K]: WritablePropertyTypes<QE>[K];
};

// Optional properties (nullable) - optional in CreateObject
type OptionalCreateProperties<QE extends QueryableEntity> = {
  [K in keyof QE['properties'] as IsNullable<QE['properties'][K]> extends true 
    ? K 
    : never]?: WritablePropertyTypes<QE>[K];
};

// Combined create properties
type CreatePropertyTypes<QE extends QueryableEntity> = 
  RequiredCreateProperties<QE> & OptionalCreateProperties<QE>;

// Update properties - all optional
type UpdatePropertyTypes<QE extends QueryableEntity> = {
  [K in keyof QE['properties']]?: WritablePropertyTypes<QE>[K];
};

// ============================================================================
// Navigation Types
// ============================================================================

// Extract target QueryableEntity from navigation
type NavTargetEntity<N extends { target: any }> = N['target'];

// Resolve entityset key type for explicit tuple format
type NavEntitysetKey<N extends { targetEntitysetKey: string | string[] }> = 
  N['targetEntitysetKey'] extends string 
    ? N['targetEntitysetKey']
    : N['targetEntitysetKey'] extends (infer T)[] 
      ? T 
      : never;

// Forward reference type for CreateObject (needed for recursive navigation types)
type _CreateObject<QE extends QueryableEntity> = 
  CreatePropertyTypes<QE> & 
  CreateNavigationProperties<QE>;

// Create navigation value type
type CreateNavigationValue<N extends { collection: boolean; target: any; targetEntitysetKey: string | string[] }> = 
  N['collection'] extends true
    ? // Collection navigation
      | string[]
      | number[]
      | [NavEntitysetKey<N>, string | number][]  // Explicit entitysets
      | _CreateObject<NavTargetEntity<N>>[]  // Deep inserts
    : // Single-valued navigation
      | string
      | number
      | [NavEntitysetKey<N>, string | number]  // Explicit entityset
      | _CreateObject<NavTargetEntity<N>>;  // Deep insert

// Create navigation properties
type CreateNavigationProperties<QE extends QueryableEntity> = {
  [K in keyof QE['navigations']]?: CreateNavigationValue<QE['navigations'][K]>;
};

// Single-valued navigation update value
type SingleNavUpdateValue<N extends { collection: boolean; targetEntitysetKey: string | string[] }> =
  N['collection'] extends true
    ? never  // Collections use CollectionNavUpdateSpec
    : string | number | [NavEntitysetKey<N>, string | number] | null;

// Collection navigation update spec
type CollectionNavUpdateSpec = {
  replace?: (string | number | [string, string | number])[];
  add?: (string | number | [string, string | number])[];
  remove?: (string | number | [string, string | number])[];
};

// Single-valued navigation updates
type SingleNavUpdates<QE extends QueryableEntity> = {
  [K in keyof QE['navigations'] as QE['navigations'][K]['collection'] extends true 
    ? never 
    : K]?: SingleNavUpdateValue<QE['navigations'][K]>;
};

// Collection navigation updates
type CollectionNavUpdates<QE extends QueryableEntity> = {
  [K in keyof QE['navigations'] as QE['navigations'][K]['collection'] extends true 
    ? K 
    : never]?: CollectionNavUpdateSpec;
};

// ============================================================================
// Create/Update Object Types
// ============================================================================

// Create object - all properties optional except required ones, plus navigation properties
export type CreateObject<QE extends QueryableEntity> = _CreateObject<QE>;

// Update object - all properties optional, plus navigation properties
export type UpdateObject<QE extends QueryableEntity> = 
  UpdatePropertyTypes<QE> & 
  SingleNavUpdates<QE> & 
  CollectionNavUpdates<QE>;

// Create operation options
export type CreateOperationOptions<QE extends QueryableEntity> = {
  prefer?: {
    return_representation?: boolean;
  };
  select?: readonly (keyof QE['properties'])[];
  headers?: Record<string, string>;
};

// Update operation options
export type UpdateOperationOptions<QE extends QueryableEntity> = {
  prefer?: {
    return_representation?: boolean;
  };
  select?: readonly (keyof QE['properties'])[];
  headers?: Record<string, string>;
};

// ============================================================================
// Operation Parameters
// ============================================================================

// Navigation parameter value type - maps navigation types to union of string/number/tuple/object
type NavigationParameterValue<
  S extends Schema<S>,
  N extends NavigationType<any>
> = N extends NavigationType<infer Target>
  ? Target extends keyof S['entitytypes']
    ? EntitySetsForEntityType<S, Target> extends infer EntitySetKey
      ? EntitySetKey extends string
        ? N['collection'] extends true
          ? // Collection navigation parameter
            | string[]
            | number[]
            | [EntitySetKey, string | number][]
            | CreateObject<EntitySetToQueryableEntity<S, EntitySetKey>>[]
          : // Single-valued navigation parameter
            | string
            | number
            | [EntitySetKey, string | number]
            | CreateObject<EntitySetToQueryableEntity<S, EntitySetKey>>
        : N['collection'] extends true
        ? string[] | number[] | [string, string | number][] | any[]
        : string | number | [string, string | number] | any
      : N['collection'] extends true
      ? string[] | number[] | [string, string | number][] | any[]
      : string | number | [string, string | number] | any
    : never
  : never;

// Map each parameter using ODataTypeToTS or NavigationParameterValue
type MappedParameters<
  S extends Schema<S>,
  P extends Record<string, ODataType<any>>
> = {
  [K in keyof P]: P[K] extends NavigationType<any>
    ? NavigationParameterValue<S, P[K]>
    : ODataTypeToTS<P[K], S>;
};

// Required parameters (non-nullable)
type RequiredOperationParameters<
  S extends Schema<S>,
  P extends Record<string, ODataType<any>>
> = {
  [K in keyof MappedParameters<S, P> as IsNullable<MappedParameters<S, P>[K]> extends true ? never : K]: 
    MappedParameters<S, P>[K];
};

// Optional parameters (nullable)
type OptionalOperationParameters<
  S extends Schema<S>,
  P extends Record<string, ODataType<any>>
> = {
  [K in keyof MappedParameters<S, P> as IsNullable<MappedParameters<S, P>[K]> extends true ? K : never]?: 
    MappedParameters<S, P>[K];
};

// Operation parameters - convert ODataType to TypeScript types
export type OperationParameters<
  S extends Schema<S>,
  P extends Record<string, ODataType<any>>
> = RequiredOperationParameters<S, P> & OptionalOperationParameters<S, P>;
