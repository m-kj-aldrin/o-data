// ============================================================================
// Query String Serialization
// ============================================================================

import type { QueryableEntity } from './types';
import type { CollectionQueryObject, SingleQueryObject, SingleExpandObject } from './query';
import { createFilterHelpers, serializeFilter } from './filter.js';
import { buildQueryableEntity, findEntitySetsForEntityType } from './runtime.js';
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

function isBatchRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('$');
}

function firstEntitySetKey(key: string | string[] | undefined): string | undefined {
  return Array.isArray(key) ? key[0] : key;
}

function bindPath(entityset: string | undefined, id: string | number): string {
  return `/${entityset}(${id})`;
}

function isExplicitSetId(value: unknown): value is [string, string | number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'string' &&
    (typeof value[1] === 'string' || typeof value[1] === 'number')
  );
}

function formatRef(
  value: string | number | [string, string | number],
  targetEntitysetKey: string | undefined
): string {
  if (isBatchRef(value)) return value;
  if (Array.isArray(value)) return bindPath(value[0], value[1]);
  return bindPath(targetEntitysetKey, value);
}

function transformDeepInsert<S extends Schema<S>>(
  value: any,
  targetEntitysetKey: string | undefined,
  schema: S
): any {
  if (targetEntitysetKey == null) return value;
  return transformCreateObjectForBind(value, buildQueryableEntity(schema, targetEntitysetKey), schema);
}

function transformDeepInsertArray<S extends Schema<S>>(
  value: any[],
  targetEntitysetKey: string | undefined,
  schema: S
): any {
  if (targetEntitysetKey == null) return value;
  const targetEntity = buildQueryableEntity(schema, targetEntitysetKey);
  return value.map((item: any) =>
    typeof item === 'object' && item !== null
      ? transformCreateObjectForBind(item, targetEntity, schema)
      : item
  );
}

function assignNavBind<S extends Schema<S>>(
  transformed: any,
  key: string,
  value: any,
  isCollection: boolean,
  targetEntitysetKey: string | undefined,
  schema: S
): void {
  if (!isCollection) {
    if (isBatchRef(value)) {
      transformed[`${key}@odata.bind`] = value;
    } else if (isExplicitSetId(value)) {
      transformed[`${key}@odata.bind`] = bindPath(value[0], value[1]);
    } else if (typeof value === 'string' || typeof value === 'number') {
      transformed[`${key}@odata.bind`] = bindPath(targetEntitysetKey, value);
    } else if (typeof value === 'object' && value !== null) {
      transformed[key] = transformDeepInsert(value, targetEntitysetKey, schema);
    } else {
      transformed[key] = value;
    }
    return;
  }

  if (Array.isArray(value)) {
    if (value.length > 0 && (typeof value[0] === 'string' || typeof value[0] === 'number')) {
      transformed[`${key}@odata.bind`] = (value as (string | number)[]).map((v) =>
        isBatchRef(v) ? v : bindPath(targetEntitysetKey, v)
      );
    } else if (value.length > 0 && Array.isArray(value[0])) {
      transformed[`${key}@odata.bind`] = (value as [string, string | number][]).map(([set, id]) =>
        bindPath(set, id)
      );
    } else {
      transformed[key] = transformDeepInsertArray(value, targetEntitysetKey, schema);
    }
  } else {
    transformed[key] = value;
  }
}

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
    if (isBatchRef(value)) {
      transformed[`${key}@odata.bind`] = value;
      continue;
    }

    const navDef = entityDef.navigations[key as keyof typeof entityDef.navigations];
    if (navDef && navDef.targetEntitysetKey) {
      assignNavBind(
        transformed,
        key,
        value,
        navDef.collection === true,
        firstEntitySetKey(navDef.targetEntitysetKey),
        schema
      );
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
    if (isBatchRef(value)) {
      transformed[`${key}@odata.bind`] = value;
      continue;
    }

    const navDef = entityDef.navigations[key as keyof typeof entityDef.navigations];
    if (navDef && navDef.targetEntitysetKey) {
      const targetEntitysetKey = firstEntitySetKey(navDef.targetEntitysetKey);
      if (value === null) {
        transformed[key] = null;
      } else if (Array.isArray(value) && !navDef.collection && value.length === 2) {
        const [set, id] = value as [string, string | number];
        transformed[`${key}@odata.bind`] = bindPath(set, id);
      } else if ((typeof value === 'string' || typeof value === 'number') && !navDef.collection) {
        transformed[`${key}@odata.bind`] = bindPath(targetEntitysetKey, value);
      } else if (
        navDef.collection &&
        Array.isArray(value) &&
        (value.length === 0 ||
          (typeof value[0] === 'object' && value[0] !== null && !Array.isArray(value[0])))
      ) {
        transformed[key] = transformDeepInsertArray(value, targetEntitysetKey, schema);
      } else if (typeof value === 'object' && value !== null) {
        const spec = value as { replace?: any[]; add?: any[]; remove?: any[] };
        if (spec.replace || spec.add || spec.remove) {
          const transformedSpec: any = {};
          const ref = (v: string | number | [string, string | number]) => formatRef(v, targetEntitysetKey);
          if (spec.replace && Array.isArray(spec.replace)) {
            transformedSpec.replace = spec.replace.map(ref);
          }
          if (spec.add && Array.isArray(spec.add)) {
            transformedSpec.add = spec.add.map(ref);
          }
          if (spec.remove && Array.isArray(spec.remove)) {
            transformedSpec.remove = spec.remove.map(ref);
          }
          transformed[key] = transformedSpec;
        } else {
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

function buildEntityRequest(
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown,
  options: CreateOperationOptions<any> | undefined,
  baseUrl: string
): Request {
  let url = normalizePath(baseUrl, path);
  const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
  const select = options?.select;

  if (
    options?.prefer?.return_representation === true ||
    (select && Array.isArray(select) && select.length > 0)
  ) {
    headers.set('Prefer', 'return=representation');
  }

  if (options?.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      headers.set(key, value);
    }
  }

  if (select && Array.isArray(select) && select.length > 0) {
    url += `?$select=${select.join(',')}`;
  }

  return new Request(url, { method, headers, body: JSON.stringify(body) });
}

export function buildCreateRequest<S extends Schema<S>>(
  path: string,
  createObject: CreateObject<any>,
  options: CreateOperationOptions<any> | undefined,
  baseUrl: string,
  entityDef: QueryableEntity,
  schema: S
): Request {
  return buildEntityRequest(
    'POST',
    path,
    transformCreateObjectForBind(createObject, entityDef, schema),
    options,
    baseUrl
  );
}

export function buildUpdateRequest<S extends Schema<S>>(
  path: string,
  updateObject: UpdateObject<any>,
  options: UpdateOperationOptions<any> | undefined,
  baseUrl: string,
  entityDef: QueryableEntity,
  schema: S
): Request {
  return buildEntityRequest(
    'PATCH',
    path,
    transformUpdateObjectForBind(updateObject, entityDef, schema),
    options,
    baseUrl
  );
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

    if (paramDef && typeof paramDef === 'object' && 'type' in paramDef && paramDef.type === 'navigation') {
      const navDef = paramDef as NavigationType<any>;
      const entitysetKey = findEntitySetsForEntityType(schema, navDef.target as string);

      if (!entitysetKey) {
        transformed[key] = value;
        continue;
      }

      assignNavBind(
        transformed,
        key,
        value,
        navDef.collection === true,
        firstEntitySetKey(entitysetKey),
        schema
      );
    } else {
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
