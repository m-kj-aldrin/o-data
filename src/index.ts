// ============================================================================
// OData Client Implementation
// ============================================================================

import type { Schema } from './schema';
import type {
  QueryableEntity,
  EntitySetToQueryableEntity,
  EntitySetToQueryableEntity as ResolveEntitySet,
} from './types';
import type {
  CollectionQueryResponse,
  SingleQueryResponse,
  CreateResponse,
  UpdateResponse,
  DeleteResponse,
  ActionResponse,
  FunctionResponse,
} from './response';
import type {
  CollectionQueryObject,
  SingleQueryObject,
  QueryOperationOptions,
} from './query';
import type {
  CreateObject,
  UpdateObject,
  CreateOperationOptions,
  UpdateOperationOptions,
  OperationParameters,
} from './operations';

// ============================================================================
// Types
// ============================================================================

type Fetch = (input: Request, init?: RequestInit) => Promise<Response>;

export type OdataClientOptions = {
  baseUrl: string;
  transport: Fetch;
};

// Extract entityset names from schema
type EntitySetNames<S extends Schema<S>> = keyof S['entitysets'];

// Extract QueryableEntity from entityset
type EntitySetToQE<
  S extends Schema<S>,
  ES extends EntitySetNames<S>
> = EntitySetToQueryableEntity<S, ES>;

// ============================================================================
// OdataClient
// ============================================================================

export class OdataClient<S extends Schema<S>> {
  #schema: S;
  #options: OdataClientOptions;

  constructor(schema: S, options: OdataClientOptions) {
    this.#schema = schema;
    this.#options = options;
  }

  /**
   * Access an entityset collection.
   */
  entitysets<E extends EntitySetNames<S>>(entityset: E): CollectionOperation<S, EntitySetToQE<S, E>> {
    // TODO: Build QueryableEntity shape from schema at runtime
    const entity = {} as EntitySetToQE<S, E>;
    return new CollectionOperation(this.#schema, entity, String(entityset), this.#options);
  }

  /**
   * Execute an unbound global action.
   */
  async action<
    A extends keyof NonNullable<S['actions']>
  >(
    name: A,
    payload: { parameters: OperationParameters<S, NonNullable<S['actions']>[A]['parameters']> }
  ): Promise<ActionResponse<S, NonNullable<S['actions']>[A]['returnType']>> {
    // TODO: Implement action execution
    throw new Error('Not implemented');
  }

  /**
   * Execute an unbound global function.
   */
  async function<
    F extends keyof NonNullable<S['functions']>
  >(
    name: F,
    payload: { parameters: OperationParameters<S, NonNullable<S['functions']>[F]['parameters']> }
  ): Promise<FunctionResponse<S, NonNullable<S['functions']>[F]['returnType']>> {
    // TODO: Implement function execution
    throw new Error('Not implemented');
  }
}

// ============================================================================
// CollectionOperation
// ============================================================================

class CollectionOperation<S extends Schema<S>, QE extends QueryableEntity> {
  #schema: S;
  #entityset: QE;
  #path: string;
  #options: OdataClientOptions;

  constructor(schema: S, entityset: QE, path: string, options: OdataClientOptions) {
    this.#schema = schema;
    this.#entityset = entityset;
    this.#path = path;
    this.#options = options;
  }

  /**
   * Query a collection of entities.
   */
  async query<Q extends CollectionQueryObject<QE, S>, O extends QueryOperationOptions>(
    q: Q,
    o?: O
  ): Promise<CollectionQueryResponse<QE, Q, O>> {
    // TODO: Implement query execution
    throw new Error('Not implemented');
  }

  /**
   * Create a new entity.
   */
  async create<O extends CreateOperationOptions<QE>>(
    c: CreateObject<QE>,
    o?: O
  ): Promise<CreateResponse<QE, O>> {
    // TODO: Implement create execution
    throw new Error('Not implemented');
  }

  /**
   * Access a single entity by key.
   */
  key(key: string): SingleOperation<S, QE> {
    const newPath = `${this.#path}(${key})`;
    return new SingleOperation(this.#schema, this.#entityset, newPath, this.#options);
  }

  /**
   * Execute a bound action on the collection.
   */
  async action<
    K extends keyof NonNullable<S['actions']>
  >(
    name: K,
    payload: { parameters: OperationParameters<S, NonNullable<S['actions']>[K]['parameters']> }
  ): Promise<ActionResponse<S, NonNullable<S['actions']>[K]['returnType']>> {
    // TODO: Implement bound action execution - filter by target and scope at runtime
    throw new Error('Not implemented');
  }

  /**
   * Execute a bound function on the collection.
   */
  async function<
    K extends keyof NonNullable<S['functions']>
  >(
    name: K,
    payload: { parameters: OperationParameters<S, NonNullable<S['functions']>[K]['parameters']> }
  ): Promise<FunctionResponse<S, NonNullable<S['functions']>[K]['returnType']>> {
    // TODO: Implement bound function execution - filter by target and scope at runtime
    throw new Error('Not implemented');
  }
}

// ============================================================================
// SingleOperation
// ============================================================================

class SingleOperation<S extends Schema<S>, QE extends QueryableEntity> {
  #schema: S;
  #entityset: QE;
  #path: string;
  #options: OdataClientOptions;

  constructor(schema: S, entityset: QE, path: string, options: OdataClientOptions) {
    this.#schema = schema;
    this.#entityset = entityset;
    this.#path = path;
    this.#options = options;
  }

  /**
   * Query a single entity.
   */
  async query<Q extends SingleQueryObject<QE, S>, O extends QueryOperationOptions>(
    q: Q,
    o?: O
  ): Promise<SingleQueryResponse<QE, Q, O>> {
    // TODO: Implement query execution
    throw new Error('Not implemented');
  }

  /**
   * Update an entity.
   */
  async update<O extends UpdateOperationOptions<QE>>(
    u: UpdateObject<QE>,
    o?: O
  ): Promise<UpdateResponse<QE, O>> {
    // TODO: Implement update execution
    throw new Error('Not implemented');
  }

  /**
   * Delete an entity.
   */
  async delete(): Promise<DeleteResponse> {
    // TODO: Implement delete execution
    throw new Error('Not implemented');
  }

  /**
   * Navigate to a related entity or collection.
   */
  navigate<N extends keyof QE['navigations']>(
    navigation_property: N
  ): QE['navigations'][N]['targetEntitysetKey'] extends string
    ? QE['navigations'][N]['collection'] extends true
      ? CollectionOperation<S, ResolveEntitySet<S, QE['navigations'][N]['targetEntitysetKey']>>
      : SingleOperation<S, ResolveEntitySet<S, QE['navigations'][N]['targetEntitysetKey']>>
    : QE['navigations'][N]['collection'] extends true
    ? CollectionOperation<S, QueryableEntity>
    : SingleOperation<S, QueryableEntity> {
    // TODO: Implement navigation
    const navigation = this.#entityset.navigations[navigation_property as string];
    if (!navigation) {
      throw new Error(`Navigation property '${String(navigation_property)}' not found`);
    }
    
    const targetEntitysetKey = navigation.targetEntitysetKey;
    const newPath = `${this.#path}/${String(navigation_property)}`;
    
    // Build QueryableEntity shape from schema at runtime
    if (typeof targetEntitysetKey === 'string' && targetEntitysetKey in this.#schema.entitysets) {
      const targetEntity = {} as ResolveEntitySet<S, typeof targetEntitysetKey>;
      if (navigation.collection) {
        return new CollectionOperation(this.#schema, targetEntity, newPath, this.#options) as any;
      } else {
        return new SingleOperation(this.#schema, targetEntity, newPath, this.#options) as any;
      }
    }
    
    // Fallback for union types or invalid targets
    const fallbackEntity = {} as QueryableEntity;
    if (navigation.collection) {
      return new CollectionOperation(this.#schema, fallbackEntity, newPath, this.#options) as any;
    } else {
      return new SingleOperation(this.#schema, fallbackEntity, newPath, this.#options) as any;
    }
  }

  /**
   * Execute a bound action on the entity.
   */
  async action<
    K extends keyof NonNullable<S['actions']>
  >(
    name: K,
    payload: { parameters: OperationParameters<S, NonNullable<S['actions']>[K]['parameters']> }
  ): Promise<ActionResponse<S, NonNullable<S['actions']>[K]['returnType']>> {
    // TODO: Implement bound action execution - filter by target and scope at runtime
    throw new Error('Not implemented');
  }

  /**
   * Execute a bound function on the entity.
   */
  async function<
    K extends keyof NonNullable<S['functions']>
  >(
    name: K,
    payload: { parameters: OperationParameters<S, NonNullable<S['functions']>[K]['parameters']> }
  ): Promise<FunctionResponse<S, NonNullable<S['functions']>[K]['returnType']>> {
    // TODO: Implement bound function execution - filter by target and scope at runtime
    throw new Error('Not implemented');
  }
}
