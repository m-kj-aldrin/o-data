// ============================================================================
// Query String Serialization
// ============================================================================

import type { QueryableEntity } from './types';
import type { CollectionQueryObject, SingleQueryObject, SingleExpandObject } from './query';
import { createFilterHelpers, serializeFilter } from './filter';
import { buildQueryableEntity } from './runtime';
import type { Schema } from './schema';

// ============================================================================
// Serialize Expand Options
// ============================================================================

function serializeExpandOptions<S extends Schema<S>>(
  navQuery: SingleExpandObject<any> | SingleQueryObject<any> | CollectionQueryObject<any>,
  navEntityDef: QueryableEntity | undefined,
  schema: S
): string {
  const nestedParams: string[] = [];
  
  if (navQuery.select) {
    nestedParams.push(`$select=${navQuery.select.join(',')}`);
  }
  
  if (navQuery.expand) {
    const nestedExpandParams: string[] = [];
    for (const [nestedNavKey, nestedNavQuery] of Object.entries(navQuery.expand)) {
      if (nestedNavQuery) {
        let nestedNavEntityDef: QueryableEntity | undefined;
        if (navEntityDef && nestedNavKey in navEntityDef.navigations) {
          const nav = navEntityDef.navigations[nestedNavKey as keyof typeof navEntityDef.navigations];
          if (nav) {
            const targetEntitysetKey = nav.targetEntitysetKey;
            nestedNavEntityDef = buildQueryableEntity(schema, targetEntitysetKey);
          }
        }
        const nestedExpandOptionsStr = serializeExpandOptions(nestedNavQuery, nestedNavEntityDef, schema);
        nestedExpandParams.push(`${nestedNavKey}${nestedExpandOptionsStr}`);
      }
    }
    if (nestedExpandParams.length > 0) {
      nestedParams.push(`$expand=${nestedExpandParams.join(',')}`);
    }
  }
  
  const collectionQuery = navQuery as CollectionQueryObject<any>;
  if ('top' in collectionQuery && collectionQuery.top !== undefined) {
    nestedParams.push(`$top=${collectionQuery.top}`);
  }
  
  if ('orderby' in collectionQuery && collectionQuery.orderby) {
    const orderby = collectionQuery.orderby;
    // orderby is readonly [keyof Properties, 'asc' | 'desc']
    const [prop, dir] = orderby;
    const orderbyValue = `${String(prop)} ${dir}`;
    nestedParams.push(`$orderby=${orderbyValue}`);
  }
  
  if ('filter' in collectionQuery && collectionQuery.filter) {
    if (typeof collectionQuery.filter === 'function') {
      if (!navEntityDef) {
        throw new Error('Entity definition required for filter builder in expand');
      }
      const helpers = createFilterHelpers(navEntityDef, schema);
      const builder = collectionQuery.filter(helpers);
      const state = (builder as any).state;
      const filterString = serializeFilter(state, 0, undefined, navEntityDef, schema);
      nestedParams.push(`$filter=${encodeURIComponent(filterString)}`);
    }
  }
  
  if ('count' in collectionQuery && collectionQuery.count) {
    nestedParams.push('$count=true');
  }
  
  return nestedParams.length > 0 ? `(${nestedParams.join(';')})` : '';
}

// ============================================================================
// Build Query String
// ============================================================================

export function buildQueryString<S extends Schema<S>>(
  query: SingleQueryObject<any> | CollectionQueryObject<any>,
  entityDef: QueryableEntity,
  schema: S
): string {
  const params: string[] = [];
  
  // $select
  if (query.select) {
    params.push(`$select=${query.select.join(',')}`);
  }
  
  // $expand
  if (query.expand) {
    const expandParams: string[] = [];
    for (const [navKey, navQuery] of Object.entries(query.expand)) {
      if (navQuery) {
        let navEntityDef: QueryableEntity | undefined;
        if (navKey in entityDef.navigations) {
          const nav = entityDef.navigations[navKey as keyof typeof entityDef.navigations];
          if (nav) {
            const targetEntitysetKey = nav.targetEntitysetKey;
            navEntityDef = buildQueryableEntity(schema, targetEntitysetKey);
          }
        }
        const expandOptionsStr = serializeExpandOptions(navQuery, navEntityDef, schema);
        expandParams.push(`${navKey}${expandOptionsStr}`);
      }
    }
    if (expandParams.length > 0) {
      params.push(`$expand=${expandParams.join(',')}`);
    }
  }
  
  // Check if this is a collection query (has collection-specific params or filter/orderby)
  // SingleQueryObject doesn't have filter/orderby, so if they exist, it's a CollectionQueryObject
  const isCollectionQuery = 
    'top' in query || 
    'skip' in query || 
    'count' in query || 
    'filter' in query || 
    'orderby' in query;
  
  if (isCollectionQuery) {
    const collectionQuery = query as CollectionQueryObject<any>;
    
    if ('top' in collectionQuery && collectionQuery.top !== undefined) {
      params.push(`$top=${collectionQuery.top}`);
    }
    
    if ('skip' in collectionQuery && collectionQuery.skip !== undefined) {
      params.push(`$skip=${collectionQuery.skip}`);
    }
    
    if ('orderby' in collectionQuery && collectionQuery.orderby) {
      const orderby = collectionQuery.orderby;
      // orderby is readonly [keyof Properties, 'asc' | 'desc']
      const [prop, dir] = orderby;
      const orderbyValue = `${String(prop)} ${dir}`;
      params.push(`$orderby=${orderbyValue}`);
    }
    
    if ('filter' in collectionQuery && collectionQuery.filter) {
      if (typeof collectionQuery.filter === 'function') {
        const helpers = createFilterHelpers(entityDef, schema);
        const builder = collectionQuery.filter(helpers);
        const state = (builder as any).state;
        const filterString = serializeFilter(state, 0, undefined, entityDef, schema);
        params.push(`$filter=${encodeURIComponent(filterString)}`);
      }
    }
    
    if ('count' in collectionQuery && collectionQuery.count) {
      params.push('$count=true');
    }
  }
  // Note: Single entity queries (SingleQueryObject) only have select and expand,
  // so filter and orderby are not serialized (they don't exist on the type)
  
  return params.length > 0 ? `?${params.join('&')}` : '';
}
