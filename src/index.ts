// ============================================================================
// OData Client Implementation
// ============================================================================

import type { Schema } from './schema';
import type {
  QueryableEntity,
  EntitySetToQueryableEntity,
  EntitySetToQueryableEntity as ResolveEntitySet,
  ImportedActionKeys,
  ImportedFunctionKeys,
  ResolveActionFromImport,
  ResolveFunctionFromImport,
  BoundActionKeysForEntitySet,
  BoundFunctionKeysForEntitySet,
} from './types';
import { buildQueryableEntity } from './runtime.js';
import { OdataBatch } from './batch.js';
import type { OdataBatchPublic, BatchExecuteResult, BatchItemResult } from './batch.js';

export { OdataBatch };
export type { OdataBatchPublic, BatchExecuteResult, BatchItemResult };
import type {
  CollectionQueryResponse,
  CollectionQueryResponseByResult,
  SingleQueryResponseByResult,
  ExtractQueryResultShape,
  Simplify,
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
import { buildQueryString, buildCreateRequest, buildUpdateRequest, buildActionRequest, buildFunctionRequest, normalizePath } from './serialization.js';
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

function headersFromQueryOptions(opts?: QueryOperationOptions): Headers | undefined {
  const hasHeaders = opts?.prefer?.maxpagesize != null || (opts?.headers && Object.keys(opts.headers).length > 0);
  if (!hasHeaders) {
    return undefined;
  }
  const headers = new Headers();
  if (opts?.prefer?.maxpagesize != null) {
    headers.set('Prefer', `odata.maxpagesize=${opts.prefer.maxpagesize}`);
  }
  if (opts?.headers) {
    for (const [key, value] of Object.entries(opts.headers)) {
      headers.set(key, value);
    }
  }
  return headers;
}

async function readErrorBody(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return await response.text();
  }
}

async function readJsonBody(response: Response, emptyOn304 = false): Promise<any> {
  if (response.status === 204 || (emptyOn304 && response.status === 304)) {
    return {};
  }
  return response.json();
}

function httpResult<T>(response: Response, result: T, ok = response.ok) {
  return {
    ok,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    result,
  };
}

async function sendOperation<T>(transport: Fetch, request: Request, emptyOn304 = false): Promise<T> {
  const response = await transport(request);
  if (!response.ok) {
    return httpResult(response, { error: await readErrorBody(response) }, false) as T;
  }
  return httpResult(response, await readJsonBody(response, emptyOn304), true) as T;
}

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
  entitysets<E extends EntitySetNames<S>>(entityset: E): CollectionOperation<S, EntitySetToQE<S, E>, E> {
    const entity = buildQueryableEntity(this.#schema, String(entityset)) as EntitySetToQE<S, E>;
    return new CollectionOperation(this.#schema, entity, entityset, String(entityset), this.#options);
  }

  /**
   * Execute an unbound global action.
   */
  async action<
    A extends ImportedActionKeys<S>
  >(
    name: A,
    payload: { 
      parameters: OperationParameters<
        S, 
        NonNullable<S['actions']>[ResolveActionFromImport<S, A>]['parameters']
      >
    }
  ): Promise<ActionResponse<
    S, 
    NonNullable<S['actions']>[ResolveActionFromImport<S, A>]['returnType']
  >> {
    // Resolve import name to action name
    type ActionName = ResolveActionFromImport<S, A>;
    const actionName = (this.#schema.actionImports?.[name as string] as { action: string })?.action as string;
    
    if (!actionName || !this.#schema.actions || !(actionName in this.#schema.actions)) {
      throw new Error(`Action '${String(name)}' not found`);
    }
    
    const actionDef = this.#schema.actions![actionName]!;
    const parameterDefs = actionDef.parameters;
    const namespace = this.#schema.namespace || '';

    const request = buildActionRequest(
      '',
      namespace,
      String(name), // Use import name, not resolved action name
      payload.parameters,
      parameterDefs,
      this.#schema,
      this.#options.baseUrl,
      false // Unbound actions use import name, not FQN
    );
    
    return sendOperation<ActionResponse<S, NonNullable<S['actions']>[ActionName]['returnType']>>(
      this.#options.transport,
      request
    );
  }

  /**
   * Execute an unbound global function.
   */
  async function<
    F extends ImportedFunctionKeys<S>
  >(
    name: F,
    payload: { 
      parameters: OperationParameters<
        S, 
        NonNullable<S['functions']>[ResolveFunctionFromImport<S, F>]['parameters']
      >
    }
  ): Promise<FunctionResponse<
    S, 
    NonNullable<S['functions']>[ResolveFunctionFromImport<S, F>]['returnType']
  >> {
    // Resolve import name to function name
    type FunctionName = ResolveFunctionFromImport<S, F>;
    const functionName = (this.#schema.functionImports?.[name as string] as { function: string })?.function as string;
    
    if (!functionName || !this.#schema.functions || !(functionName in this.#schema.functions)) {
      throw new Error(`Function '${String(name)}' not found`);
    }
    
    const namespace = this.#schema.namespace || '';

    const request = buildFunctionRequest(
      '',
      namespace,
      String(name), // Use import name, not resolved function name
      payload.parameters,
      this.#options.baseUrl,
      false // Unbound functions use import name, not FQN
    );
    
    return sendOperation<FunctionResponse<S, NonNullable<S['functions']>[FunctionName]['returnType']>>(
      this.#options.transport,
      request
    );
  }

  /**
   * Create a new batch builder.
   *
   * The returned batch can be used with the same fluent API surface as the
   * regular client, but operations are queued into a $batch request instead
   * of being executed immediately.
   */
  batch(): OdataBatchPublic<S> {
    return new OdataBatch(this.#schema, {
      baseUrl: this.#options.baseUrl,
      transport: this.#options.transport,
    });
  }
}

// Build collection query response and attach next() when result has @odata.nextLink. Options can be passed to next() (e.g. prefer.maxpagesize) for subsequent requests.
function buildCollectionQueryResponse<
  QE extends QueryableEntity,
  Q extends CollectionQueryObject<QE, any>,
  O extends QueryOperationOptions | undefined,
  S extends Schema<S>
>(
  res: Response,
  data: any,
  transport: Fetch,
  o?: O
): CollectionQueryResponse<QE, Q, O, S> {
  const out: CollectionQueryResponse<QE, Q, O, S> = {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
    result: data,
  } as CollectionQueryResponse<QE, Q, O, S>;
  if (out.ok && data?.['@odata.nextLink']) {
    const nextFn = async (nextOpts?: QueryOperationOptions) => {
      const opts = nextOpts ?? o;
      const headers = headersFromQueryOptions(opts);
      const nextRequest = new Request(data['@odata.nextLink'], headers ? { headers } : undefined);
      const nextRes = await transport(nextRequest);
      const nextData = await readJsonBody(nextRes, true);
      return buildCollectionQueryResponse<QE, Q, O, S>(nextRes, nextData, transport, opts as O);
    };
    (out as { next: (options?: QueryOperationOptions) => Promise<CollectionQueryResponse<QE, Q, O, S>> }).next = nextFn;
  }
  return out;
}

// ============================================================================
// CollectionOperation
// ============================================================================

class CollectionOperation<S extends Schema<S>, QE extends QueryableEntity, E extends EntitySetNames<S> = EntitySetNames<S>> {
  #schema: S;
  #entityset: QE;
  #entitysetName: E;
  #path: string;
  #options: OdataClientOptions;

  constructor(schema: S, entityset: QE, entitysetName: E, path: string, options: OdataClientOptions) {
    this.#schema = schema;
    this.#entityset = entityset;
    this.#entitysetName = entitysetName;
    this.#path = path;
    this.#options = options;
  }

  /**
   * Query a collection of entities.
   */
  async query<Q extends CollectionQueryObject<QE, S>, O extends QueryOperationOptions>(
    q: Q,
    o?: O
  ): Promise<CollectionQueryResponseByResult<Simplify<ExtractQueryResultShape<QE, Q, S>>, O>> {
    const queryString = buildQueryString(q as any, this.#entityset, this.#schema);
    const url = normalizePath(this.#options.baseUrl, this.#path + queryString);
    const headers = headersFromQueryOptions(o);
    const request = new Request(url, headers ? { headers } : undefined);
    const response = await this.#options.transport(request);
    const data = await readJsonBody(response, true);
    return buildCollectionQueryResponse<QE, Q, O, S>(response, data, this.#options.transport, o) as CollectionQueryResponseByResult<Simplify<ExtractQueryResultShape<QE, Q, S>>, O>;
  }

  /**
   * Create a new entity.
   */
  async create<O extends CreateOperationOptions<QE>>(
    c: CreateObject<QE>,
    o?: O
  ): Promise<CreateResponse<QE, O>> {
    const request = buildCreateRequest(
      this.#path,
      c,
      o,
      this.#options.baseUrl,
      this.#entityset,
      this.#schema
    );
    const response = await this.#options.transport(request);
    const data = await readJsonBody(response);
    
    return httpResult(response, data) as CreateResponse<QE, O>;
  }

  /**
   * Access a single entity by key.
   */
  key(key: string): SingleOperation<S, QE, E> {
    const newPath = `${this.#path}(${key})`;
    return new SingleOperation(this.#schema, this.#entityset, this.#entitysetName, newPath, this.#options);
  }

  /**
   * Execute a bound action on the collection.
   */
  async action<
    K extends BoundActionKeysForEntitySet<S, E, 'collection'>
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
    K extends BoundFunctionKeysForEntitySet<S, E, 'collection'>
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

class SingleOperation<S extends Schema<S>, QE extends QueryableEntity, E extends EntitySetNames<S> = EntitySetNames<S>> {
  #schema: S;
  #entityset: QE;
  #entitysetName: E;
  #path: string;
  #options: OdataClientOptions;

  constructor(schema: S, entityset: QE, entitysetName: E, path: string, options: OdataClientOptions) {
    this.#schema = schema;
    this.#entityset = entityset;
    this.#entitysetName = entitysetName;
    this.#path = path;
    this.#options = options;
  }

  /**
   * Query a single entity.
   */
  async query<Q extends SingleQueryObject<QE, S>, O extends QueryOperationOptions>(
    q: Q,
    o?: O
  ): Promise<SingleQueryResponseByResult<Simplify<ExtractQueryResultShape<QE, Q, S>>>> {
    const queryString = buildQueryString(q as any, this.#entityset, this.#schema);
    const url = normalizePath(this.#options.baseUrl, this.#path + queryString);
    const request = new Request(url);
    const response = await this.#options.transport(request);
    const data = await readJsonBody(response, true);
    
    return httpResult(response, data) as SingleQueryResponseByResult<Simplify<ExtractQueryResultShape<QE, Q, S>>>;
  }

  /**
   * Update an entity.
   */
  async update<O extends UpdateOperationOptions<QE>>(
    u: UpdateObject<QE>,
    o?: O
  ): Promise<UpdateResponse<QE, O>> {
    const request = buildUpdateRequest(
      this.#path,
      u,
      o,
      this.#options.baseUrl,
      this.#entityset,
      this.#schema
    );
    const response = await this.#options.transport(request);
    const data = await readJsonBody(response);
    
    return httpResult(response, data) as UpdateResponse<QE, O>;
  }

  /**
   * Delete an entity.
   */
  async delete(): Promise<DeleteResponse> {
    const url = normalizePath(this.#options.baseUrl, this.#path);
    const request = new Request(url, { method: 'DELETE' });
    return sendOperation<DeleteResponse>(this.#options.transport, request, true);
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
    const actualTargetKey = typeof targetEntitysetKey === 'string' 
      ? targetEntitysetKey 
      : Array.isArray(targetEntitysetKey) && targetEntitysetKey.length > 0
      ? targetEntitysetKey[0]
      : '';
    
    if (actualTargetKey && actualTargetKey in this.#schema.entitysets) {
      const targetEntity = buildQueryableEntity(this.#schema, actualTargetKey) as ResolveEntitySet<S, typeof actualTargetKey>;
      if (navigation.collection) {
        return new CollectionOperation(this.#schema, targetEntity, actualTargetKey as any, newPath, this.#options) as any;
      } else {
        return new SingleOperation(this.#schema, targetEntity, actualTargetKey as any, newPath, this.#options) as any;
      }
    }
    
    // Fallback for union types or invalid targets
    const fallbackEntity = buildQueryableEntity(this.#schema, actualTargetKey || '');
    if (navigation.collection) {
      return new CollectionOperation(this.#schema, fallbackEntity, actualTargetKey as any, newPath, this.#options) as any;
    } else {
      return new SingleOperation(this.#schema, fallbackEntity, actualTargetKey as any, newPath, this.#options) as any;
    }
  }

  /**
   * Execute a bound action on the entity.
   */
  async action<
    K extends BoundActionKeysForEntitySet<S, E, 'entity'>
  >(
    name: K,
    payload: { parameters: OperationParameters<S, NonNullable<S['actions']>[K]['parameters']> }
  ): Promise<ActionResponse<S, NonNullable<S['actions']>[K]['returnType']>> {
    if (!this.#schema.actions || !(name in this.#schema.actions)) {
      throw new Error(`Action '${String(name)}' not found`);
    }
    
    const actions = this.#schema.actions!;
    const actionDef = actions[name as string]!;
    const parameterDefs = actionDef.parameters;
    const namespace = this.#schema.namespace || '';

    const request = buildActionRequest(
      this.#path,
      namespace,
      String(name), // Use action name, not import name
      payload.parameters,
      parameterDefs,
      this.#schema,
      this.#options.baseUrl,
      true // Bound actions always use FQN
    );
    
    return sendOperation<ActionResponse<S, NonNullable<S['actions']>[K]['returnType']>>(
      this.#options.transport,
      request
    );
  }

  /**
   * Execute a bound function on the entity.
   */
  async function<
    K extends BoundFunctionKeysForEntitySet<S, E, 'entity'>
  >(
    name: K,
    payload: { parameters: OperationParameters<S, NonNullable<S['functions']>[K]['parameters']> }
  ): Promise<FunctionResponse<S, NonNullable<S['functions']>[K]['returnType']>> {
    if (!this.#schema.functions || !(name in this.#schema.functions)) {
      throw new Error(`Function '${String(name)}' not found`);
    }
    
    const namespace = this.#schema.namespace || '';

    const request = buildFunctionRequest(
      this.#path,
      namespace,
      String(name), // Use function name, not import name
      payload.parameters,
      this.#options.baseUrl,
      true // Bound functions always use FQN
    );
    
    return sendOperation<FunctionResponse<S, NonNullable<S['functions']>[K]['returnType']>>(
      this.#options.transport,
      request
    );
  }
}
