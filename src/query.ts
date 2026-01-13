// ============================================================================
// Query Object Types
// ============================================================================

import type { QueryableEntity, EntitySetToQueryableEntity } from './types';
import type { Schema } from './schema';
import type { FilterHelpers, FilterBuilder } from './filter';

// Query operation options
export type QueryOperationOptions = {
  prefer?: {
    maxpagesize?: number;
    return_representation?: boolean;
  };
  headers?: Record<string, string>;
};

// Helper to resolve navigation target QueryableEntity from targetEntitysetKey
type ResolveNavigationTarget<
  S extends Schema<S>,
  TargetKey extends string | string[]
> = TargetKey extends string
  ? TargetKey extends keyof S['entitysets']
    ? EntitySetToQueryableEntity<S, TargetKey>
    : QueryableEntity
  : QueryableEntity; // For union types (array), fall back to base type

// Single expand object - only select and expand (for single-valued navigations)
export type SingleExpandObject<
  E extends QueryableEntity,
  S extends Schema<S> = Schema<any>
> = {
  select?: readonly (keyof E['properties'])[];
  expand?: {
    [K in keyof E['navigations']]?: E['navigations'][K]['targetEntitysetKey'] extends string | string[]
      ? E['navigations'][K]['collection'] extends true
        ? CollectionQueryObject<ResolveNavigationTarget<S, E['navigations'][K]['targetEntitysetKey']>, S>
        : SingleExpandObject<ResolveNavigationTarget<S, E['navigations'][K]['targetEntitysetKey']>, S>
      : never;
  };
};

// Base query object (shared by collection and single)
type BaseQueryObject<
  E extends QueryableEntity,
  S extends Schema<S> = Schema<any>
> = {
  select?: readonly (keyof E['properties'])[];
  expand?: {
    [K in keyof E['navigations']]?: E['navigations'][K]['targetEntitysetKey'] extends string | string[]
      ? E['navigations'][K]['collection'] extends true
        ? CollectionQueryObject<ResolveNavigationTarget<S, E['navigations'][K]['targetEntitysetKey']>, S>
        : SingleExpandObject<ResolveNavigationTarget<S, E['navigations'][K]['targetEntitysetKey']>, S>
      : never;
  };
  filter?: (h: FilterHelpers<E, S>) => FilterBuilder<E>;
  orderby?: readonly [keyof E['properties'], 'asc' | 'desc'];
};

// Collection query object
export type CollectionQueryObject<
  E extends QueryableEntity,
  S extends Schema<S> = Schema<any>
> = BaseQueryObject<E, S> & {
  top?: number;
  skip?: number;
  count?: boolean;
};

// Single query object - only select and expand (no filter/orderby)
export type SingleQueryObject<
  E extends QueryableEntity,
  S extends Schema<S> = Schema<any>
> = {
  select?: readonly (keyof E['properties'])[];
  expand?: {
    [K in keyof E['navigations']]?: E['navigations'][K]['targetEntitysetKey'] extends string | string[]
      ? E['navigations'][K]['collection'] extends true
        ? CollectionQueryObject<ResolveNavigationTarget<S, E['navigations'][K]['targetEntitysetKey']>, S>
        : SingleExpandObject<ResolveNavigationTarget<S, E['navigations'][K]['targetEntitysetKey']>, S>
      : never;
  };
};

// Query result data types (simplified for now, will be properly typed later)
export type CollectionQueryResultData<E extends QueryableEntity, Q extends CollectionQueryObject<E>> = {
  data: any[];
};

export type SingleQueryResultData<E extends QueryableEntity, Q extends SingleQueryObject<E>> = {
  data: any;
};
