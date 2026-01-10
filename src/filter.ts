import type { QueryableEntity, PropertyTypeToTS, PropertyDef } from './schema';

// ============================================================================
// Filter Types
// ============================================================================

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

// REMOVED: NavPropPath (Complex recursive type causing performance issues)

export type FilterableProperty<TEntity extends QueryableEntity> = keyof TEntity['properties'];

export type FilterPropertyValueType<
  TEntity extends QueryableEntity,
  P extends FilterableProperty<TEntity>
> = PropertyTypeToTS<TEntity['properties'][P]>;

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

export interface FilterHelpers<TEntity extends QueryableEntity> {
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
   * Example: h.nav('customerid_account', h => h.clause('name', 'eq', 'Acme'))
   */
  nav: <N extends SingleNavKeys<TEntity>>(
    nav: N,
    cb: (
      h: FilterHelpers<TEntity['navigations'][N]['target']>
    ) => FilterBuilder<TEntity['navigations'][N]['target']>
  ) => FilterBuilder<TEntity>;

  /**
   * Filter on a Collection Navigation Property using 'any' (at least one match).
   */
  any: <N extends CollectionNavKeys<TEntity>>(
    nav: N,
    cb: (
      h: FilterHelpers<TEntity['navigations'][N]['target']>
    ) => FilterBuilder<TEntity['navigations'][N]['target']>
  ) => FilterBuilder<TEntity>;

  /**
   * Filter on a Collection Navigation Property using 'all' (all must match).
   */
  all: <N extends CollectionNavKeys<TEntity>>(
    nav: N,
    cb: (
      h: FilterHelpers<TEntity['navigations'][N]['target']>
    ) => FilterBuilder<TEntity['navigations'][N]['target']>
  ) => FilterBuilder<TEntity>;
}

// ============================================================================
// Filter Builder Implementation
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

export function createFilterHelpers<TEntity extends QueryableEntity>(
  entityDef: TEntity
): FilterHelpers<TEntity> {
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
        // Recursively handle nested groups or clauses
        // A clause is roughly identifiable if it looks like [prop, op, val] where op is a known string
        // But simpler: just recurse arrays. If it's a clause [p, op, v], p is index 0.
        // We need to distinguish a Clause array from a Group array.
        // In this impl:
        // Clause: [string, string, any]
        // Group/State: [Clause | 'and' | Group ...]

        // Heuristic: If it's a Clause tuple (length 3, index 1 is operator)
        // Operators are specific strings.
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
        // Update lambda navigation path: { kind: 'lambda', nav: '...', ... }
        return { ...item, nav: `${prefix}/${item.nav}` };
      }
      return item;
    });
  };

  const nav = <N extends SingleNavKeys<TEntity>>(
    navKey: N,
    cb: (
      h: FilterHelpers<TEntity['navigations'][N]['target']>
    ) => FilterBuilder<TEntity['navigations'][N]['target']>
  ): FilterBuilder<TEntity> => {
    const navDef = entityDef.navigations[navKey as keyof typeof entityDef.navigations];
    if (!navDef) {
      throw new Error(`Navigation ${String(navKey)} not found`);
    }

    const targetEntity = navDef.target;
    const innerHelpers = createFilterHelpers(targetEntity);
    const innerBuilder = cb(innerHelpers);

    // Transform the inner state by prepending the navigation key
    const innerState = (innerBuilder as FilterBuilderImpl<any>).state;
    const scopedState = prependPathToState(innerState, String(navKey));

    return new FilterBuilderImpl(scopedState);
  };

  const any = <N extends CollectionNavKeys<TEntity>>(
    nav: N,
    cb: (
      h: FilterHelpers<TEntity['navigations'][N]['target']>
    ) => FilterBuilder<TEntity['navigations'][N]['target']>
  ): FilterBuilder<TEntity> => {
    const navDef = entityDef.navigations[nav as keyof typeof entityDef.navigations];
    if (!navDef) {
      throw new Error(`Navigation ${String(nav)} not found`);
    }
    const targetEntity = navDef.target;
    const innerHelpers = createFilterHelpers(targetEntity);
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
      h: FilterHelpers<TEntity['navigations'][N]['target']>
    ) => FilterBuilder<TEntity['navigations'][N]['target']>
  ): FilterBuilder<TEntity> => {
    const navDef = entityDef.navigations[nav as keyof typeof entityDef.navigations];
    if (!navDef) {
      throw new Error(`Navigation ${String(nav)} not found`);
    }
    const targetEntity = navDef.target;
    const innerHelpers = createFilterHelpers(targetEntity);
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
    filterState[0].kind === 'lambda'
  ) {
    const lambda = filterState[0];
    const varName = lambdaVar || `p${depth}`;
    let lambdaEntityDef: QueryableEntity | undefined;
    if (entityDef && lambda.nav in entityDef.navigations) {
      // Note: lambda.nav might be a path now (e.g. A/B/C)
      // Resolving nested definitions for validation is complex without full schema traversal.
      // We accept loose typing here or could implement path walking if strict validation is required.
      // For now, we skip deep validation for nested paths to keep it simple.
      const firstPart = lambda.nav.split('/')[0];
      const nav = entityDef.navigations[firstPart as keyof typeof entityDef.navigations];
      if (nav && 'target' in nav && typeof nav.target === 'object') {
        lambdaEntityDef = nav.target as QueryableEntity;
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
  const getPropertyType = (propName: string): PropertyDef | undefined => {
    if (!entityDef) return undefined;
    // Attempt to resolve property type from the root entity definition
    // For nested paths (Nav/Prop), this check is optimistic (checks if Prop exists on Root).
    // It works correctly for simple cases and ensures Date formatting works if property names are unique/consistent.
    const actualProp = propName.includes('/') ? propName.split('/').pop() : propName;
    if (actualProp && actualProp in entityDef.properties) {
      return entityDef.properties[actualProp as keyof typeof entityDef.properties];
    }
    return undefined;
  };

  const formatValue = (val: any): string => {
    if (val === null || val === undefined) {
      return 'null';
    }

    if (val instanceof Date || (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val))) {
      const propType = getPropertyType(originalProperty || property);
      const isDateOnly =
        propType === 'date' || (typeof propType === 'object' && propType.type === 'date');
      const isDateTimeOffset =
        propType === 'datetimeoffset' ||
        (typeof propType === 'object' && propType.type === 'datetimeoffset');

      let dateValue: Date;
      if (val instanceof Date) {
        dateValue = val;
      } else {
        dateValue = new Date(val);
      }

      if (isDateOnly) {
        const year = dateValue.getUTCFullYear();
        const month = String(dateValue.getUTCMonth() + 1).padStart(2, '0');
        const day = String(dateValue.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      } else if (isDateTimeOffset) {
        return dateValue.toISOString();
      } else {
        return dateValue.toISOString();
      }
    }

    if (typeof val === 'string') {
      return `'${val.replace(/'/g, "''")}'`;
    }
    if (Array.isArray(val)) {
      return `(${val.map(formatValue).join(',')})`;
    }
    return String(val);
  };

  if (operator === 'contains' || operator === 'startswith' || operator === 'endswith') {
    return `${operator}(${property},${formatValue(value)})`;
  }

  if (operator === 'in') {
    if (!Array.isArray(value)) {
      throw new Error(`'in' operator requires an array value`);
    }
    return `${property} in ${formatValue(value)}`;
  }

  return `${property} ${operator} ${formatValue(value)}`;
}
