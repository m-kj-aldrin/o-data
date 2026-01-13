// ============================================================================
// Runtime QueryableEntity Builder
// ============================================================================

import type { Schema, EntityType, NavigationType } from './schema';
import type { QueryableEntity } from './types';

// ============================================================================
// Helper: Check if a property is a navigation
// ============================================================================

function isNavigation(prop: any): prop is NavigationType<any> {
  return prop && typeof prop === 'object' && prop.type === 'navigation';
}

// ============================================================================
// Helper: Flatten EntityType with baseType inheritance
// ============================================================================

function flattenEntityType<S extends Schema<S>>(
  schema: S,
  entitytypeName: string,
  visited: Set<string> = new Set()
): EntityType<any, any, any> {
  // Circular reference protection
  if (visited.has(entitytypeName)) {
    return {} as EntityType<any, any, any>;
  }

  const entitytypes = schema.entitytypes as Record<string, EntityType<any, any, any>>;
  const entitytype = entitytypes[entitytypeName];
  if (!entitytype) {
    return {} as EntityType<any, any, any>;
  }

  visited.add(entitytypeName);

  // If no baseType, return as-is
  if (!('baseType' in entitytype) || !entitytype.baseType) {
    visited.delete(entitytypeName);
    return entitytype as EntityType<any, any, any>;
  }

  // Recursively flatten baseType
  const baseTypeName = entitytype.baseType as string;
  const baseType = flattenEntityType(schema, baseTypeName, visited);
  
  // Merge baseType with current entitytype (current overrides base)
  const { baseType: _, ...currentProps } = entitytype as any;
  const flattened = { ...baseType, ...currentProps };

  visited.delete(entitytypeName);
  return flattened as EntityType<any, any, any>;
}

// ============================================================================
// Helper: Find entityset(s) for an entitytype
// ============================================================================

function findEntitySetsForEntityType<S extends Schema<S>>(
  schema: S,
  entitytypeName: string
): string | string[] {
  const entitysets: string[] = [];
  const entitysetsRecord = schema.entitysets as Record<string, { entitytype: string }>;

  for (const [entitysetName, entityset] of Object.entries(entitysetsRecord)) {
    if (entityset.entitytype === entitytypeName) {
      entitysets.push(entitysetName);
    }
  }

  if (entitysets.length === 0) {
    return '';
  } else if (entitysets.length === 1) {
    return entitysets[0]!;
  } else {
    return entitysets;
  }
}

// ============================================================================
// Build QueryableEntity from EntitySet
// ============================================================================

export function buildQueryableEntity<S extends Schema<S>>(
  schema: S,
  entitysetName: string | string[]
): QueryableEntity {
  // Handle array case - use first entityset
  const actualEntitysetName = Array.isArray(entitysetName) 
    ? (entitysetName[0] || '') 
    : entitysetName;
  
  if (!actualEntitysetName) {
    return {
      properties: {},
      navigations: {},
    };
  }
  
  const entitysets = schema.entitysets as Record<string, { entitytype: string }>;
  const entityset = entitysets[actualEntitysetName];
  if (!entityset) {
    return {
      properties: {},
      navigations: {},
    };
  }

  const entitytypeName = entityset.entitytype;
  const flattenedEntityType = flattenEntityType(schema, entitytypeName);

  // Extract properties (non-navigation fields)
  const properties: Record<string, any> = {};
  for (const [key, value] of Object.entries(flattenedEntityType)) {
    if (!isNavigation(value)) {
      properties[key] = value;
    }
  }

  // Extract navigations
  const navigations: Record<string, { target: any; targetEntitysetKey: string | string[]; collection: boolean }> = {};
  for (const [key, value] of Object.entries(flattenedEntityType)) {
    if (isNavigation(value)) {
      const targetEntitytypeName = value.target as string;
      const targetEntitysetKey = findEntitySetsForEntityType(schema, targetEntitytypeName);
      const collection = value.collection === true;

      navigations[key] = {
        target: targetEntitytypeName,
        targetEntitysetKey: targetEntitysetKey || '',
        collection,
      };
    }
  }

  return {
    properties,
    navigations,
  } as QueryableEntity;
}
