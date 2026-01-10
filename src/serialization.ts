import type {
  QueryableEntity,
  SingleQueryObject,
  CollectionQueryObject,
  CreateObject,
  UpdateObject,
  CreateOperationOptions,
  UpdateOperationOptions,
  QueryOperationOptions,
  ResolvedSchema,
  ParameterDef,
} from './schema';
import { createFilterHelpers, serializeFilter } from './filter';

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

function serializeExpandOptions(
  navQuery: SingleQueryObject<any> | CollectionQueryObject<any>,
  navEntityDef?: QueryableEntity
): string {
  const nestedParams: string[] = [];
  if (navQuery.select) nestedParams.push(`$select=${navQuery.select.join(',')}`);
  if (navQuery.expand) {
    const nestedExpandParams: string[] = [];
    for (const [nestedNavKey, nestedNavQuery] of Object.entries(navQuery.expand)) {
      if (nestedNavQuery) {
        let nestedNavEntityDef: QueryableEntity | undefined;
        if (navEntityDef && nestedNavKey in navEntityDef.navigations) {
          const nav =
            navEntityDef.navigations[nestedNavKey as keyof typeof navEntityDef.navigations];
          if (nav && 'target' in nav && typeof nav.target === 'object') {
            nestedNavEntityDef = nav.target as QueryableEntity;
          }
        }
        const nestedExpandOptionsStr = serializeExpandOptions(nestedNavQuery, nestedNavEntityDef);
        nestedExpandParams.push(`${nestedNavKey}${nestedExpandOptionsStr}`);
      }
    }
    if (nestedExpandParams.length > 0) nestedParams.push(`$expand=${nestedExpandParams.join(',')}`);
  }
  const collectionQuery = navQuery as CollectionQueryObject<any>;
  if ('top' in collectionQuery && collectionQuery.top !== undefined)
    nestedParams.push(`$top=${collectionQuery.top}`);
  if ('orderby' in collectionQuery && collectionQuery.orderby) {
    const orderbyValue = Array.isArray(collectionQuery.orderby[0])
      ? (collectionQuery.orderby as Array<[string, 'asc' | 'desc']>)
          .map(([prop, dir]) => `${prop} ${dir}`)
          .join(',')
      : (() => {
          const [prop, dir] = collectionQuery.orderby as [string, 'asc' | 'desc'];
          return `${prop} ${dir}`;
        })();
    nestedParams.push(`$orderby=${orderbyValue}`);
  }
  if ('filter' in collectionQuery && collectionQuery.filter) {
    if (typeof collectionQuery.filter === 'function') {
      if (!navEntityDef) throw new Error('Entity definition required for filter builder in expand');
      const helpers = createFilterHelpers(navEntityDef);
      const builder = collectionQuery.filter(helpers);
      const state = (builder as any).state;
      const filterString = serializeFilter(state, 0, undefined, navEntityDef);
      nestedParams.push(`$filter=${encodeURIComponent(filterString)}`);
    }
  }
  if ('count' in collectionQuery && collectionQuery.count) nestedParams.push('$count=true');
  return nestedParams.length > 0 ? `(${nestedParams.join(';')})` : '';
}

function buildQueryUrl(
  path: string,
  query: SingleQueryObject<any> | CollectionQueryObject<any>,
  entityDef?: QueryableEntity
): string {
  let url = path;
  const params: string[] = [];
  if (query.select) params.push(`$select=${query.select.join(',')}`);
  if (query.expand) {
    const expandParams: string[] = [];
    for (const [navKey, navQuery] of Object.entries(query.expand)) {
      if (navQuery) {
        let navEntityDef: QueryableEntity | undefined;
        if (entityDef && navKey in entityDef.navigations) {
          const nav = entityDef.navigations[navKey as keyof typeof entityDef.navigations];
          if (nav && 'target' in nav && typeof nav.target === 'object') {
            navEntityDef = nav.target as QueryableEntity;
          }
        }
        const expandOptionsStr = serializeExpandOptions(navQuery, navEntityDef);
        expandParams.push(`${navKey}${expandOptionsStr}`);
      }
    }
    if (expandParams.length > 0) params.push(`$expand=${expandParams.join(',')}`);
  }
  const isCollectionQuery = !path.match(/\([^)]+\)$/);
  if (isCollectionQuery) {
    const collectionQuery = query as CollectionQueryObject<any>;
    if ('top' in collectionQuery && collectionQuery.top !== undefined)
      params.push(`$top=${collectionQuery.top}`);
    if ('orderby' in collectionQuery && collectionQuery.orderby) {
      const orderbyValue = Array.isArray(collectionQuery.orderby[0])
        ? (collectionQuery.orderby as Array<[string, 'asc' | 'desc']>)
            .map(([prop, dir]) => `${prop} ${dir}`)
            .join(',')
        : (() => {
            const [prop, dir] = collectionQuery.orderby as [string, 'asc' | 'desc'];
            return `${prop} ${dir}`;
          })();
      params.push(`$orderby=${orderbyValue}`);
    }
    if ('filter' in collectionQuery && collectionQuery.filter) {
      if (typeof collectionQuery.filter === 'function') {
        if (!entityDef) throw new Error('Entity definition required for filter builder');
        const helpers = createFilterHelpers(entityDef);
        const builder = collectionQuery.filter(helpers);
        const state = (builder as any).state;
        const filterString = serializeFilter(state, 0, undefined, entityDef);
        params.push(`$filter=${encodeURIComponent(filterString)}`);
      }
    }
    if ('count' in collectionQuery && collectionQuery.count) params.push('$count=true');
  }
  if (params.length > 0) url += `?${params.join('&')}`;
  return url;
}

export function buildQueryRequest(
  path: string,
  query: SingleQueryObject<any> | CollectionQueryObject<any>,
  options?: QueryOperationOptions,
  baseUrl: string = '',
  entityDef?: QueryableEntity
): Request {
  const url = normalizePath(baseUrl, buildQueryUrl(path, query, entityDef));
  const headers = new Headers({ Accept: 'application/json' });
  if (options?.headers) {
    for (const [key, value] of Object.entries(options.headers)) headers.set(key, value);
  }
  if (options?.prefer) {
    const preferParts: string[] = [];
    if (options.prefer.maxpagesize !== undefined)
      preferParts.push(`odata.maxpagesize=${options.prefer.maxpagesize}`);
    if (preferParts.length > 0) headers.set('Prefer', preferParts.join(','));
  }
  return new Request(url, { method: 'GET', headers });
}

function transformCreateObjectForBind(
  createObject: CreateObject<any>,
  entityDef?: QueryableEntity
): any {
  if (!entityDef || !entityDef.navigations) return createObject;
  const transformed: any = {};
  for (const [key, value] of Object.entries(createObject)) {
    // Check for batch reference first
    if (typeof value === 'string' && value.startsWith('$')) {
      transformed[`${key}@odata.bind`] = value;
      continue;
    }

    const navDef = entityDef.navigations[key];
    if (navDef && navDef.targetEntitysetKey) {
      if (
        !navDef.collection &&
        Array.isArray(value) &&
        value.length === 2 &&
        typeof value[0] === 'string' &&
        (typeof value[1] === 'string' || typeof value[1] === 'number')
      ) {
        const [set, id] = value as [string, string | number];
        transformed[`${key}@odata.bind`] = `/${set}(${id})`;
      } else if (typeof value === 'string') {
        const target = Array.isArray(navDef.targetEntitysetKey)
          ? navDef.targetEntitysetKey[0]
          : navDef.targetEntitysetKey;
        transformed[`${key}@odata.bind`] = `/${target}(${value})`;
      } else if (Array.isArray(value)) {
        if (value.length > 0 && typeof value[0] === 'string') {
          const target = Array.isArray(navDef.targetEntitysetKey)
            ? navDef.targetEntitysetKey[0]
            : navDef.targetEntitysetKey;
          // Updated to support batch references inside array
          transformed[`${key}@odata.bind`] = (value as string[]).map((v: string) =>
            v.startsWith('$') ? v : `/${target}(${v})`
          );
        } else if (value.length > 0 && Array.isArray(value[0])) {
          transformed[`${key}@odata.bind`] = (value as [string, string][]).map(
            ([set, id]) => `/${set}(${id})`
          );
        } else {
          transformed[key] = (value as any[]).map((item: any) =>
            typeof item === 'object' && item !== null
              ? transformCreateObjectForBind(item, navDef.target)
              : item
          );
        }
      } else if (typeof value === 'object' && value !== null) {
        transformed[key] = transformCreateObjectForBind(value, navDef.target);
      } else {
        transformed[key] = value;
      }
    } else {
      transformed[key] = value;
    }
  }
  return transformed;
}

export function buildCreateRequest(
  path: string,
  createObject: CreateObject<any>,
  options?: CreateOperationOptions<any>,
  baseUrl: string = '',
  entityDef?: QueryableEntity
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
  if (preferParts.length > 0) headers.set('Prefer', preferParts.join(','));
  if (options?.headers) {
    for (const [key, value] of Object.entries(options.headers)) headers.set(key, value);
  }
  if (select && Array.isArray(select) && select.length > 0) url += `?$select=${select.join(',')}`;
  const transformedObject = transformCreateObjectForBind(createObject, entityDef);
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(transformedObject) });
}

function transformUpdateObjectForBind(
  updateObject: UpdateObject<any>,
  entityDef?: QueryableEntity
): any {
  if (!entityDef || !entityDef.navigations) return updateObject;
  const transformed: any = {};
  for (const [key, value] of Object.entries(updateObject)) {
    // Check for batch reference first
    if (typeof value === 'string' && value.startsWith('$')) {
      transformed[`${key}@odata.bind`] = value;
      continue;
    }

    const navDef = entityDef.navigations[key];
    if (navDef && navDef.targetEntitysetKey) {
      if (value === null) {
        transformed[key] = null;
      } else if (Array.isArray(value) && !navDef.collection && value.length === 2) {
        const [set, id] = value as [string, string | number];
        transformed[`${key}@odata.bind`] = `/${set}(${id})`;
      } else if (typeof value === 'string' || typeof value === 'number') {
        const target = Array.isArray(navDef.targetEntitysetKey)
          ? navDef.targetEntitysetKey[0]
          : navDef.targetEntitysetKey;
        transformed[`${key}@odata.bind`] = `/${target}(${value})`;
      } else if (typeof value === 'object' && value !== null) {
        const spec = value as { replace?: any[]; add?: any[]; remove?: any[] };
        const transformedSpec: any = {};
        const formatRef = (v: string | number | [string, string | number]) => {
          // Updated to check for batch reference
          if (typeof v === 'string' && v.startsWith('$')) return v;
          if (Array.isArray(v)) return `/${v[0]}(${v[1]})`;
          const target = Array.isArray(navDef.targetEntitysetKey)
            ? navDef.targetEntitysetKey[0]
            : navDef.targetEntitysetKey;
          return `/${target}(${v})`;
        };
        if (spec.replace && Array.isArray(spec.replace))
          transformedSpec.replace = spec.replace.map(formatRef);
        if (spec.add && Array.isArray(spec.add)) transformedSpec.add = spec.add.map(formatRef);
        if (spec.remove && Array.isArray(spec.remove))
          transformedSpec.remove = spec.remove.map(formatRef);
        transformed[key] = transformedSpec;
      } else {
        transformed[key] = value;
      }
    } else {
      transformed[key] = value;
    }
  }
  return transformed;
}

export function buildUpdateRequest(
  path: string,
  updateObject: UpdateObject<any>,
  options?: UpdateOperationOptions<any>,
  baseUrl: string = '',
  entityDef?: QueryableEntity
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
  if (preferParts.length > 0) headers.set('Prefer', preferParts.join(','));
  if (options?.headers) {
    for (const [key, value] of Object.entries(options.headers)) headers.set(key, value);
  }
  if (select && Array.isArray(select) && select.length > 0) url += `?$select=${select.join(',')}`;
  const transformedObject = transformUpdateObjectForBind(updateObject, entityDef);
  return new Request(url, { method: 'PATCH', headers, body: JSON.stringify(transformedObject) });
}

export function buildActionRequest(
  path: string,
  namespace: string,
  actionName: string,
  parameters: Record<string, any>,
  parameterDefs: Record<string, ParameterDef<any>>,
  schema: ResolvedSchema<any>,
  baseUrl: string = '',
  useSchemaFQN: boolean = true
): Request {
  const fullActionName = useSchemaFQN ? `${namespace}.${actionName}` : actionName;
  const url = normalizePath(baseUrl, path, fullActionName);

  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: 'application/json',
  });

  const transformedParams: any = {};
  for (const [key, value] of Object.entries(parameters)) {
    const paramDef = parameterDefs[key];

    // Check if this parameter is an Entity/Navigation target and value is an object (Deep Insert/Bind)
    if (
      paramDef &&
      typeof paramDef === 'object' &&
      'target' in paramDef &&
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    ) {
      const targetKey = paramDef.target as string;
      const targetEntityDef = schema.entitysets[targetKey];
      if (targetEntityDef) {
        transformedParams[key] = transformCreateObjectForBind(
          value,
          targetEntityDef as unknown as QueryableEntity
        );
      } else {
        transformedParams[key] = value;
      }
    } else {
      transformedParams[key] = value;
    }
  }

  return new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(transformedParams),
  });
}

export function buildFunctionRequest(
  path: string,
  namespace: string,
  functionName: string,
  parameters: Record<string, any>,
  baseUrl: string = '',
  useSchemaFQN: boolean = true
): Request {
  const fullFuncName = useSchemaFQN ? `${namespace}.${functionName}` : functionName;
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

export function splitResponse(json: Record<string, any>): { data: any } & Record<string, any> {
  const odataProps: Record<string, any> = {};
  const data: Record<string, any> = {};
  for (const [key, value] of Object.entries(json)) {
    if (key.startsWith('@')) {
      odataProps[key] = value;
    } else {
      data[key] = value;
    }
  }
  return { ...odataProps, data };
}
