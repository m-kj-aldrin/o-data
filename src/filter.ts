// ============================================================================
// Filter Types
// ============================================================================

import type { QueryableEntity, EntitySetToQueryableEntity } from './types';
import type { Schema } from './schema';

// Helper to resolve navigation target QueryableEntity from targetEntitysetKey
type ResolveNavTarget<
  S extends Schema<S>,
  Nav extends { targetEntitysetKey: string | string[] }
> = Nav['targetEntitysetKey'] extends infer TargetKey
  ? TargetKey extends string
    ? TargetKey extends keyof S['entitysets']
      ? EntitySetToQueryableEntity<S, TargetKey>
      : QueryableEntity
    : QueryableEntity
  : QueryableEntity;

// Helper to extract target entityset key from navigation
type NavTargetKey<TEntity extends QueryableEntity, N extends keyof TEntity['navigations']> = 
  TEntity['navigations'][N]['targetEntitysetKey'];

// Helper to resolve navigation target QueryableEntity
type ResolveNavTargetQE<
  S extends Schema<S>,
  TEntity extends QueryableEntity,
  N extends keyof TEntity['navigations']
> = NavTargetKey<TEntity, N> extends string
  ? NavTargetKey<TEntity, N> extends keyof S['entitysets']
    ? EntitySetToQueryableEntity<S, NavTargetKey<TEntity, N>>
    : QueryableEntity
  : QueryableEntity;

export type ComparisonOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'ge'
  | 'lt'
  | 'le'
  | 'contains'
  | 'startswith'
  | 'endswith'
  | 'in';

export type FilterableProperty<TEntity extends QueryableEntity> = keyof TEntity['properties'];

// For now, property values are typed as any since QueryableEntity properties are any
// This can be improved later with proper PropertyTypeToTS conversion
export type FilterPropertyValueType<
  TEntity extends QueryableEntity,
  P extends FilterableProperty<TEntity>
> = any;

export type CollectionNavKeys<TEntity extends QueryableEntity> = {
  [K in keyof TEntity['navigations']]: TEntity['navigations'][K]['collection'] extends true
    ? K
    : never;
}[keyof TEntity['navigations']];

export type SingleNavKeys<TEntity extends QueryableEntity> = {
  [K in keyof TEntity['navigations']]: TEntity['navigations'][K]['collection'] extends true
    ? never
    : K;
}[keyof TEntity['navigations']];

export interface FilterBuilder<TEntity extends QueryableEntity> {
  and: (expr: FilterBuilder<TEntity>) => FilterBuilder<TEntity>;
  or: (expr: FilterBuilder<TEntity>) => FilterBuilder<TEntity>;
  __brand: 'FilterBuilder';
}

export interface FilterHelpers<TEntity extends QueryableEntity, S extends Schema<S> = Schema<any>> {
  /**
   * Filter on a simple scalar property of the current entity.
   */
  clause: <P extends FilterableProperty<TEntity>>(
    prop: P,
    op: ComparisonOperator,
    value: FilterPropertyValueType<TEntity, P>
  ) => FilterBuilder<TEntity>;

  /**
   * Filter on a Single-Valued Navigation Property (Lookup).
   * This allows "stepping into" a related entity to filter on its properties.
   */
  nav: <N extends SingleNavKeys<TEntity>>(
    nav: N,
    cb: (
      h: FilterHelpers<ResolveNavTargetQE<S, TEntity, N>, S>
    ) => FilterBuilder<ResolveNavTargetQE<S, TEntity, N>>
  ) => FilterBuilder<TEntity>;

  /**
   * Filter on a Collection Navigation Property using 'any' (at least one match).
   */
  any: <N extends CollectionNavKeys<TEntity>>(
    nav: N,
    cb: (
      h: FilterHelpers<ResolveNavTargetQE<S, TEntity, N>, S>
    ) => FilterBuilder<ResolveNavTargetQE<S, TEntity, N>>
  ) => FilterBuilder<TEntity>;

  /**
   * Filter on a Collection Navigation Property using 'all' (all must match).
   */
  all: <N extends CollectionNavKeys<TEntity>>(
    nav: N,
    cb: (
      h: FilterHelpers<ResolveNavTargetQE<S, TEntity, N>, S>
    ) => FilterBuilder<ResolveNavTargetQE<S, TEntity, N>>
  ) => FilterBuilder<TEntity>;
}
