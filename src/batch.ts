// ============================================================================
// OData $batch support
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
import type {
  CollectionQueryObject,
  SingleQueryObject,
  QueryOperationOptions,
} from './query';
import {
  buildQueryString,
  buildCreateRequest,
  buildUpdateRequest,
  buildActionRequest,
  buildFunctionRequest,
  normalizePath,
} from './serialization.js';
import type {
  CreateObject,
  UpdateObject,
  CreateOperationOptions,
  UpdateOperationOptions,
  OperationParameters,
} from './operations';
import type {
  CollectionQueryResponse,
  SingleQueryResponse,
  CreateResponse,
  UpdateResponse,
  DeleteResponse,
  ActionResponse,
  FunctionResponse,
} from './response';
import { buildQueryableEntity } from './runtime.js';

// ============================================================================
// Internal types
// ============================================================================

type Fetch = (input: Request, init?: RequestInit) => Promise<Response>;

export type OdataBatchClientOptions = {
  baseUrl: string;
  transport: Fetch;
};

type EntitySetNames<S extends Schema<S>> = keyof S['entitysets'];

type EntitySetToQE<
  S extends Schema<S>,
  ES extends EntitySetNames<S>
> = EntitySetToQueryableEntity<S, ES>;

type BatchRequestKind =
  | 'query-collection'
  | 'query-single'
  | 'create'
  | 'update'
  | 'delete'
  | 'action-unbound'
  | 'action-bound-collection'
  | 'action-bound-entity'
  | 'function-unbound'
  | 'function-bound-collection'
  | 'function-bound-entity';

type BatchRequest = {
  id: number;
  kind: BatchRequestKind;
  request: Request;
  inChangeset: boolean;
};

// ============================================================================
// Batch Builder
// ============================================================================

export class OdataBatch<S extends Schema<S>> {
  #schema: S;
  #options: OdataBatchClientOptions;
  #requests: BatchRequest[] = [];
  #nextId = 1;

  constructor(schema: S, options: OdataBatchClientOptions) {
    this.#schema = schema;
    this.#options = options;
  }

  /**
   * Access an entityset within this batch.
   */
  entitysets<E extends EntitySetNames<S>>(entityset: E): BatchCollectionOperation<S, EntitySetToQE<S, E>, E> {
    const entity = buildQueryableEntity(this.#schema, String(entityset)) as EntitySetToQE<S, E>;
    return new BatchCollectionOperation(this, this.#schema, entity, entityset, String(entityset), this.#options.baseUrl);
  }

  /**
   * Execute an unbound global action in the batch (always in a changeset).
   */
  action<
    A extends ImportedActionKeys<S>
  >(
    name: A,
    payload: {
      parameters: OperationParameters<
        S,
        NonNullable<S['actions']>[ResolveActionFromImport<S, A>]['parameters']
      >
    }
  ): number {
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
      String(name),
      payload.parameters,
      parameterDefs,
      this.#schema,
      this.#options.baseUrl,
      false
    );

    return this.addRequest('action-unbound', request, true);
  }

  /**
   * Execute an unbound global function in the batch (never in a changeset).
   */
  function<
    F extends ImportedFunctionKeys<S>
  >(
    name: F,
    payload: {
      parameters: OperationParameters<
        S,
        NonNullable<S['functions']>[ResolveFunctionFromImport<S, F>]['parameters']
      >
    }
  ): number {
    type FunctionName = ResolveFunctionFromImport<S, F>;
    const functionName = (this.#schema.functionImports?.[name as string] as { function: string })?.function as string;

    if (!functionName || !this.#schema.functions || !(functionName in this.#schema.functions)) {
      throw new Error(`Function '${String(name)}' not found`);
    }

    const namespace = this.#schema.namespace || '';

    const request = buildFunctionRequest(
      '',
      namespace,
      String(name),
      payload.parameters,
      this.#options.baseUrl,
      false
    );

    return this.addRequest('function-unbound', request, false);
  }

  /**
   * Add a prepared request to the batch.
   */
  private addRequest(kind: BatchRequestKind, request: Request, inChangeset: boolean): number {
    const id = this.#nextId++;
    this.#requests.push({ id, kind, request, inChangeset });
    return id;
  }

  /** @internal Used by operation builders to register requests. */
  addCollectionQuery<QE extends QueryableEntity>(request: Request): number {
    return this.addRequest('query-collection', request, false);
  }

  /** @internal */
  addSingleQuery<QE extends QueryableEntity>(request: Request): number {
    return this.addRequest('query-single', request, false);
  }

  /** @internal */
  addCreate<QE extends QueryableEntity>(request: Request): number {
    return this.addRequest('create', request, true);
  }

  /** @internal */
  addUpdate<QE extends QueryableEntity>(request: Request): number {
    return this.addRequest('update', request, true);
  }

  /** @internal */
  addDelete(request: Request): number {
    return this.addRequest('delete', request, true);
  }

  /** @internal */
  addBoundCollectionAction(request: Request): number {
    return this.addRequest('action-bound-collection', request, true);
  }

  /** @internal */
  addBoundEntityAction(request: Request): number {
    return this.addRequest('action-bound-entity', request, true);
  }

  /** @internal */
  addBoundCollectionFunction(request: Request): number {
    return this.addRequest('function-bound-collection', request, false);
  }

  /** @internal */
  addBoundEntityFunction(request: Request): number {
    return this.addRequest('function-bound-entity', request, false);
  }

  /**
   * Build the HTTP Request representing this $batch.
   *
   * This does not execute the request itself.
   */
  async buildRequest(): Promise<Request> {
    const batchBoundary = `batch_${Math.random().toString(36).slice(2)}`;
    const lines: string[] = [];

    // Use full pathname so the batch request line is e.g. "POST /api/data/v9.0/emails HTTP/1.1".
    // Dynamics (and some other OData services) resolve relative URLs in batch from the host root,
    // so a path relative to the service root (e.g. "/emails") would become https://host/emails and 404.
    const toRelativePath = (url: string): string => {
      const fullUrl = new URL(url);
      const path = fullUrl.pathname.replace(/\/+$/, '') || '/';
      return path + fullUrl.search;
    };

    const pushPartForRequest = (req: BatchRequest, bodyText: string, contentId?: number) => {
      lines.push(`Content-Type: application/http`);
      lines.push(`Content-Transfer-Encoding: binary`);
      if (contentId != null) {
        lines.push(`Content-ID: ${contentId}`);
      }
      lines.push('');

      const method = req.request.method || 'GET';
      const relativeUrl = toRelativePath(req.request.url);
      lines.push(`${method} ${relativeUrl} HTTP/1.1`);

      req.request.headers.forEach((value: string, key: string) => {
        if (key.toLowerCase() === 'host') return;
        lines.push(`${key}: ${value}`);
      });
      lines.push('');

      if (bodyText) {
        lines.push(bodyText);
      }
    };

    lines.push(`--${batchBoundary}`);

    let currentChangesetBoundary: string | null = null;
    let currentChangesetHasOperations = false;
    let currentContentId = 1;

    const flushChangeset = () => {
      if (currentChangesetBoundary && currentChangesetHasOperations) {
        lines.push(`--${currentChangesetBoundary}--`);
        lines.push(`--${batchBoundary}`);
      }
      currentChangesetBoundary = null;
      currentChangesetHasOperations = false;
      currentContentId = 1;
    };

    for (const req of this.#requests) {
      const bodyText = req.request.body ? await req.request.clone().text() : '';

      if (req.inChangeset) {
        if (!currentChangesetBoundary) {
          currentChangesetBoundary = `changeset_${Math.random().toString(36).slice(2)}`;
          lines.push(`Content-Type: multipart/mixed; boundary=${currentChangesetBoundary}`);
          lines.push('');
        }
        lines.push(`--${currentChangesetBoundary}`);
        pushPartForRequest(req, bodyText, currentContentId++);
        currentChangesetHasOperations = true;
      } else {
        flushChangeset();
        pushPartForRequest(req, bodyText);
        lines.push(`--${batchBoundary}`);
      }
    }

    flushChangeset();
    lines[lines.length - 1] = `--${batchBoundary}--`;

    const body = lines.join('\r\n');

    const url = normalizePath(this.#options.baseUrl, '$batch');
    const headers = new Headers({
      'Content-Type': `multipart/mixed; boundary=${batchBoundary}`,
    });

    return new Request(url, {
      method: 'POST',
      headers,
      body,
    });
  }

  /**
   * Build the batch request and send it via the configured transport.
   */
  async execute(): Promise<Response> {
    const request = await this.buildRequest();
    return this.#options.transport(request);
  }
}

/**
 * Public API type for OdataBatch. Use this when typing batch variables.
 * Excludes internal request-registry methods used by operation builders.
 */
export type OdataBatchPublic<S extends Schema<S>> = Pick<
  OdataBatch<S>,
  'entitysets' | 'action' | 'function' | 'buildRequest' | 'execute'
>;

// ============================================================================
// Batch Collection & Single Operations
// ============================================================================

class BatchCollectionOperation<
  S extends Schema<S>,
  QE extends QueryableEntity,
  E extends EntitySetNames<S> = EntitySetNames<S>
> {
  #batch: OdataBatch<S>;
  #schema: S;
  #entityset: QE;
  #entitysetName: E;
  #path: string;
  #baseUrl: string;

  constructor(
    batch: OdataBatch<S>,
    schema: S,
    entityset: QE,
    entitysetName: E,
    path: string,
    baseUrl: string
  ) {
    this.#batch = batch;
    this.#schema = schema;
    this.#entityset = entityset;
    this.#entitysetName = entitysetName;
    this.#path = path;
    this.#baseUrl = baseUrl;
  }

  query<Q extends CollectionQueryObject<QE, S>, O extends QueryOperationOptions>(
    q: Q,
    _o?: O
  ): number {
    const queryString = buildQueryString(q as any, this.#entityset, this.#schema);
    const url = normalizePath(this.#baseUrl, this.#path + queryString);
    const request = new Request(url, { method: 'GET' });
    return this.#batch.addCollectionQuery<QE>(request);
  }

  create<O extends CreateOperationOptions<QE>>(
    c: CreateObject<QE>,
    o?: O
  ): number {
    const request = buildCreateRequest(
      this.#path,
      c,
      o,
      this.#baseUrl,
      this.#entityset,
      this.#schema
    );
    return this.#batch.addCreate<QE>(request);
  }

  key(key: string): BatchSingleOperation<S, QE, E> {
    const newPath = `${this.#path}(${key})`;
    return new BatchSingleOperation(this.#batch, this.#schema, this.#entityset, this.#entitysetName, newPath, this.#baseUrl);
  }

  action<
    K extends BoundActionKeysForEntitySet<S, E, 'collection'>
  >(
    name: K,
    payload: { parameters: OperationParameters<S, NonNullable<S['actions']>[K]['parameters']> }
  ): number {
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
      String(name),
      payload.parameters,
      parameterDefs,
      this.#schema,
      this.#baseUrl,
      true
    );

    return this.#batch.addBoundCollectionAction(request);
  }

  function<
    K extends BoundFunctionKeysForEntitySet<S, E, 'collection'>
  >(
    name: K,
    payload: { parameters: OperationParameters<S, NonNullable<S['functions']>[K]['parameters']> }
  ): number {
    if (!this.#schema.functions || !(name in this.#schema.functions)) {
      throw new Error(`Function '${String(name)}' not found`);
    }

    const namespace = this.#schema.namespace || '';

    const request = buildFunctionRequest(
      this.#path,
      namespace,
      String(name),
      payload.parameters,
      this.#baseUrl,
      true
    );

    return this.#batch.addBoundCollectionFunction(request);
  }
}

class BatchSingleOperation<
  S extends Schema<S>,
  QE extends QueryableEntity,
  E extends EntitySetNames<S> = EntitySetNames<S>
> {
  #batch: OdataBatch<S>;
  #schema: S;
  #entityset: QE;
  #entitysetName: E;
  #path: string;
  #baseUrl: string;

  constructor(
    batch: OdataBatch<S>,
    schema: S,
    entityset: QE,
    entitysetName: E,
    path: string,
    baseUrl: string
  ) {
    this.#batch = batch;
    this.#schema = schema;
    this.#entityset = entityset;
    this.#entitysetName = entitysetName;
    this.#path = path;
    this.#baseUrl = baseUrl;
  }

  query<Q extends SingleQueryObject<QE, S>, O extends QueryOperationOptions>(
    q: Q,
    _o?: O
  ): number {
    const queryString = buildQueryString(q as any, this.#entityset, this.#schema);
    const url = normalizePath(this.#baseUrl, this.#path + queryString);
    const request = new Request(url, { method: 'GET' });
    return this.#batch.addSingleQuery<QE>(request);
  }

  update<O extends UpdateOperationOptions<QE>>(
    u: UpdateObject<QE>,
    o?: O
  ): number {
    const request = buildUpdateRequest(
      this.#path,
      u,
      o,
      this.#baseUrl,
      this.#entityset,
      this.#schema
    );
    return this.#batch.addUpdate<QE>(request);
  }

  delete(): number {
    const url = normalizePath(this.#baseUrl, this.#path);
    const request = new Request(url, { method: 'DELETE' });
    return this.#batch.addDelete(request);
  }

  navigate<N extends keyof QE['navigations']>(
    navigation_property: N
  ): QE['navigations'][N]['targetEntitysetKey'] extends string
    ? QE['navigations'][N]['collection'] extends true
      ? BatchCollectionOperation<S, ResolveEntitySet<S, QE['navigations'][N]['targetEntitysetKey']>>
      : BatchSingleOperation<S, ResolveEntitySet<S, QE['navigations'][N]['targetEntitysetKey']>>
    : QE['navigations'][N]['collection'] extends true
    ? BatchCollectionOperation<S, QueryableEntity>
    : BatchSingleOperation<S, QueryableEntity> {
    const navigation = this.#entityset.navigations[navigation_property as string];
    if (!navigation) {
      throw new Error(`Navigation property '${String(navigation_property)}' not found`);
    }

    const targetEntitysetKey = navigation.targetEntitysetKey;
    const newPath = `${this.#path}/${String(navigation_property)}`;

    const actualTargetKey = typeof targetEntitysetKey === 'string'
      ? targetEntitysetKey
      : Array.isArray(targetEntitysetKey) && targetEntitysetKey.length > 0
      ? targetEntitysetKey[0]
      : '';

    if (actualTargetKey && actualTargetKey in this.#schema.entitysets) {
      const targetEntity = buildQueryableEntity(this.#schema, actualTargetKey) as ResolveEntitySet<S, typeof actualTargetKey>;
      if (navigation.collection) {
        return new BatchCollectionOperation(this.#batch, this.#schema, targetEntity, actualTargetKey as any, newPath, this.#baseUrl) as any;
      } else {
        return new BatchSingleOperation(this.#batch, this.#schema, targetEntity, actualTargetKey as any, newPath, this.#baseUrl) as any;
      }
    }

    const fallbackEntity = buildQueryableEntity(this.#schema, actualTargetKey || '');
    if (navigation.collection) {
      return new BatchCollectionOperation(this.#batch, this.#schema, fallbackEntity, actualTargetKey as any, newPath, this.#baseUrl) as any;
    } else {
      return new BatchSingleOperation(this.#batch, this.#schema, fallbackEntity, actualTargetKey as any, newPath, this.#baseUrl) as any;
    }
  }

  action<
    K extends BoundActionKeysForEntitySet<S, E, 'entity'>
  >(
    name: K,
    payload: { parameters: OperationParameters<S, NonNullable<S['actions']>[K]['parameters']> }
  ): number {
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
      String(name),
      payload.parameters,
      parameterDefs,
      this.#schema,
      this.#baseUrl,
      true
    );

    return this.#batch.addBoundEntityAction(request);
  }

  function<
    K extends BoundFunctionKeysForEntitySet<S, E, 'entity'>
  >(
    name: K,
    payload: { parameters: OperationParameters<S, NonNullable<S['functions']>[K]['parameters']> }
  ): number {
    if (!this.#schema.functions || !(name in this.#schema.functions)) {
      throw new Error(`Function '${String(name)}' not found`);
    }

    const namespace = this.#schema.namespace || '';

    const request = buildFunctionRequest(
      this.#path,
      namespace,
      String(name),
      payload.parameters,
      this.#baseUrl,
      true
    );

    return this.#batch.addBoundEntityFunction(request);
  }
}

