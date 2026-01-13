// ============================================================================
// Type-Level Navigation Helpers
// ============================================================================

import type { Schema, EntityType, ODataType, NavigationType } from './schema';

// ============================================================================
// Extract EntityType from EntitySet
// ============================================================================

// Get entitytype name from entityset
export type EntityTypeNameFromEntitySet<
  S extends Schema<S>,
  ES extends keyof S['entitysets']
> = S['entitysets'][ES]['entitytype'];

// Get entitytype definition from entityset
export type EntityTypeFromEntitySet<
  S extends Schema<S>,
  ES extends keyof S['entitysets']
> = S['entitytypes'][EntityTypeNameFromEntitySet<S, ES>];

// ============================================================================
// Flatten BaseType Inheritance
// ============================================================================

// Recursively flatten entitytype with baseType inheritance
export type FlattenEntityType<
  S extends Schema<S>,
  ET extends keyof S['entitytypes'],
  Visited extends string = never
> = ET extends Visited
  ? never // Circular reference protection
  : S['entitytypes'][ET] extends { baseType?: infer Base }
    ? Base extends keyof S['entitytypes'] & string
      ? FlattenEntityType<S, Base, Visited | Extract<ET, string>> & Omit<S['entitytypes'][ET], 'baseType'>
      : S['entitytypes'][ET]
    : S['entitytypes'][ET];

// ============================================================================
// Map EntityType to EntitySet Name(s)
// ============================================================================

// Find entityset(s) that expose a given entitytype
export type EntitySetsForEntityType<
  S extends Schema<S>,
  ET extends keyof S['entitytypes']
> = Extract<
  {
    [ES in keyof S['entitysets']]: S['entitysets'][ES]['entitytype'] extends ET ? ES : never;
  }[keyof S['entitysets']],
  string
>;

// ============================================================================
// Extract Properties and Navigations
// ============================================================================

// Extract properties from entitytype (exclude navigations)
export type ExtractProperties<ET extends EntityType<any, any, any>> = {
  [K in keyof ET as ET[K] extends NavigationType<any> ? never : K]: ET[K];
};

// Extract navigations from entitytype
export type ExtractNavigations<ET extends EntityType<any, any, any>> = {
  [K in keyof ET as ET[K] extends NavigationType<any> ? K : never]: ET[K] extends NavigationType<infer Target>
    ? {
        target: Target;
        collection: ET[K] extends { collection: true } ? true : false;
      }
    : never;
};

// ============================================================================
// QueryableEntity Shape
// ============================================================================

// QueryableEntity interface - used by query builders
export type QueryableEntity = {
  readonly properties: { readonly [key: string]: any };
  readonly navigations: {
    readonly [key: string]: {
      target: any;
      targetEntitysetKey: string | string[];
      collection: boolean;
    };
  };
};

// Extract QueryableEntity shape from entityset
export type EntitySetToQueryableEntity<
  S extends Schema<S>,
  ES extends keyof S['entitysets']
> = {
  readonly properties: ExtractProperties<FlattenEntityType<S, EntityTypeNameFromEntitySet<S, ES>>>;
  readonly navigations: {
    readonly [K in keyof ExtractNavigations<FlattenEntityType<S, EntityTypeNameFromEntitySet<S, ES>>>]: ExtractNavigations<
      FlattenEntityType<S, EntityTypeNameFromEntitySet<S, ES>>
    >[K] extends { target: infer Target; collection: infer C }
      ? Target extends keyof S['entitytypes']
        ? EntitySetsForEntityType<S, Target> extends infer EntitySetKey
          ? EntitySetKey extends string
            ? {
                readonly target: any; // Will be resolved at runtime
                readonly targetEntitysetKey: EntitySetKey;
                readonly collection: C extends true ? true : C extends false ? false : boolean;
              }
            : {
                readonly target: any;
                readonly targetEntitysetKey: string | string[];
                readonly collection: boolean;
              }
          : {
              readonly target: any;
              readonly targetEntitysetKey: string | string[];
              readonly collection: boolean;
            }
        : {
            readonly target: any;
            readonly targetEntitysetKey: string | string[];
            readonly collection: boolean;
          }
      : never;
  };
};

// ============================================================================
// Filter Bound Operations
// ============================================================================

// Filter actions/functions by target entitytype and scope
export type BoundOperationsForEntity<
  Ops extends Record<string, any>,
  Target extends string,
  Scope extends 'entity' | 'collection'
> = {
  [K in keyof Ops]: Ops[K] extends { type: 'bound'; target: infer T; collection: infer C }
    ? T extends Target
      ? C extends boolean
        ? C extends false
          ? Scope extends 'entity'
            ? Ops[K]
            : never
          : Scope extends 'collection'
          ? Ops[K]
          : never
        : never
      : never
    : never;
};

// Extract keys of bound operations for a given entity and scope
export type BoundOperationKeys<
  Ops extends Record<string, any>,
  Target extends string,
  Scope extends 'entity' | 'collection'
> = keyof BoundOperationsForEntity<Ops, Target, Scope>;

// ============================================================================
// Helper Types
// ============================================================================

// Check if a type is never
export type IsNever<T> = [T] extends [never] ? true : false;

// Extract non-never keys from a record
export type NonNeverKeys<T extends Record<string, any>> = {
  [K in keyof T]: IsNever<T[K]> extends true ? never : K;
}[keyof T];
