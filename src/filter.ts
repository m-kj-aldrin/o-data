// ============================================================================
// Filter Types
// ============================================================================

import type { QueryableEntity, EntitySetToQueryableEntity } from './types';
import type { Schema } from './schema';
import { buildQueryableEntity } from './runtime';

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

// ============================================================================
// Filter Builder Runtime Implementation
// ============================================================================

class FilterBuilderImpl<TEntity extends QueryableEntity> implements FilterBuilder<TEntity> {
  public readonly state: any[];

  constructor(initialState: any[]) {
    this.state = initialState;
  }

  and(expr: FilterBuilder<TEntity>): FilterBuilder<TEntity> {
    return new FilterBuilderImpl([...this.state, 'and', (expr as FilterBuilderImpl<any>).state]);
  }

  or(expr: FilterBuilder<TEntity>): FilterBuilder<TEntity> {
    return new FilterBuilderImpl([...this.state, 'or', (expr as FilterBuilderImpl<any>).state]);
  }

  __brand: 'FilterBuilder' = 'FilterBuilder' as const;
}

export function createFilterHelpers<TEntity extends QueryableEntity, S extends Schema<S> = Schema<any>>(
  entityDef: TEntity,
  schema?: S
): FilterHelpers<TEntity, S> {
  const clause = <P extends FilterableProperty<TEntity>>(
    property: P,
    operator: ComparisonOperator,
    value: FilterPropertyValueType<TEntity, P>
  ): FilterBuilder<TEntity> => {
    return new FilterBuilderImpl([[property, operator, value]]);
  };

  // Helper to recursively update paths in the builder state
  const prependPathToState = (state: any[], prefix: string): any[] => {
    return state.map((item) => {
      if (Array.isArray(item)) {
        // Check if it's a clause tuple [property, operator, value]
        const ops = [
          'eq',
          'ne',
          'gt',
          'ge',
          'lt',
          'le',
          'contains',
          'startswith',
          'endswith',
          'in',
        ];
        if (
          item.length === 3 &&
          typeof item[0] === 'string' &&
          typeof item[1] === 'string' &&
          ops.includes(item[1])
        ) {
          return [`${prefix}/${item[0]}`, item[1], item[2]];
        } else {
          return prependPathToState(item, prefix);
        }
      } else if (typeof item === 'object' && item !== null && item.kind === 'lambda') {
        // Update lambda navigation path
        return { ...item, nav: `${prefix}/${item.nav}` };
      }
      return item;
    });
  };

  const nav = <N extends SingleNavKeys<TEntity>>(
    navKey: N,
    cb: (
      h: FilterHelpers<ResolveNavTargetQE<S, TEntity, N>, S>
    ) => FilterBuilder<ResolveNavTargetQE<S, TEntity, N>>
  ): FilterBuilder<TEntity> => {
    const navDef = entityDef.navigations[navKey as keyof typeof entityDef.navigations];
    if (!navDef) {
      throw new Error(`Navigation ${String(navKey)} not found`);
    }

    // At runtime, target is a string (entitytype name), need to resolve to QueryableEntity
    if (!schema) {
      throw new Error('Schema required for navigation filters');
    }
    const targetEntitytypeName = navDef.target as string;
    const targetEntitysetKey = navDef.targetEntitysetKey;
    const targetEntity = buildQueryableEntity(schema, targetEntitysetKey);
    const innerHelpers = createFilterHelpers(targetEntity, schema);
    const innerBuilder = cb(innerHelpers);

    // Transform the inner state by prepending the navigation key
    const innerState = (innerBuilder as FilterBuilderImpl<any>).state;
    const scopedState = prependPathToState(innerState, String(navKey));

    return new FilterBuilderImpl(scopedState);
  };

  const any = <N extends CollectionNavKeys<TEntity>>(
    nav: N,
    cb: (
      h: FilterHelpers<ResolveNavTargetQE<S, TEntity, N>, S>
    ) => FilterBuilder<ResolveNavTargetQE<S, TEntity, N>>
  ): FilterBuilder<TEntity> => {
    const navDef = entityDef.navigations[nav as keyof typeof entityDef.navigations];
    if (!navDef) {
      throw new Error(`Navigation ${String(nav)} not found`);
    }
    if (!schema) {
      throw new Error('Schema required for navigation filters');
    }
    const targetEntitysetKey = navDef.targetEntitysetKey;
    const targetEntity = buildQueryableEntity(schema, targetEntitysetKey);
    const innerHelpers = createFilterHelpers(targetEntity, schema);
    const innerBuilder = cb(innerHelpers);
    const lambdaState = {
      kind: 'lambda',
      op: 'any',
      nav: nav as string,
      predicate: (innerBuilder as FilterBuilderImpl<any>).state,
    };
    return new FilterBuilderImpl([lambdaState]);
  };

  const all = <N extends CollectionNavKeys<TEntity>>(
    nav: N,
    cb: (
      h: FilterHelpers<ResolveNavTargetQE<S, TEntity, N>, S>
    ) => FilterBuilder<ResolveNavTargetQE<S, TEntity, N>>
  ): FilterBuilder<TEntity> => {
    const navDef = entityDef.navigations[nav as keyof typeof entityDef.navigations];
    if (!navDef) {
      throw new Error(`Navigation ${String(nav)} not found`);
    }
    if (!schema) {
      throw new Error('Schema required for navigation filters');
    }
    const targetEntitysetKey = navDef.targetEntitysetKey;
    const targetEntity = buildQueryableEntity(schema, targetEntitysetKey);
    const innerHelpers = createFilterHelpers(targetEntity, schema);
    const innerBuilder = cb(innerHelpers);
    const lambdaState = {
      kind: 'lambda',
      op: 'all',
      nav: nav as string,
      predicate: (innerBuilder as FilterBuilderImpl<any>).state,
    };
    return new FilterBuilderImpl([lambdaState]);
  };

  return { clause, nav, any, all };
}

// ============================================================================
// Filter Serialization
// ============================================================================

export function serializeFilter(
  filterState: any[],
  depth = 0,
  lambdaVar?: string,
  entityDef?: QueryableEntity
): string {
  if (filterState.length === 0) {
    return '';
  }

  // Handle lambda
  if (
    filterState.length === 1 &&
    typeof filterState[0] === 'object' &&
    filterState[0] !== null &&
    filterState[0].kind === 'lambda'
  ) {
    const lambda = filterState[0];
    const varName = lambdaVar || `p${depth}`;
    let lambdaEntityDef: QueryableEntity | undefined;
    if (entityDef && lambda.nav in entityDef.navigations) {
      // For lambda navigation, we need to resolve the target entity
      // The nav might be a path (e.g., A/B/C), so we take the first part
      const firstPart = lambda.nav.split('/')[0];
      const nav = entityDef.navigations[firstPart as keyof typeof entityDef.navigations];
      if (nav) {
        // At runtime, target is a string, but we don't have schema here
        // We'll pass undefined and let serializeClause handle it
        lambdaEntityDef = undefined;
      }
    }
    const predicate = serializeFilter(lambda.predicate, depth + 1, varName, lambdaEntityDef);
    return `${lambda.nav}/${lambda.op}(${varName}:${predicate})`;
  }

  // Handle clause
  if (filterState.length === 3 && typeof filterState[0] === 'string') {
    const [property, operator, value] = filterState;
    const qualifiedProperty = lambdaVar ? `${lambdaVar}/${property}` : property;
    return serializeClause(qualifiedProperty, operator, value, entityDef, property);
  }

  // Handle logical operators
  let result = '';
  let i = 0;
  while (i < filterState.length) {
    const part = filterState[i];

    if (part === 'and' || part === 'or') {
      const operator = part;
      i++;
      if (i < filterState.length) {
        const right = serializeFilter(
          Array.isArray(filterState[i]) ? filterState[i] : [filterState[i]],
          depth,
          lambdaVar,
          entityDef
        );
        result = `(${result}) ${operator} (${right})`;
      }
    } else {
      const partStr = serializeFilter(
        Array.isArray(part) ? part : [part],
        depth,
        lambdaVar,
        entityDef
      );
      result = result ? `${result} ${partStr}` : partStr;
    }
    i++;
  }

  return result;
}

function serializeClause(
  property: string,
  operator: ComparisonOperator,
  value: any,
  entityDef?: QueryableEntity,
  originalProperty?: string
): string {
  const formatValue = (val: any): string => {
    if (val === null || val === undefined) {
      return 'null';
    }

    // Handle Date values
    if (val instanceof Date || (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val))) {
      let dateValue: Date;
      if (val instanceof Date) {
        dateValue = val;
      } else {
        dateValue = new Date(val);
      }
      // Default to ISO format (DateTimeOffset)
      return dateValue.toISOString();
    }

    // Handle strings
    if (typeof val === 'string') {
      return `'${val.replace(/'/g, "''")}'`;
    }

    // Handle arrays (for 'in' operator)
    if (Array.isArray(val)) {
      return `(${val.map(formatValue).join(',')})`;
    }

    // Handle numbers and booleans
    return String(val);
  };

  // Handle string functions
  if (operator === 'contains' || operator === 'startswith' || operator === 'endswith') {
    return `${operator}(${property},${formatValue(value)})`;
  }

  // Handle 'in' operator
  if (operator === 'in') {
    if (!Array.isArray(value)) {
      throw new Error(`'in' operator requires an array value`);
    }
    return `${property} in ${formatValue(value)}`;
  }

  // Standard comparison operators
  return `${property} ${operator} ${formatValue(value)}`;
}
