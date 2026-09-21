import type { Schema, EntityType, NavigationType } from './schema';
import type { QueryableEntity } from './types';

type SchemaCache = {
  entitysetsByType: Map<string, string[]>;
  entitysetsIndexed: boolean;
  flattened: Map<string, EntityType<any, any, any>>;
  queryable: Map<string, QueryableEntity>;
};

const schemaCaches = new WeakMap<object, SchemaCache>();

function getSchemaCache(schema: object): SchemaCache {
  let cache = schemaCaches.get(schema);
  if (!cache) {
    cache = {
      entitysetsByType: new Map(),
      entitysetsIndexed: false,
      flattened: new Map(),
      queryable: new Map(),
    };
    schemaCaches.set(schema, cache);
  }
  return cache;
}

function isNavigation(prop: any): prop is NavigationType<any> {
  return prop && typeof prop === 'object' && prop.type === 'navigation';
}

function flattenEntityType<S extends Schema<S>>(
  schema: S,
  entitytypeName: string,
  cache: SchemaCache,
  visited: Set<string> = new Set()
): EntityType<any, any, any> {
  if (visited.has(entitytypeName)) {
    return { properties: {} } as EntityType<any, any, any>;
  }

  const cached = cache.flattened.get(entitytypeName);
  if (cached) {
    return cached;
  }

  const entitytypes = schema.entitytypes as Record<string, EntityType<any, any, any>>;
  const entitytype = entitytypes[entitytypeName];
  if (!entitytype) {
    const empty = { properties: {} } as EntityType<any, any, any>;
    cache.flattened.set(entitytypeName, empty);
    return empty;
  }

  visited.add(entitytypeName);

  if (!entitytype.baseType) {
    visited.delete(entitytypeName);
    cache.flattened.set(entitytypeName, entitytype as EntityType<any, any, any>);
    return entitytype as EntityType<any, any, any>;
  }

  const baseTypeName = entitytype.baseType as string;
  const baseType = flattenEntityType(schema, baseTypeName, cache, visited);

  const flattened: EntityType<any, any, any> = {
    baseType: entitytype.baseType,
    properties: {
      ...(baseType.properties || {}),
      ...(entitytype.properties || {}),
    },
  };

  visited.delete(entitytypeName);
  cache.flattened.set(entitytypeName, flattened);
  return flattened;
}

function entitysetsForType(schema: object, entitytypeName: string, cache: SchemaCache): string | string[] {
  if (!cache.entitysetsIndexed) {
    const entitysetsRecord = (schema as Schema<any>).entitysets as Record<string, { entitytype: string }>;
    for (const [entitysetName, entityset] of Object.entries(entitysetsRecord)) {
      const list = cache.entitysetsByType.get(entityset.entitytype);
      if (list) {
        list.push(entitysetName);
      } else {
        cache.entitysetsByType.set(entityset.entitytype, [entitysetName]);
      }
    }
    cache.entitysetsIndexed = true;
  }

  const entitysets = cache.entitysetsByType.get(entitytypeName);
  if (!entitysets || entitysets.length === 0) {
    return '';
  }
  if (entitysets.length === 1) {
    return entitysets[0]!;
  }
  return entitysets;
}

export function findEntitySetsForEntityType<S extends Schema<S>>(
  schema: S,
  entitytypeName: string
): string | string[] {
  return entitysetsForType(schema, entitytypeName, getSchemaCache(schema));
}

export function buildQueryableEntity<S extends Schema<S>>(
  schema: S,
  entitysetName: string | string[]
): QueryableEntity {
  const actualEntitysetName = Array.isArray(entitysetName)
    ? (entitysetName[0] || '')
    : entitysetName;

  if (!actualEntitysetName) {
    return {
      properties: {},
      navigations: {},
    };
  }

  const cache = getSchemaCache(schema);
  const cachedEntity = cache.queryable.get(actualEntitysetName);
  if (cachedEntity) {
    return cachedEntity;
  }

  const entitysets = schema.entitysets as Record<string, { entitytype: string }>;
  const entityset = entitysets[actualEntitysetName];
  if (!entityset) {
    const empty = {
      properties: {},
      navigations: {},
    };
    cache.queryable.set(actualEntitysetName, empty);
    return empty;
  }

  const flattenedEntityType = flattenEntityType(schema, entityset.entitytype, cache);
  const properties: Record<string, any> = {};
  const navigations: Record<string, { target: any; targetEntitysetKey: string | string[]; collection: boolean }> = {};

  for (const [key, value] of Object.entries(flattenedEntityType.properties || {})) {
    if (isNavigation(value)) {
      const targetEntitytypeName = value.target as string;
      navigations[key] = {
        target: targetEntitytypeName,
        targetEntitysetKey: entitysetsForType(schema, targetEntitytypeName, cache) || '',
        collection: value.collection === true,
      };
    } else {
      properties[key] = value;
    }
  }

  const entity = {
    properties,
    navigations,
  } as QueryableEntity;
  cache.queryable.set(actualEntitysetName, entity);
  return entity;
}
