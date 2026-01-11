// ============================================================================
// Property Type System
// ============================================================================

export type Property = "key" | "string" | "number" | "boolean" | "date" | "datetimeoffset" | "time" | "guid" | "binary" | "decimal" | "duration" | "enum" | "complex";

export type CommonPropertyOptions = {
  readonly?: boolean;
  nullable?: boolean;
  collection?: boolean;
};

export type EnumPropertyOptions<TEnum extends string = string> = CommonPropertyOptions & {
  enum: TEnum;
};

export type ComplexPropertyOptions<TTarget extends string = string> = CommonPropertyOptions & {
  target: TTarget;
};

export type PropertyOptions = 
  | CommonPropertyOptions
  | EnumPropertyOptions
  | ComplexPropertyOptions;

export type PropertyDef = 
  | ({ type: "enum" } & EnumPropertyOptions)
  | ({ type: "complex" } & ComplexPropertyOptions)
  | ({ type: Exclude<Property, "enum" | "complex"> } & CommonPropertyOptions);

export function property<const TEnum extends string, const O extends EnumPropertyOptions<TEnum>>(
  type: "enum", 
  options: O
): { type: "enum" } & O;

export function property<const TTarget extends string, const O extends ComplexPropertyOptions<TTarget>>(
  type: "complex", 
  options: O
): { type: "complex" } & O;

export function property<T extends Exclude<Property, "enum" | "complex">, const O extends CommonPropertyOptions>(
  type: T, 
  options?: O
): { type: T } & O;

export function property(type: any, options: any) {
  if (options) {
    return { type, ...options };
  }
  return { type };
}

// ============================================================================
// Response Types
// ============================================================================

// OData metadata (moved from old ODataResponse)
export type ODataMetadata = {
  "@odata.context"?: string;
  "@odata.count"?: number;
  "@odata.nextLink"?: string;
  [key: string]: any;
};

// HTTP Response wrapper (no OData metadata here)
// Discriminated union so TypeScript can narrow based on 'ok' property
export type ODataResponse<TSuccess, TError = { error: any }> = 
  | {
      ok: true;
      status: number;
      statusText: string;
      headers?: Headers;
      result: TSuccess;  // Success result (data + OData metadata)
    }
  | {
      ok: false;
      status: number;
      statusText: string;
      headers?: Headers;
      result: TError;  // Error result
    };

// Legacy types (deprecated - will be removed after migration)
export type ODataResponseLegacy = ODataMetadata;
export type ODataSuccess<T> = {
  ok: true;
  data: T;
  status: number;
  headers?: Headers;
} & ODataMetadata;
export type ODataError = {
  ok: false;
  error: any;
  status: number;
  statusText: string;
  headers?: Headers;
};
export type ODataResult<T> = ODataSuccess<T> | ODataError;


// ============================================================================
// Schema Definition Types
// ============================================================================

export type Navigation<T extends { entitysets: { [key: string]: { properties: { [key: string]: PropertyDef } } } }> = {
  target: keyof T["entitysets"] | (keyof T["entitysets"])[];
  collection: boolean;
};

export type ReturnTypeRef<T extends { entitysets: Record<string, any>; complexTypes?: Record<string, any> }> = 
  | PropertyDef 
  | {
      target: keyof T["entitysets"] | (T["complexTypes"] extends Record<string, any> ? keyof T["complexTypes"] : never);
      collection: boolean;
    };

export type ParameterDef<T extends { entitysets: Record<string, any> }> = PropertyDef | Navigation<T>;

type OperationBase<T extends { entitysets: Record<string, any>; complexTypes?: Record<string, any> }> = {
  parameters: { [key: string]: ParameterDef<T> };
  useSchemaFQN?: boolean;
};

export type UnboundActionDefinition<T extends { entitysets: Record<string, any>; complexTypes?: Record<string, any> }> = OperationBase<T> & {
  returnType?: ReturnTypeRef<T>;
};

export type BoundActionDefinition<T extends { entitysets: Record<string, any>; complexTypes?: Record<string, any> }> = OperationBase<T> & {
  returnType?: ReturnTypeRef<T>;
  scope: "entity" | "collection"; 
};

export type UnboundFunctionDefinition<T extends { entitysets: Record<string, any>; complexTypes?: Record<string, any> }> = OperationBase<T> & {
  returnType: ReturnTypeRef<T>;
};

export type BoundFunctionDefinition<T extends { entitysets: Record<string, any>; complexTypes?: Record<string, any> }> = OperationBase<T> & {
  returnType: ReturnTypeRef<T>;
  scope: "entity" | "collection"; 
};

export type ComplexTypeDefinition = {
  properties: { [key: string]: PropertyDef };
};

export type SchemaDefinition<T extends { entitysets: Record<string, any>; complexTypes?: Record<string, any>; enumTypes?: Record<string, any> }> = {
  namespace: string;
  complexTypes?: Record<string, ComplexTypeDefinition>;
  enumTypes?: Record<string, {
    isFlags?: boolean;
    members: Record<string, number>;
  }>;
  entitysets: Record<
    string,
    {
      baseType?: keyof T["entitysets"];
      properties: { [key: string]: PropertyDef };
      navigations: { [key: string]: Navigation<T> };
      actions?: { [key: string]: BoundActionDefinition<T> };
      functions?: { [key: string]: BoundFunctionDefinition<T> };
    }
  >;
  actions?: { [key: string]: UnboundActionDefinition<T> };
  functions?: { [key: string]: UnboundFunctionDefinition<T> };
  singletons?: { [key: string]: { properties: { [key: string]: PropertyDef } } };
};

// ============================================================================
// Resolved Schema Types
// ============================================================================

export type EntityShallow = {
  properties: { [key: string]: PropertyDef };
  navigations: {
    [key: string]: {
      target: EntityShallow;
      targetEntitysetKey: string | string[];
      collection: boolean;
    };
  };
};

export type ResolvedComplexType = {
  properties: { [key: string]: PropertyDef };
};

type ResolveTarget<
  TSchema extends { entitysets: Record<string, any>; complexTypes: Record<string, any> }, 
  TTarget
> = TTarget extends keyof TSchema["entitysets"]
  ? TSchema["entitysets"][TTarget]
  : TTarget extends keyof TSchema["complexTypes"]
    ? TSchema["complexTypes"][TTarget]
    : TTarget extends readonly (keyof TSchema["entitysets"])[]
      ? TSchema["entitysets"][TTarget[number]]
      : never;

// Recursively flatten properties from baseType
type FlattenProperties<T extends SchemaDefinition<T>, K extends keyof T["entitysets"]> =
  T["entitysets"][K]["baseType"] extends keyof T["entitysets"]
    ? FlattenProperties<T, T["entitysets"][K]["baseType"]> & T["entitysets"][K]["properties"]
    : T["entitysets"][K]["properties"];

// Recursively flatten navigations from baseType
type FlattenNavigations<T extends SchemaDefinition<T>, K extends keyof T["entitysets"]> =
  T["entitysets"][K]["baseType"] extends keyof T["entitysets"]
    ? FlattenNavigations<T, T["entitysets"][K]["baseType"]> & T["entitysets"][K]["navigations"]
    : T["entitysets"][K]["navigations"];

export type ResolvedSchema<T extends SchemaDefinition<T>> = {
  readonly namespace: T["namespace"];
  readonly complexTypes: {
    readonly [K in keyof T["complexTypes"]]: T["complexTypes"][K];
  };
  readonly enumTypes: {
    readonly [K in keyof T["enumTypes"]]: T["enumTypes"][K];
  };
  readonly entitysets: {
    readonly [K in keyof T["entitysets"]]: {
      readonly properties: FlattenProperties<T, K>;
      readonly actions: T["entitysets"][K]["actions"] extends object ? T["entitysets"][K]["actions"] : {};
      readonly functions: T["entitysets"][K]["functions"] extends object ? T["entitysets"][K]["functions"] : {};
      readonly navigations: {
        readonly [N in keyof FlattenNavigations<T, K>]: FlattenNavigations<T, K>[N] extends { target: any, collection: any }
          ? {
              readonly target: ResolveTarget<ResolvedSchema<T>, FlattenNavigations<T, K>[N]["target"]>;
              readonly targetEntitysetKey: FlattenNavigations<T, K>[N]["target"];
              readonly collection: FlattenNavigations<T, K>[N]["collection"];
            }
          : never;
      };
    };
  };
  readonly actions: T["actions"] extends object ? T["actions"] : {};
  readonly functions: T["functions"] extends object ? T["functions"] : {};
};

// ============================================================================
// Schema Builder Function
// ============================================================================

function intersectEntities(entities: any[]): any {
  if (entities.length === 0) return { properties: {}, navigations: {}, actions: {}, functions: {} };
  if (entities.length === 1) return entities[0];

  const properties: Record<string, any> = {};
  const firstProps = entities[0].properties;
  for (const key in firstProps) {
    if (entities.every(e => key in e.properties)) {
      properties[key] = firstProps[key];
    }
  }

  const navigations: Record<string, any> = {};
  const firstNavs = entities[0].navigations;
  for (const key in firstNavs) {
    if (entities.every(e => key in e.navigations)) {
       navigations[key] = firstNavs[key];
    }
  }

  return { properties, navigations, actions: {}, functions: {} };
}

export function schema<const T extends SchemaDefinition<T>>(definition: T): ResolvedSchema<T> {
  const resolvedEntitysets = {} as any;

  // Helper to recursively merge properties and navigations from base types
  const getMergedDefinition = (key: string, visited: string[] = []): { properties: any, navigations: any } => {
    if (visited.includes(key)) {
      throw new Error(`Circular inheritance detected: ${visited.join(' -> ')} -> ${key}`);
    }
    
    const defs = definition.entitysets as any;
    const entityDef = defs[key];
    
    if (!entityDef) throw new Error(`Entity '${key}' not found`);

    let baseProps = {};
    let baseNavs = {};

    if (entityDef.baseType) {
      const baseDef = getMergedDefinition(entityDef.baseType as string, [...visited, key]);
      baseProps = baseDef.properties;
      baseNavs = baseDef.navigations;
    }

    return {
      properties: { ...baseProps, ...entityDef.properties },
      navigations: { ...baseNavs, ...entityDef.navigations }
    };
  };

  // Phase 1: Initialize resolvedEntitysets with flattened properties
  for (const entitysetKey of Object.keys(definition.entitysets) as Array<keyof T["entitysets"]>) {
    const setDef = definition.entitysets[entitysetKey as string]!;
    const merged = getMergedDefinition(entitysetKey as string);

    resolvedEntitysets[entitysetKey] = {
      properties: merged.properties,
      navigations: {}, 
      _rawNavigations: merged.navigations, 
      actions: setDef.actions || {},
      functions: setDef.functions || {},
    };
  }

  // Phase 2: Resolve Navigation Targets
  for (const entitysetKey of Object.keys(definition.entitysets) as Array<keyof T["entitysets"]>) {
    const entity = resolvedEntitysets[entitysetKey];
    const navDefs = entity._rawNavigations;

    for (const navKey of Object.keys(navDefs)) {
      const navDef = navDefs[navKey];

      Object.defineProperty(entity.navigations, navKey, {
        get: () => {
          let targetObj;
          if (Array.isArray(navDef.target)) {
             const targets = (navDef.target as string[]).map((t: string) => resolvedEntitysets[t]);
             targetObj = intersectEntities(targets);
          } else {
             targetObj = resolvedEntitysets[navDef.target as string];
          }

          return {
            target: targetObj,
            targetEntitysetKey: navDef.target,
            collection: navDef.collection,
          };
        },
        enumerable: true,
      });
    }
    delete entity._rawNavigations;
  }

  return {
    namespace: definition.namespace,
    complexTypes: definition.complexTypes || {},
    enumTypes: definition.enumTypes || {},
    entitysets: resolvedEntitysets,
    actions: definition.actions || {},
    functions: definition.functions || {},
  } as ResolvedSchema<T>;
}

// ============================================================================
// Helper Types
// ============================================================================

export type NavIsMany<T> = T extends { collection: true } ? true : false;
export type NavEntity<T> = T extends { target: infer E } ? (E extends EntityShallow ? E : never) : never;
export type PropertyBaseType<T> = T extends { type: infer U } ? U : T;
export type IsReadonly<T> = T extends { readonly: true } ? true : false;
export type IsNullable<T> = T extends { nullable: false } ? false : true;

export type ActionKeysByScope<Actions, Scope> = {
  [K in keyof Actions]: Actions[K] extends { scope: Scope } ? K : never
}[keyof Actions];

export type FunctionKeysByScope<Functions, Scope> = {
  [K in keyof Functions]: Functions[K] extends { scope: Scope } ? K : never
}[keyof Functions];

// ============================================================================
// Property Type Mapper
// ============================================================================

export type PropertyTypeToTS<T, S extends { complexTypes?: Record<string, any> } = any> = 
  T extends { type: "complex", target: infer Target, collection: true }
  ? Target extends string 
    ? Target extends keyof S["complexTypes"]
      ? S["complexTypes"][Target] extends { properties: any }
        ? Array<SelectedProperties<S["complexTypes"][Target], undefined, S>>
        : any
      : any
    : never
  : T extends { type: "complex", target: infer Target }
  ? Target extends string
    ? Target extends keyof S["complexTypes"]
      ? S["complexTypes"][Target] extends { properties: any }
        ? SelectedProperties<S["complexTypes"][Target], undefined, S>
        : any
      : any
    : never
  : T extends { type: "enum", collection: true }
  ? number[]
  : T extends { type: "enum" }
  ? number
  : T extends { type: infer U, collection: true }
  ? U extends Property
    ? Array<PropertyTypeToTS<{ type: U }, S>>
    : never
  : T extends { type: infer U }
  ? U extends "string"
    ? string
    : U extends "number"
    ? number
    : U extends "boolean"
    ? boolean
    : U extends "date" | "time" | "datetimeoffset"
    ? Date | string
    : U extends "key" | "guid" | "duration"
    ? string
    : U extends "binary"
    ? ArrayBuffer | string
    : U extends "decimal"
    ? number | string
    : never
  : T extends "string"
  ? string
  : T extends "number"
  ? number
  : T extends "boolean"
  ? boolean
  : T extends "date" | "time" | "datetimeoffset"
  ? Date | string
  : T extends "key" | "guid" | "duration"
  ? string
  : T extends "binary"
  ? ArrayBuffer | string
  : T extends "decimal"
  ? number | string
  : never;

// ============================================================================
// Query Types
// ============================================================================

// IMPORTANT: Non-recursive constraint to prevent "Excessive stack depth" errors
// during type instantiation when checking against flattened/inherited schemas.
export type QueryableEntity = {
  readonly properties: { readonly [key: string]: any };
  readonly navigations: { 
    readonly [key: string]: { 
      target: any; 
      targetEntitysetKey: string | string[]; 
      collection: boolean 
    } 
  };
};

type BaseQueryObject<E extends QueryableEntity> = {
  select?: (keyof E["properties"])[];
  expand?: {
    [K in keyof E["navigations"]]?: SingleQueryObject<E["navigations"][K]["target"]> | CollectionQueryObject<E["navigations"][K]["target"]>;
  };
};

export type SingleQueryObject<E extends QueryableEntity> = BaseQueryObject<E>;

export type CollectionQueryObject<E extends QueryableEntity> = BaseQueryObject<E> & {
  top?: number;
  orderby?: [keyof E["properties"], "asc" | "desc"] | Array<[keyof E["properties"], "asc" | "desc"]>;
  filter?: E extends QueryableEntity ? (h: import('./filter').FilterHelpers<E>) => import('./filter').FilterBuilder<E> : never;
  count?: boolean;
};

export type SelectedProperties<E extends { properties: any }, S, Schema extends { complexTypes?: Record<string, any> } = any> = E["properties"] extends infer Props
  ? S extends (keyof Props)[]
    ? { [P in S[number]]: PropertyTypeToTS<Props[P], Schema> }
    : { [P in keyof Props]: PropertyTypeToTS<Props[P], Schema> }
  : never;

export type ExpandedProperties<E extends QueryableEntity, X> = X extends Record<string, any>
  ? {
      [K in keyof X & keyof E["navigations"]]: X[K] extends SingleQueryObject<E["navigations"][K]["target"]> | CollectionQueryObject<E["navigations"][K]["target"]>
        ? NavIsMany<E["navigations"][K]> extends true
          ? Array<CollectedProperties<E["navigations"][K]["target"], X[K]>>
          : CollectedProperties<E["navigations"][K]["target"], X[K]>
        : never;
    }
  : {};

export type CollectedProperties<E extends QueryableEntity, Q extends SingleQueryObject<E> | CollectionQueryObject<E>, Schema extends { complexTypes?: Record<string, any> } = any> = "select" extends keyof Q
  ? Q["select"] extends readonly (keyof E["properties"])[]
    ? SelectedProperties<E, Q["select"], Schema> & ("expand" extends keyof Q ? ExpandedProperties<E, Q["expand"]> : {})
    : { [P in keyof E["properties"]]: PropertyTypeToTS<E["properties"][P], Schema> } & ("expand" extends keyof Q ? ExpandedProperties<E, Q["expand"]> : {})
  : { [P in keyof E["properties"]]: PropertyTypeToTS<E["properties"][P], Schema> } & ("expand" extends keyof Q ? ExpandedProperties<E, Q["expand"]> : {});

export type QueryOperationOptions = {
  headers?: Record<string, string>;
  prefer?: {
    maxpagesize?: number;
    [key: string]: any;
  };
  [key: string]: any;
};

type HasPagination<O> = O extends { prefer: { maxpagesize: number } } ? true : false;

export type SingleQueryResult<E extends QueryableEntity, Q extends SingleQueryObject<E>, O extends QueryOperationOptions = {}> = 
  ODataResult<CollectedProperties<E, Q>>;

export type CollectionQuerySuccess<E extends QueryableEntity, Q extends CollectionQueryObject<E>, O extends QueryOperationOptions> = 
  ODataSuccess<Array<CollectedProperties<E, Q>>> & 
  (HasPagination<O> extends true ? { next: () => Promise<CollectionQueryResponse<E, Q, O>> } : {});

export type CollectionQueryResult<E extends QueryableEntity, Q extends CollectionQueryObject<E>, O extends QueryOperationOptions = {}> = 
  | CollectionQuerySuccess<E, Q, O>
  | ODataError;

// ============================================================================
// New Response Types (Separated HTTP from Business Result)
// ============================================================================

// Business result types (includes OData metadata, no HTTP metadata)
export type CollectionQueryData<E extends QueryableEntity, Q extends CollectionQueryObject<E>, O extends QueryOperationOptions> = {
  data: Array<CollectedProperties<E, Q>>;
} & ODataMetadata;

export type CollectionQueryError = {
  error: any;
};

export type CollectionQueryResultData<E extends QueryableEntity, Q extends CollectionQueryObject<E>, O extends QueryOperationOptions> = 
  | CollectionQueryData<E, Q, O> 
  | CollectionQueryError;

// Response type (HTTP wrapper + business result)
// Discriminated union: ok: true -> result is CollectionQueryData, ok: false -> result is CollectionQueryError
// Apply HasPagination to each branch separately to preserve discriminated union
export type CollectionQueryResponse<E extends QueryableEntity, Q extends CollectionQueryObject<E>, O extends QueryOperationOptions = {}> = 
  | ({
      ok: true;
      status: number;
      statusText: string;
      headers?: Headers;
      result: CollectionQueryData<E, Q, O>;
    } & (HasPagination<O> extends true ? { next: () => Promise<CollectionQueryResponse<E, Q, O>> } : {}))
  | {
      ok: false;
      status: number;
      statusText: string;
      headers?: Headers;
      result: CollectionQueryError;
    };

// Single Query Types
export type SingleQueryData<E extends QueryableEntity, Q extends SingleQueryObject<E>> = {
  data: CollectedProperties<E, Q>;
} & ODataMetadata;

export type SingleQueryError = {
  error: any;
};

export type SingleQueryResultData<E extends QueryableEntity, Q extends SingleQueryObject<E>> = 
  | SingleQueryData<E, Q>
  | SingleQueryError;

export type SingleQueryResponse<E extends QueryableEntity, Q extends SingleQueryObject<E>, O extends QueryOperationOptions = {}> = 
  ODataResponse<SingleQueryData<E, Q>, SingleQueryError>;

// Create Types
export type CreateResultData<QE extends QueryableEntity, O extends CreateOperationOptions<QE>> = 
  O extends { prefer: { return_representation: true } }
  ? { data: SelectedProperties<QE, O["select"]> } & ODataMetadata
  : O extends { select: any } 
  ? { data: SelectedProperties<QE, O["select"]> } & ODataMetadata
  : { data: void } & ODataMetadata;

export type CreateResultError = { error: any };

export type CreateResultDataUnion<QE extends QueryableEntity, O extends CreateOperationOptions<QE>> = 
  | CreateResultData<QE, O>
  | CreateResultError;

export type CreateResponse<QE extends QueryableEntity, O extends CreateOperationOptions<QE> = {}> = 
  ODataResponse<CreateResultData<QE, O>, CreateResultError>;

// Update Types
export type UpdateResultData<QE extends QueryableEntity, O extends UpdateOperationOptions<QE>> = 
  O extends { prefer: { return_representation: true } }
  ? { data: SelectedProperties<QE, O["select"]> } & ODataMetadata
  : O extends { select: any } 
  ? { data: SelectedProperties<QE, O["select"]> } & ODataMetadata
  : { data: void } & ODataMetadata;

export type UpdateResultError = { error: any };

export type UpdateResultDataUnion<QE extends QueryableEntity, O extends UpdateOperationOptions<QE>> = 
  | UpdateResultData<QE, O>
  | UpdateResultError;

export type UpdateResponse<QE extends QueryableEntity, O extends UpdateOperationOptions<QE> = {}> = 
  ODataResponse<UpdateResultData<QE, O>, UpdateResultError>;

// Delete Types
export type DeleteResultData = { data: void } & ODataMetadata;

export type DeleteResultError = { error: any };

export type DeleteResultDataUnion = 
  | DeleteResultData
  | DeleteResultError;

export type DeleteResponse = ODataResponse<DeleteResultData, DeleteResultError>;

// Action & Function Result Types
export type ActionResultData<S extends ResolvedSchema<any>, R extends ReturnTypeRef<any> | undefined> = {
  data: R extends undefined
    ? void
    : R extends { type: "complex", target: infer T }
    ? T extends keyof S["complexTypes"]
      ? R extends { collection: true }
        ? Array<SelectedProperties<S["complexTypes"][T], undefined, S>>
        : SelectedProperties<S["complexTypes"][T], undefined, S>
      : any
    : R extends { target: infer T }
    ? T extends keyof S["entitysets"]
      ? R extends { collection: true }
        ? Array<CollectedProperties<S["entitysets"][T], {}, S>>
        : CollectedProperties<S["entitysets"][T], {}, S>
      : T extends keyof S["complexTypes"]
      ? R extends { collection: true }
        ? Array<SelectedProperties<S["complexTypes"][T], undefined, S>>
        : SelectedProperties<S["complexTypes"][T], undefined, S>
      : any
    : R extends PropertyDef
    ? PropertyTypeToTS<R, S>
    : void;
} & ODataMetadata;

export type ActionResultError = { error: any };

export type ActionResultDataUnion<S extends ResolvedSchema<any>, R extends ReturnTypeRef<any> | undefined> = 
  | ActionResultData<S, R>
  | ActionResultError;

export type ActionResponse<S extends ResolvedSchema<any>, R extends ReturnTypeRef<any> | undefined> = 
  ODataResponse<ActionResultData<S, R>, ActionResultError>;

export type FunctionResultData<S extends ResolvedSchema<any>, R extends ReturnTypeRef<any> | undefined> = ActionResultData<S, R>;
export type FunctionResultError = ActionResultError;
export type FunctionResultDataUnion<S extends ResolvedSchema<any>, R extends ReturnTypeRef<any> | undefined> = ActionResultDataUnion<S, R>;
export type FunctionResponse<S extends ResolvedSchema<any>, R extends ReturnTypeRef<any> | undefined> = 
  ODataResponse<FunctionResultData<S, R>, FunctionResultError>;

// ============================================================================
// Action & Function Types (Legacy)
// ============================================================================

export type ResolveReturnType<S extends ResolvedSchema<any>, R extends ReturnTypeRef<any> | undefined> = ODataResult<
  R extends undefined
  ? void
  : R extends { type: "complex", target: infer T }
  ? T extends keyof S["complexTypes"]
    ? R extends { collection: true }
      ? Array<SelectedProperties<S["complexTypes"][T], undefined, S>>
      : SelectedProperties<S["complexTypes"][T], undefined, S>
    : any
  : R extends { target: infer T }
  ? T extends keyof S["entitysets"]
    ? R extends { collection: true }
      ? Array<CollectedProperties<S["entitysets"][T], {}, S>>
      : CollectedProperties<S["entitysets"][T], {}, S>
    : T extends keyof S["complexTypes"]
    ? R extends { collection: true }
      ? Array<SelectedProperties<S["complexTypes"][T], undefined, S>>
      : SelectedProperties<S["complexTypes"][T], undefined, S>
    : any
  : R extends PropertyDef
  ? PropertyTypeToTS<R, S>
  : void
>;

export type ComplexTypeInput<E extends { properties: any }, S extends { complexTypes?: Record<string, any> } = any> = {
  [K in keyof E["properties"] as IsReadonly<E["properties"][K]> extends true ? never : K]?: PropertyTypeToTS<PropertyBaseType<E["properties"][K]>, S>;
};

export type OperationParameterType<S extends ResolvedSchema<any>, P> = 
  P extends { type: "complex", target: infer T }
    ? T extends keyof S["entitysets"]
      ? CreateObject<S["entitysets"][T]>
      : T extends keyof S["complexTypes"]
        ? S["complexTypes"][T] extends { properties: any }
          ? ComplexTypeInput<S["complexTypes"][T], S>
          : any
        : any
  : P extends { target: infer T }
    ? T extends keyof S["entitysets"]
      ? CreateObject<S["entitysets"][T]>
      : T extends keyof S["complexTypes"]
        ? S["complexTypes"][T] extends { properties: any }
          ? ComplexTypeInput<S["complexTypes"][T], S>
          : any
        : any 
  : PropertyTypeToTS<P, S>;

export type OperationParameters<S extends ResolvedSchema<any>, Params> = {
  [K in keyof Params as IsNullable<Params[K]> extends true ? K : never]?: OperationParameterType<S, Params[K]>;
} & {
  [K in keyof Params as IsNullable<Params[K]> extends true ? never : K]: OperationParameterType<S, Params[K]>;
};

// ============================================================================
// Create/Update Types
// ============================================================================

type WritableProperties<E extends QueryableEntity> = {
  [K in keyof E["properties"] as IsReadonly<E["properties"][K]> extends true ? never : K]?: PropertyTypeToTS<PropertyBaseType<E["properties"][K]>>;
};

type CreateNavigationValue<N extends { target: any; collection: boolean; targetEntitysetKey: any }> = N["collection"] extends true
  ? string[] | CreateObject<NavEntity<N>>[]
  : N["targetEntitysetKey"] extends any[]
    ? [N["targetEntitysetKey"][number], string] | CreateObject<NavEntity<N>>
    : string | CreateObject<NavEntity<N>>;

type WritableNavigations<E extends QueryableEntity> = {
  [K in keyof E["navigations"]]?: CreateNavigationValue<E["navigations"][K]>;
};

export type CreateObject<E extends QueryableEntity> = WritableProperties<E> & WritableNavigations<E>;

export type CollectionNavUpdateSpec = {
  replace?: (string | number | [string, string | number])[];
  add?: (string | number | [string, string | number])[];
  remove?: (string | number | [string, string | number])[];
};

type SingleNavUpdateValue<N extends { target: any; collection: boolean; targetEntitysetKey: any }> = N["collection"] extends true 
  ? never 
  : N["targetEntitysetKey"] extends any[]
    ? [N["targetEntitysetKey"][number], string | number] | null
    : string | number | null;

type SingleNavUpdates<E extends QueryableEntity> = {
  [K in keyof E["navigations"] as E["navigations"][K]["collection"] extends true ? never : K]?: SingleNavUpdateValue<E["navigations"][K]>;
};

type CollectionNavUpdates<E extends QueryableEntity> = {
  [K in keyof E["navigations"] as E["navigations"][K]["collection"] extends true ? K : never]?: CollectionNavUpdateSpec;
};

export type UpdateObject<E extends QueryableEntity> = Partial<WritableProperties<E>> & SingleNavUpdates<E> & CollectionNavUpdates<E>;

export type CreateOperationOptions<QE extends QueryableEntity> = {
  headers?: Record<string, string>;
  select?: (keyof QE["properties"])[];
  prefer?: {
    return_representation?: boolean;
    [key: string]: any;
  };
  [key: string]: any;
};

export type UpdateOperationOptions<QE extends QueryableEntity> = CreateOperationOptions<QE>;

export type CreateResult<QE extends QueryableEntity, O extends CreateOperationOptions<QE> = {}> = 
  O extends { prefer: { return_representation: true } }
  ? ODataResult<SelectedProperties<QE, O["select"]>>
  : O extends { select: any } 
  ? ODataResult<SelectedProperties<QE, O["select"]>>
  : ODataResult<void>;

export type UpdateResult<E extends QueryableEntity, O extends UpdateOperationOptions<E> = {}> = CreateResult<E, O>;