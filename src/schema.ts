// ============================================================================
// Schema Definition Types
// ============================================================================

// 1. Primitive Type Names (Full 4.01 support)
export type PrimitiveName =
  | 'Edm.Binary'
  | 'Edm.Boolean'
  | 'Edm.Byte'
  | 'Edm.Date'
  | 'Edm.DateTimeOffset'
  | 'Edm.Decimal'
  | 'Edm.Double'
  | 'Edm.Duration'
  | 'Edm.Guid'
  | 'Edm.Int16'
  | 'Edm.Int32'
  | 'Edm.Int64'
  | 'Edm.SByte'
  | 'Edm.Single'
  | 'Edm.Stream'
  | 'Edm.String'
  | 'Edm.TimeOfDay'
  | 'Edm.Untyped'
  // Spatial - Geography
  | 'Edm.Geography'
  | 'Edm.GeographyPoint'
  | 'Edm.GeographyLineString'
  | 'Edm.GeographyPolygon'
  | 'Edm.GeographyMultiPoint'
  | 'Edm.GeographyMultiLineString'
  | 'Edm.GeographyMultiPolygon'
  | 'Edm.GeographyCollection'
  // Spatial - Geometry
  | 'Edm.Geometry'
  | 'Edm.GeometryPoint'
  | 'Edm.GeometryLineString'
  | 'Edm.GeometryPolygon'
  | 'Edm.GeometryMultiPoint'
  | 'Edm.GeometryMultiLineString'
  | 'Edm.GeometryMultiPolygon'
  | 'Edm.GeometryCollection'
  // Paths
  | 'Edm.ModelElementPath'
  | 'Edm.AnyPropertyPath';

// 2. Common Options (Applied to ALL types)
export type TypeOptions = {
  nullable?: boolean;
  collection?: boolean;
};

// 3. Specific Type Definitions

// Primitives
export type PrimitiveType = {
  type: PrimitiveName;
} & TypeOptions;

// EnumType and ComplexType Definition Types
export type EnumTypeDefinition = {
  isFlags?: boolean;
  members: { [name: string]: number };
};

// Enums (Property Type)
export type EnumType<TEnumKeys extends string = string> = {
  type: 'enum';
  target: TEnumKeys; // keyof enumtypes
} & TypeOptions;

// Complex Types (Property Type)
export type ComplexType<TComplexKeys extends string = string> = {
  type: 'complex';
  target: TComplexKeys; // keyof complextypes
} & TypeOptions;

// Navigations (Entities)
export type NavigationType<TTarget extends string = string> = {
  type: 'navigation'; // Represents an Entity relationship
  target: TTarget; // Points to an EntityType
} & TypeOptions;

// 4. Unified Union Type
export type ODataType<
  TEntityTypeKeys extends string = string,
  TEnumKeys extends string = string,
  TComplexKeys extends string = string
> =
  | PrimitiveType
  | EnumType<TEnumKeys>
  | ComplexType<TComplexKeys>
  | NavigationType<TEntityTypeKeys>;

// 4a. ComplexType Definition Structure
export type ComplexTypeDefinition<
  TEntityTypeKeys extends string = string,
  TEnumKeys extends string = string,
  TComplexKeys extends string = string
> = {
  [key: string]: ODataType<TEntityTypeKeys, TEnumKeys, TComplexKeys>;
};

// 4b. EntityType Structure
export type EntityType<
  TEntityTypeKeys extends string = string,
  TEnumKeys extends string = string,
  TComplexKeys extends string = string
> = {
  baseType?: Extract<TEntityTypeKeys, string>;
  properties: {
    [key: string]: ODataType<TEntityTypeKeys, TEnumKeys, TComplexKeys>;
  };
};

// 5. Action Types
export type BoundAction<TEntityTypeKeys extends string = string> = {
  type: 'bound';
  collection: boolean;
  target: TEntityTypeKeys; // keyof entitytypes (constrained in Schema)
  parameters: Record<string, ODataType<any>>;
  returnType?: ODataType<any>; // optional - actions can return void
};

export type UnboundAction = {
  type: 'unbound';
  parameters: Record<string, ODataType<any>>;
  returnType?: ODataType<any>; // optional - actions can return void
};

export type Action<TEntityTypeKeys extends string = string> =
  | BoundAction<TEntityTypeKeys>
  | UnboundAction;

// 6. Function Types
export type BoundFunction<TEntityTypeKeys extends string = string> = {
  type: 'bound';
  collection: boolean;
  target: TEntityTypeKeys; // keyof entitytypes (constrained in Schema)
  parameters: Record<string, ODataType<any>>;
  returnType: ODataType<any>; // required - functions must return a value
};

export type UnboundFunction = {
  type: 'unbound';
  parameters: Record<string, ODataType<any>>;
  returnType: ODataType<any>; // required - functions must return a value
};

export type Function<TEntityTypeKeys extends string = string> =
  | BoundFunction<TEntityTypeKeys>
  | UnboundFunction;

// 7. Import Types
export type ActionImport<TActionKeys extends string> = {
  action: TActionKeys;
};

export type FunctionImport<TFunctionKeys extends string> = {
  function: TFunctionKeys;
};

// 7a. Helper Types for Filtering Unbound Operations
// Extract only unbound action keys from raw schema type T
type UnboundActionKeysFromRaw<T extends { actions?: Record<string, any> }> = 
  'actions' extends keyof T
    ? T['actions'] extends Record<string, any>
      ? {
          [K in keyof T['actions']]: 
            T['actions'][K] extends { type: 'unbound' } ? K : never
        }[keyof T['actions']]
      : never
    : never;

// Extract only unbound function keys from raw schema type T
type UnboundFunctionKeysFromRaw<T extends { functions?: Record<string, any> }> = 
  'functions' extends keyof T
    ? T['functions'] extends Record<string, any>
      ? {
          [K in keyof T['functions']]: 
            T['functions'][K] extends { type: 'unbound' } ? K : never
        }[keyof T['functions']]
      : never
    : never;

// 8. Schema Interface
export interface Schema<
  T extends {
    namespace: string;
    alias: string;
    entitytypes: Record<string, any>;
    entitysets: Record<string, any>;
    enumtypes?: Record<string, any>;
    complextypes?: Record<string, any>;
    actions?: Record<string, any>;
    functions?: Record<string, any>;
  }
> {
  namespace: string;
  alias: string;
  entitytypes: {
    [key: string]: EntityType<
      Extract<keyof T['entitytypes'], string>,
      Extract<keyof NonNullable<T['enumtypes']>, string>,
      Extract<keyof NonNullable<T['complextypes']>, string>
    >;
  };
  entitysets: {
    [key: string]: {
      entitytype: Extract<keyof T['entitytypes'], string>;
    };
  };
  enumtypes?: {
    [key: string]: EnumTypeDefinition;
  };
  complextypes?: {
    [key: string]: ComplexTypeDefinition<
      Extract<keyof T['entitytypes'], string>,
      Extract<keyof NonNullable<T['enumtypes']>, string>,
      Extract<keyof NonNullable<T['complextypes']>, string>
    >;
  };
  actions?: { [key: string]: Action<Extract<keyof T['entitytypes'], string>> };
  functions?: { [key: string]: Function<Extract<keyof T['entitytypes'], string>> };
  actionImports?: T['actions'] extends Record<string, any>
    ? { [key: string]: ActionImport<Extract<UnboundActionKeysFromRaw<T>, string>> }
    : never;
  functionImports?: T['functions'] extends Record<string, any>
    ? { [key: string]: FunctionImport<Extract<UnboundFunctionKeysFromRaw<T>, string>> }
    : never;
}

// ============================================================================
// Schema Helper Types
// ============================================================================

// Extract entitytype from entityset
export type EntityTypeFromEntitySet<
  T extends Schema<T>,
  K extends keyof T['entitysets']
> = T['entitysets'][K]['entitytype'];

// Extract entitytype definition from entitytype key
export type EntityTypeFromEntityTypeKeys<
  T extends Schema<T>,
  K extends keyof T['entitytypes']
> = T['entitytypes'][K];

// Extract navigation target
export type NavigationsTarget<N extends { target: any }> = N['target'];

// ============================================================================
// Schema Builder Function
// ============================================================================

export function schema<S extends Schema<S>>(definition: S): S {
  // Identity function - schema stays raw, no runtime transformation
  // Optional: Add runtime validation here (circular inheritance, etc.)
  return definition;
}
