// ============================================================================
// Query String Serialization
// ============================================================================

import type { QueryableEntity } from './types';
import type { CollectionQueryObject, SingleQueryObject, SingleExpandObject } from './query';
import { createFilterHelpers, serializeFilter } from './filter';
import { buildQueryableEntity, findEntitySetsForEntityType } from './runtime';
import type { Schema, ODataType, NavigationType } from './schema';
import type { CreateObject, UpdateObject, CreateOperationOptions, UpdateOperationOptions } from './operations';

// ============================================================================
// URL Path Normalization
// ============================================================================

/**
 * Normalizes URL path segments by:
 * - Removing trailing slashes from baseUrl (preserving protocol ://)
 * - Removing leading slashes from path segments
 * - Joining with single /
 * - Normalizing multiple consecutive slashes (except protocol)
 */
export function normalizePath(baseUrl: string, ...paths: string[]): string {
  // Remove trailing slashes from baseUrl, but preserve protocol ://
  let normalized = baseUrl.replace(/([^:]\/)\/+$/, '$1');

  // Process each path segment
  for (const path of paths) {
    if (!path) continue;

    // Remove leading slashes from path segment
    const cleanPath = path.replace(/^\/+/, '');
    if (!cleanPath) continue;

    // Ensure single / between baseUrl and path
    if (normalized && !normalized.endsWith('/')) {
      normalized += '/';
    }
    normalized += cleanPath;
  }

  // Normalize multiple consecutive slashes (except protocol ://)
  normalized = normalized.replace(/([^:]\/)\/+/g, '$1');

  return normalized;
}

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

// ============================================================================
// Create/Update Object Transformation
// ============================================================================

/**
 * Transform create object to handle navigation properties with @odata.bind format
 */
export function transformCreateObjectForBind<S extends Schema<S>>(
  createObject: CreateObject<any>,
  entityDef: QueryableEntity | undefined,
  schema: S
): any {
  if (!entityDef || !entityDef.navigations) return createObject;
  const transformed: any = {};
  
  for (const [key, value] of Object.entries(createObject)) {
    // Check for batch reference first
    if (typeof value === 'string' && value.startsWith('$')) {
      transformed[`${key}@odata.bind`] = value;
      continue;
    }

    const navDef = entityDef.navigations[key as keyof typeof entityDef.navigations];
    if (navDef && navDef.targetEntitysetKey) {
      const isCollection = navDef.collection === true;
      
      if (!isCollection) {
        // Single-valued navigation
        if (
          Array.isArray(value) &&
          value.length === 2 &&
          typeof value[0] === 'string' &&
          (typeof value[1] === 'string' || typeof value[1] === 'number')
        ) {
          // Explicit entityset format: [entityset, id]
          const [set, id] = value as [string, string | number];
          transformed[`${key}@odata.bind`] = `/${set}(${id})`;
        } else if (typeof value === 'string' || typeof value === 'number') {
          // Plain ID - resolve entityset from navigation
          const target = Array.isArray(navDef.targetEntitysetKey)
            ? navDef.targetEntitysetKey[0]
            : navDef.targetEntitysetKey;
          transformed[`${key}@odata.bind`] = `/${target}(${value})`;
        } else if (typeof value === 'object' && value !== null) {
          // Deep insert - recursive transformation
          const targetEntitysetKey = Array.isArray(navDef.targetEntitysetKey)
            ? navDef.targetEntitysetKey[0]
            : navDef.targetEntitysetKey;
          if (targetEntitysetKey != null) {
            const targetEntity = buildQueryableEntity(schema, targetEntitysetKey);
            transformed[key] = transformCreateObjectForBind(value, targetEntity, schema);
          } else {
            transformed[key] = value;
          }
        } else {
          transformed[key] = value;
        }
      } else {
        // Collection navigation
        if (Array.isArray(value)) {
          if (value.length > 0 && (typeof value[0] === 'string' || typeof value[0] === 'number')) {
            // Array of string/number IDs (or batch references)
            const target = Array.isArray(navDef.targetEntitysetKey)
              ? navDef.targetEntitysetKey[0]
              : navDef.targetEntitysetKey;
            transformed[`${key}@odata.bind`] = (value as (string | number)[]).map((v: string | number) =>
              typeof v === 'string' && v.startsWith('$') ? v : `/${target}(${v})`
            );
          } else if (value.length > 0 && Array.isArray(value[0])) {
            // Array of [entityset, id] tuples
            transformed[`${key}@odata.bind`] = (value as [string, string | number][]).map(
              ([set, id]) => `/${set}(${id})`
            );
          } else {
            // Array of objects - deep insert (recursive)
            const targetEntitysetKey = Array.isArray(navDef.targetEntitysetKey)
              ? navDef.targetEntitysetKey[0]
              : navDef.targetEntitysetKey;
            if (targetEntitysetKey != null) {
              const targetEntity = buildQueryableEntity(schema, targetEntitysetKey);
              transformed[key] = (value as any[]).map((item: any) =>
                typeof item === 'object' && item !== null
                  ? transformCreateObjectForBind(item, targetEntity, schema)
                  : item
              );
            } else {
              transformed[key] = value;
            }
          }
        } else {
          transformed[key] = value;
        }
      }
    } else {
      transformed[key] = value;
    }
  }
  
  return transformed;
}

/**
 * Transform update object to handle navigation properties with @odata.bind format
 */
export function transformUpdateObjectForBind<S extends Schema<S>>(
  updateObject: UpdateObject<any>,
  entityDef: QueryableEntity | undefined,
  schema: S
): any {
  if (!entityDef || !entityDef.navigations) return updateObject;
  const transformed: any = {};
  
  for (const [key, value] of Object.entries(updateObject)) {
    // Check for batch reference first
    if (typeof value === 'string' && value.startsWith('$')) {
      transformed[`${key}@odata.bind`] = value;
      continue;
    }

    const navDef = entityDef.navigations[key as keyof typeof entityDef.navigations];
    if (navDef && navDef.targetEntitysetKey) {
      if (value === null) {
        // Set navigation to null
        transformed[key] = null;
      } else if (Array.isArray(value) && !navDef.collection && value.length === 2) {
        // Single-valued navigation with explicit entityset: [entityset, id]
        const [set, id] = value as [string, string | number];
        transformed[`${key}@odata.bind`] = `/${set}(${id})`;
      } else if ((typeof value === 'string' || typeof value === 'number') && !navDef.collection) {
        // Single-valued navigation with plain ID
        const target = Array.isArray(navDef.targetEntitysetKey)
          ? navDef.targetEntitysetKey[0]
          : navDef.targetEntitysetKey;
        transformed[`${key}@odata.bind`] = `/${target}(${value})`;
      } else if (typeof value === 'object' && value !== null) {
        // Check if it's a collection operation spec
        const spec = value as { replace?: any[]; add?: any[]; remove?: any[] };
        if (spec.replace || spec.add || spec.remove) {
          // Collection operation
          const transformedSpec: any = {};
          const targetEntitysetKey = Array.isArray(navDef.targetEntitysetKey)
            ? navDef.targetEntitysetKey[0]
            : navDef.targetEntitysetKey;
          
          const formatRef = (v: string | number | [string, string | number]) => {
            // Check for batch reference
            if (typeof v === 'string' && v.startsWith('$')) return v;
            // Explicit entityset format
            if (Array.isArray(v)) return `/${v[0]}(${v[1]})`;
            // Use resolved entityset
            return `/${targetEntitysetKey}(${v})`;
          };
          
          if (spec.replace && Array.isArray(spec.replace)) {
            transformedSpec.replace = spec.replace.map(formatRef);
          }
          if (spec.add && Array.isArray(spec.add)) {
            transformedSpec.add = spec.add.map(formatRef);
          }
          if (spec.remove && Array.isArray(spec.remove)) {
            transformedSpec.remove = spec.remove.map(formatRef);
          }
          transformed[key] = transformedSpec;
        } else {
          // Regular object - pass through (not a navigation operation)
          transformed[key] = value;
        }
      } else {
        transformed[key] = value;
      }
    } else {
      transformed[key] = value;
    }
  }
  
  return transformed;
}

// ============================================================================
// Build Create/Update Requests
// ============================================================================

/**
 * Build HTTP Request for create operation
 */
export function buildCreateRequest<S extends Schema<S>>(
  path: string,
  createObject: CreateObject<any>,
  options: CreateOperationOptions<any> | undefined,
  baseUrl: string,
  entityDef: QueryableEntity,
  schema: S
): Request {
  let url = normalizePath(baseUrl, path);
  const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
  const select = options?.select;
  const preferParts: string[] = [];
  
  if (
    options?.prefer?.return_representation === true ||
    (select && Array.isArray(select) && select.length > 0)
  ) {
    preferParts.push('return=representation');
  }
  
  if (preferParts.length > 0) {
    headers.set('Prefer', preferParts.join(','));
  }
  
  if (options?.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      headers.set(key, value);
    }
  }
  
  if (select && Array.isArray(select) && select.length > 0) {
    url += `?$select=${select.join(',')}`;
  }
  
  const transformedObject = transformCreateObjectForBind(createObject, entityDef, schema);
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(transformedObject) });
}

/**
 * Build HTTP Request for update operation
 */
export function buildUpdateRequest<S extends Schema<S>>(
  path: string,
  updateObject: UpdateObject<any>,
  options: UpdateOperationOptions<any> | undefined,
  baseUrl: string,
  entityDef: QueryableEntity,
  schema: S
): Request {
  let url = normalizePath(baseUrl, path);
  const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
  const select = options?.select;
  const preferParts: string[] = [];
  
  if (
    options?.prefer?.return_representation === true ||
    (select && Array.isArray(select) && select.length > 0)
  ) {
    preferParts.push('return=representation');
  }
  
  if (preferParts.length > 0) {
    headers.set('Prefer', preferParts.join(','));
  }
  
  if (options?.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      headers.set(key, value);
    }
  }
  
  if (select && Array.isArray(select) && select.length > 0) {
    url += `?$select=${select.join(',')}`;
  }
  
  const transformedObject = transformUpdateObjectForBind(updateObject, entityDef, schema);
  return new Request(url, { method: 'PATCH', headers, body: JSON.stringify(transformedObject) });
}

// ============================================================================
// Action/Function Request Serialization
// ============================================================================

/**
 * Transform action/function parameters to handle navigation (entity type) parameters.
 * Converts string/number IDs to @odata.bind format and handles deep inserts.
 */
export function transformActionParameters<S extends Schema<S>>(
  parameters: Record<string, any>,
  parameterDefs: Record<string, ODataType<any>>,
  schema: S
): any {
  const transformed: any = {};
  
  for (const [key, value] of Object.entries(parameters)) {
    const paramDef = parameterDefs[key];
    
    // Check if this parameter is a navigation type (entity type parameter)
    if (paramDef && typeof paramDef === 'object' && 'type' in paramDef && paramDef.type === 'navigation') {
      const navDef = paramDef as NavigationType<any>;
      const targetEntityType = navDef.target as string;
      const isCollection = navDef.collection === true;
      
      // Resolve entityset(s) for this entity type
      const entitysetKey = findEntitySetsForEntityType(schema, targetEntityType);
      
      if (!entitysetKey) {
        // No entityset found - pass through as-is (shouldn't happen in valid schemas)
        transformed[key] = value;
        continue;
      }
      
      // Resolve target entityset (use first if multiple)
      const targetEntitysetKey = Array.isArray(entitysetKey) ? entitysetKey[0] : entitysetKey;
      
      if (!isCollection) {
        // Single-valued navigation parameter
        if (typeof value === 'string' && value.startsWith('$')) {
          // Batch reference
          transformed[`${key}@odata.bind`] = value;
        } else if (
          Array.isArray(value) &&
          value.length === 2 &&
          typeof value[0] === 'string' &&
          (typeof value[1] === 'string' || typeof value[1] === 'number')
        ) {
          // Explicit entityset format: [entityset, id]
          const [set, id] = value as [string, string | number];
          transformed[`${key}@odata.bind`] = `/${set}(${id})`;
        } else if (typeof value === 'string' || typeof value === 'number') {
          // Plain ID - resolve entityset from parameter definition
          transformed[`${key}@odata.bind`] = `/${targetEntitysetKey}(${value})`;
        } else if (typeof value === 'object' && value !== null) {
          // Deep insert - recursive transformation
          if (targetEntitysetKey != null) {
            const targetEntity = buildQueryableEntity(schema, targetEntitysetKey);
            transformed[key] = transformCreateObjectForBind(value, targetEntity, schema);
          } else {
            transformed[key] = value;
          }
        } else {
          transformed[key] = value;
        }
      } else {
        // Collection navigation parameter
        if (Array.isArray(value)) {
          if (value.length > 0 && (typeof value[0] === 'string' || typeof value[0] === 'number')) {
            // Array of string/number IDs (or batch references)
            transformed[`${key}@odata.bind`] = (value as (string | number)[]).map((v: string | number) =>
              typeof v === 'string' && v.startsWith('$') ? v : `/${targetEntitysetKey}(${v})`
            );
          } else if (value.length > 0 && Array.isArray(value[0])) {
            // Array of [entityset, id] tuples
            transformed[`${key}@odata.bind`] = (value as [string, string | number][]).map(
              ([set, id]) => `/${set}(${id})`
            );
          } else {
            // Array of objects - deep insert (recursive)
            if (targetEntitysetKey != null) {
              const targetEntity = buildQueryableEntity(schema, targetEntitysetKey);
              transformed[key] = (value as any[]).map((item: any) =>
                typeof item === 'object' && item !== null
                  ? transformCreateObjectForBind(item, targetEntity, schema)
                  : item
              );
            } else {
              transformed[key] = value;
            }
          }
        } else {
          transformed[key] = value;
        }
      }
    } else {
      // Not a navigation parameter - pass through as-is
      transformed[key] = value;
    }
  }
  
  return transformed;
}

/**
 * Build a POST request for an OData action.
 */
export function buildActionRequest<S extends Schema<S>>(
  path: string,
  namespace: string,
  actionName: string,
  parameters: Record<string, any>,
  parameterDefs: Record<string, ODataType<any>>,
  schema: S,
  baseUrl: string = '',
  useFQN: boolean = true
): Request {
  const fullActionName = useFQN ? `${namespace}.${actionName}` : actionName;
  const url = normalizePath(baseUrl, path, fullActionName);

  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: 'application/json',
  });

  // Transform parameters - handle entity parameters for deep inserts/binds
  const transformedParams = transformActionParameters(parameters, parameterDefs, schema);

  return new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(transformedParams),
  });
}

/**
 * Build a GET request for an OData function.
 */
export function buildFunctionRequest<S extends Schema<S>>(
  path: string,
  namespace: string,
  functionName: string,
  parameters: Record<string, any>,
  baseUrl: string = '',
  useFQN: boolean = true
): Request {
  const fullFuncName = useFQN ? `${namespace}.${functionName}` : functionName;
  const paramKeys = Object.keys(parameters);
  let urlParamsStr = '';
  const queryParams: string[] = [];

  if (paramKeys.length > 0) {
    urlParamsStr = '(' + paramKeys.map((k) => `${k}=@${k}`).join(',') + ')';
    for (const [key, value] of Object.entries(parameters)) {
      let serializedValue: string;
      if (typeof value === 'string') {
        serializedValue = `'${value}'`;
      } else if (value instanceof Date) {
        serializedValue = value.toISOString();
      } else if (typeof value === 'object' && value !== null) {
        serializedValue = JSON.stringify(value);
      } else {
        serializedValue = String(value);
      }
      queryParams.push(`@${key}=${encodeURIComponent(serializedValue)}`);
    }
  }

  let url = normalizePath(baseUrl, path, fullFuncName + urlParamsStr);
  if (queryParams.length > 0) {
    url += '?' + queryParams.join('&');
  }

  return new Request(url, {
    method: 'GET',
    headers: new Headers({ Accept: 'application/json' }),
  });
}
