// ============================================================================
// Type-Level Navigation Helpers
// ============================================================================

import type { Schema, EntityType, ODataType, NavigationType, PrimitiveName, ComplexTypeDefinition } from './schema';

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
// OData Type to TypeScript Mapping
// ============================================================================

// Map primitive OData types to TypeScript types
type PrimitiveToTS<P extends PrimitiveName> = 
  P extends 'Edm.Boolean' ? boolean :
  P extends 'Edm.String' | 'Edm.Guid' | 'Edm.Duration' | 'Edm.TimeOfDay' ? string :
  P extends 'Edm.Binary' ? string :
  P extends 'Edm.Date' | 'Edm.DateTimeOffset' ? Date :
  P extends 'Edm.Byte' | 'Edm.Int16' | 'Edm.Int32' | 'Edm.Int64' | 
           'Edm.SByte' | 'Edm.Single' | 'Edm.Double' | 'Edm.Decimal' ? number :
  P extends 'Edm.Stream' | 'Edm.Untyped' | 
           'Edm.Geography' | 'Edm.GeographyPoint' | 'Edm.GeographyLineString' |
           'Edm.GeographyPolygon' | 'Edm.GeographyMultiPoint' |
           'Edm.GeographyMultiLineString' | 'Edm.GeographyMultiPolygon' |
           'Edm.GeographyCollection' |
           'Edm.Geometry' | 'Edm.GeometryPoint' | 'Edm.GeometryLineString' |
           'Edm.GeometryPolygon' | 'Edm.GeometryMultiPoint' |
           'Edm.GeometryMultiLineString' | 'Edm.GeometryMultiPolygon' |
           'Edm.GeometryCollection' |
           'Edm.ModelElementPath' | 'Edm.AnyPropertyPath' ? any :
  never;

// Map enum types to union types of enum member names
type EnumToTS<
  Target extends string,
  S extends Schema<S>
> = Target extends keyof NonNullable<S['enumtypes']>
  ? NonNullable<S['enumtypes']>[Target] extends { members: infer Members }
    ? Members extends Record<string, any>
      ? keyof Members
      : never
    : never
  : never;

// Map complex types recursively with circular reference protection
type ComplexTypeToTS<
  Target extends string,
  S extends Schema<S>,
  Visited extends string = never
> = Target extends Visited
  ? never // Circular reference protection
  : Target extends keyof NonNullable<S['complextypes']>
    ? NonNullable<S['complextypes']>[Target] extends ComplexTypeDefinition<any, any, any>
      ? {
          readonly [K in keyof NonNullable<S['complextypes']>[Target]]: 
            ODataTypeToTS<
              NonNullable<S['complextypes']>[Target][K],
              S,
              Visited | Target
            >
        }
      : never
    : any; // Fallback if complex type not found

// Main ODataType mapper - handles collections, nullable, and dispatches to specific mappers
type ODataTypeToTS<
  T extends ODataType<any, any, any>,
  S extends Schema<S>,
  Visited extends string = never
> = T extends { collection: true }
  ? T extends { type: 'enum'; target: infer Target }
    ? Target extends string
      ? Array<'nullable' extends keyof T ? (T['nullable'] extends false ? EnumToTS<Target, S> : EnumToTS<Target, S> | null) : EnumToTS<Target, S> | null>
      : never
    : T extends { type: 'complex'; target: infer Target }
      ? Target extends string
        ? Array<'nullable' extends keyof T ? (T['nullable'] extends false ? ComplexTypeToTS<Target, S, Visited> : ComplexTypeToTS<Target, S, Visited> | null) : ComplexTypeToTS<Target, S, Visited> | null>
        : never
      : T extends { type: infer P }
        ? P extends PrimitiveName
          ? Array<'nullable' extends keyof T ? (T['nullable'] extends false ? PrimitiveToTS<P> : PrimitiveToTS<P> | null) : PrimitiveToTS<P> | null>
          : never
        : never
  : T extends { type: 'enum'; target: infer Target }
    ? Target extends string
      ? ('nullable' extends keyof T
          ? (T['nullable'] extends false
              ? EnumToTS<Target, S>
              : EnumToTS<Target, S> | null)
          : EnumToTS<Target, S> | null)
      : never
    : T extends { type: 'complex'; target: infer Target }
      ? Target extends string
        ? ('nullable' extends keyof T
            ? (T['nullable'] extends false
                ? ComplexTypeToTS<Target, S, Visited>
                : ComplexTypeToTS<Target, S, Visited> | null)
            : ComplexTypeToTS<Target, S, Visited> | null)
        : never
      : T extends { type: infer P }
        ? P extends PrimitiveName
          ? ('nullable' extends keyof T
              ? (T['nullable'] extends false
                  ? PrimitiveToTS<P>
                  : PrimitiveToTS<P> | null)
              : PrimitiveToTS<P> | null)
          : never
        : never;

// Map a record of properties to TypeScript types
type MapPropertiesToTS<
  Props extends Record<string, ODataType<any, any, any>>,
  S extends Schema<S>
> = {
  readonly [K in keyof Props]: ODataTypeToTS<Props[K], S>;
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
  readonly properties: MapPropertiesToTS<
    ExtractProperties<FlattenEntityType<S, EntityTypeNameFromEntitySet<S, ES>>>,
    S
  >;
  readonly navigations: {
    readonly [K in keyof ExtractNavigations<FlattenEntityType<S, EntityTypeNameFromEntitySet<S, ES>>>]: ExtractNavigations<
      FlattenEntityType<S, EntityTypeNameFromEntitySet<S, ES>>
    >[K] extends { target: infer Target; collection: infer C }
      ? Target extends keyof S['entitytypes']
        ? EntitySetsForEntityType<S, Target> extends infer EntitySetKey
          ? EntitySetKey extends string
            ? {
                // Resolve target to QueryableEntity type (like ResolvedSchema does)
                readonly target: EntitySetToQueryableEntity<S, EntitySetKey>;
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
// Filter Unbound Operations
// ============================================================================

// Extract keys of unbound actions
export type UnboundActionKeys<S extends Schema<S>> = {
  [K in keyof NonNullable<S['actions']>]: 
    NonNullable<S['actions']>[K] extends { type: 'unbound' } ? K : never
}[keyof NonNullable<S['actions']>];

// Extract keys of unbound functions
export type UnboundFunctionKeys<S extends Schema<S>> = {
  [K in keyof NonNullable<S['functions']>]: 
    NonNullable<S['functions']>[K] extends { type: 'unbound' } ? K : never
}[keyof NonNullable<S['functions']>];

// ============================================================================
// Filter Bound Operations for EntitySet
// ============================================================================

// Extract keys of bound actions for a specific entityset and scope
export type BoundActionKeysForEntitySet<
  S extends Schema<S>,
  ES extends keyof S['entitysets'],
  Scope extends 'entity' | 'collection'
> = {
  [K in keyof NonNullable<S['actions']>]: 
    NonNullable<S['actions']>[K] extends { 
      type: 'bound'; 
      target: EntityTypeNameFromEntitySet<S, ES>; 
      collection: Scope extends 'collection' ? true : false 
    } ? K : never
}[keyof NonNullable<S['actions']>];

// Extract keys of bound functions for a specific entityset and scope
export type BoundFunctionKeysForEntitySet<
  S extends Schema<S>,
  ES extends keyof S['entitysets'],
  Scope extends 'entity' | 'collection'
> = {
  [K in keyof NonNullable<S['functions']>]: 
    NonNullable<S['functions']>[K] extends { 
      type: 'bound'; 
      target: EntityTypeNameFromEntitySet<S, ES>; 
      collection: Scope extends 'collection' ? true : false 
    } ? K : never
}[keyof NonNullable<S['functions']>];

// ============================================================================
// Helper Types
// ============================================================================

// Check if a type is never
export type IsNever<T> = [T] extends [never] ? true : false;

// Extract non-never keys from a record
export type NonNeverKeys<T extends Record<string, any>> = {
  [K in keyof T]: IsNever<T[K]> extends true ? never : K;
}[keyof T];
