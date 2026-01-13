import type {
  CreateObject,
  CreateOperationOptions,
  CreateResult,
  CreateResponse,
  QueryableEntity,
  CollectionQueryObject,
  SingleQueryObject,
  CollectionQueryResult,
  CollectionQueryResponse,
  SingleQueryResult,
  SingleQueryResponse,
  ResolvedSchema,
  UpdateObject,
  UpdateResult,
  UpdateResponse,
  UpdateOperationOptions,
  DeleteResponse,
  QueryOperationOptions,
  OperationParameters,
  ResolveReturnType,
  ActionResponse,
  FunctionResponse,
  ActionKeysByScope,
  FunctionKeysByScope,
} from './schema';
import {
  buildQueryRequest,
  buildCreateRequest,
  buildUpdateRequest,
  buildActionRequest,
  buildFunctionRequest,
  splitResponse,
  normalizePath,
} from './serialization';
import { executeBatch, type BatchBuilder, type BatchResult } from './batch';

type EntitySetNames<S extends ResolvedSchema<any>> = keyof S['entitysets'];
type EntitySetByName<
  E extends EntitySetNames<S>,
  S extends ResolvedSchema<any>
> = S['entitysets'][E];

type Fetch = (input: RequestInfo, init?: RequestInit) => Promise<Response>;

export type OdataClientOptions = {
  baseUrl: string;
  transport: Fetch;
};

// ============================================================================
// Client Implementation
// ============================================================================

export class OdataClient<S extends ResolvedSchema<any>> {
  #schema: S;
  #options: OdataClientOptions;

  constructor(schema: S, options: OdataClientOptions) {
    this.#schema = schema;
    this.#options = options;
  }

  entitysets<E extends EntitySetNames<S>>(entityset: E) {
    const entity = this.#schema.entitysets[entityset] as EntitySetByName<E, S>;
    return new CollectionOperation(this.#schema, entity, String(entityset), this.#options);
  }

  /**
   * Execute an unbound global action.
   */
  async action<A extends keyof S['actions']>(
    name: A,
    payload: { parameters: OperationParameters<S, S['actions'][A]['parameters']> }
  ): Promise<ActionResponse<S, S['actions'][A]['returnType']>> {
    // Lookup parameter definitions from schema for serialization
    const actionDef = this.#schema.actions[name];
    const paramDefs = actionDef.parameters;
    const useSchemaFQN = actionDef.useSchemaFQN ?? true;

    const request = buildActionRequest(
      '',
      this.#schema.namespace,
      String(name),
      payload.parameters,
      paramDefs,
      this.#schema,
      this.#options.baseUrl,
      useSchemaFQN
    );
    const response = await this.#options.transport(request);

    if (!response.ok) {
      let error: any;
      try {
        error = await response.json();
      } catch {
        error = await response.text();
      }
      return {
        ok: false,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        result: { error },
      } as ActionResponse<S, S['actions'][A]['returnType']>;
    }

    if (response.status === 204) {
      return {
        ok: true,
        status: 204,
        statusText: response.statusText,
        headers: response.headers,
        result: {
          data: undefined,
        },
      } as ActionResponse<S, S['actions'][A]['returnType']>;
    }

    const json = await response.json();
    const { value, ...odataProps } = json;
    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      result: {
        data: value !== undefined ? value : json,
        ...odataProps,  // @odata.context, etc.
      },
    } as ActionResponse<S, S['actions'][A]['returnType']>;
  }

  /**
   * Execute an unbound global function.
   */
  async function<F extends keyof S['functions']>(
    name: F,
    payload: { parameters: OperationParameters<S, S['functions'][F]['parameters']> }
  ): Promise<FunctionResponse<S, S['functions'][F]['returnType']>> {
    const funcDef = this.#schema.functions[name];
    const useSchemaFQN = funcDef.useSchemaFQN ?? true;

    const request = buildFunctionRequest(
      '',
      this.#schema.namespace,
      String(name),
      payload.parameters,
      this.#options.baseUrl,
      useSchemaFQN
    );
    const response = await this.#options.transport(request);

    if (!response.ok) {
      let error: any;
      try {
        error = await response.json();
      } catch {
        error = await response.text();
      }
      return {
        ok: false,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        result: { error },
      } as FunctionResponse<S, S['functions'][F]['returnType']>;
    }

    const json = await response.json();
    const { value, ...odataProps } = json;
    if (value !== undefined) {
      return {
        ok: true,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        result: {
          data: value,
          ...odataProps,  // @odata.context, etc.
        },
      } as FunctionResponse<S, S['functions'][F]['returnType']>;
    }
    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      result: {
        data: json,
        ...odataProps,  // @odata.context, etc.
      },
    } as FunctionResponse<S, S['functions'][F]['returnType']>;
  }

  /**
   * Execute a batch request.
   */
  async batch<R extends Record<string, any>>(
    builder: (bb: BatchBuilder<S>) => R
  ): Promise<BatchResult<R>> {
    return executeBatch(this.#options, this.#schema, builder);
  }
}

class CollectionOperation<
  S extends ResolvedSchema<any>,
  QE extends QueryableEntity & { actions: any; functions: any }
> {
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

  async create<O extends CreateOperationOptions<QE>>(
    c: CreateObject<QE>,
    o?: O
  ): Promise<CreateResponse<QE, O>> {
    const request = buildCreateRequest(this.#path, c, o, this.#options.baseUrl, this.#entityset);
    const response = await this.#options.transport(request);

    if (!response.ok) {
      let error: any;
      try {
        error = await response.json();
      } catch {
        error = await response.text();
      }
      return {
        ok: false,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        result: { error },
      } as CreateResponse<QE, O>;
    }

    const shouldReturnData =
      o?.prefer?.return_representation === true ||
      (o?.select && Array.isArray(o.select) && o.select.length > 0);

    if (shouldReturnData && response.status !== 204) {
      const json = await response.json();
      const { data, ...odataProps } = splitResponse(json);
      return {
        ok: true,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        result: {
          data,
          ...odataProps,  // @odata.context, etc.
        },
      } as CreateResponse<QE, O>;
    } else {
      return {
        ok: true,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        result: {
          data: undefined,
        },
      } as CreateResponse<QE, O>;
    }
  }

  async query<Q extends CollectionQueryObject<QE>, O extends QueryOperationOptions>(
    q: Q,
    o?: O
  ): Promise<CollectionQueryResponse<QE, Q, O>> {
    const request = buildQueryRequest(this.#path, q, o, this.#options.baseUrl, this.#entityset);
    const response = await this.#options.transport(request);

    if (!response.ok) {
      let error: any;
      try {
        error = await response.json();
      } catch {
        error = await response.text();
      }
      return {
        ok: false,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        result: { error },
      } as CollectionQueryResponse<QE, Q, O>;
    }

    const json = await response.json();
    return this.#processCollectionResponse(response, json, q, o);
  }

  #processCollectionResponse<Q extends CollectionQueryObject<QE>, O extends QueryOperationOptions>(
    response: Response,
    json: any,
    q: Q,
    o?: O
  ): CollectionQueryResponse<QE, Q, O> {
    let data: any;
    let odataProps: any = {};
    if ('value' in json) {
      const { value, ...props } = json;
      data = value;
      odataProps = props;
    } else {
      data = json;
    }

    const result: CollectionQueryResponse<QE, Q, O> = {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      result: {
        data,
        ...odataProps,  // @odata.context, @odata.count, etc.
      },
    } as CollectionQueryResponse<QE, Q, O>;

    // FIX: Captured maxpagesize in a local variable to satisfy TypeScript compiler for closure use
    const maxpagesize = o?.prefer?.maxpagesize;
    if (maxpagesize) {
      result.next = async () => {
        if (json['@odata.nextLink']) {
          const nextUrl = json['@odata.nextLink'];
          const headers = new Headers({ Accept: 'application/json' });
          if (o?.headers) {
            for (const [key, value] of Object.entries(o.headers)) headers.set(key, value);
          }
          const preferParts: string[] = [`odata.maxpagesize=${maxpagesize}`];
          headers.set('Prefer', preferParts.join(','));
          const nextRequest = new Request(nextUrl, { method: 'GET', headers });
          const nextResponse = await this.#options.transport(nextRequest);

          if (!nextResponse.ok) {
            let error: any;
            try {
              error = await nextResponse.json();
            } catch {
              error = await nextResponse.text();
            }
            return {
              ok: false,
              status: nextResponse.status,
              statusText: nextResponse.statusText,
              headers: nextResponse.headers,
              result: { error },
            } as CollectionQueryResponse<QE, Q, O>;
          }

          const nextJson = await nextResponse.json();
          return this.#processCollectionResponse(nextResponse, nextJson, q, o);
        }
        return undefined;
      };
    }
    return result;
  }

  key(key: string) {
    const newPath = `${this.#path}(${key})`;
    return new SingleOperation(this.#schema, this.#entityset, newPath, this.#options);
  }

  // Bound Actions (Collection Scope)
  async action<K extends ActionKeysByScope<QE['actions'], 'collection'>>(
    name: K,
    payload: { parameters: OperationParameters<S, QE['actions'][K]['parameters']> }
  ): Promise<ActionResponse<S, QE['actions'][K]['returnType']>> {
    const actionDef = this.#entityset.actions[name];
    const paramDefs = actionDef.parameters;
    const useSchemaFQN = actionDef.useSchemaFQN ?? true;

    const request = buildActionRequest(
      this.#path,
      this.#schema.namespace,
      String(name),
      payload.parameters,
      paramDefs,
      this.#schema,
      this.#options.baseUrl,
      useSchemaFQN
    );
    const response = await this.#options.transport(request);

    if (!response.ok) {
      let error: any;
      try {
        error = await response.json();
      } catch {
        error = await response.text();
      }
      return {
        ok: false,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        result: { error },
      } as ActionResponse<S, QE['actions'][K]['returnType']>;
    }

    if (response.status === 204) {
      return {
        ok: true,
        status: 204,
        statusText: response.statusText,
        headers: response.headers,
        result: {
          data: undefined,
        },
      } as ActionResponse<S, QE['actions'][K]['returnType']>;
    }

    const json = await response.json();
    const { value, ...odataProps } = json;
    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      result: {
        data: value !== undefined ? value : json,
        ...odataProps,  // @odata.context, etc.
      },
    } as ActionResponse<S, QE['actions'][K]['returnType']>;
  }

  // Bound Functions (Collection Scope)
  async function<K extends FunctionKeysByScope<QE['functions'], 'collection'>>(
    name: K,
    payload: { parameters: OperationParameters<S, QE['functions'][K]['parameters']> }
  ): Promise<FunctionResponse<S, QE['functions'][K]['returnType']>> {
    const funcDef = this.#entityset.functions[name];
    const useSchemaFQN = funcDef.useSchemaFQN ?? true;

    const request = buildFunctionRequest(
      this.#path,
      this.#schema.namespace,
      String(name),
      payload.parameters,
      this.#options.baseUrl,
      useSchemaFQN
    );
    const response = await this.#options.transport(request);

    if (!response.ok) {
      let error: any;
      try {
        error = await response.json();
      } catch {
        error = await response.text();
      }
      return {
        ok: false,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        result: { error },
      } as FunctionResponse<S, QE['functions'][K]['returnType']>;
    }

    const json = await response.json();
    const { value, ...odataProps } = json;
    if (value !== undefined) {
      return {
        ok: true,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        result: {
          data: value,
          ...odataProps,  // @odata.context, etc.
        },
      } as FunctionResponse<S, QE['functions'][K]['returnType']>;
    }
    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      result: {
        data: json,
        ...odataProps,  // @odata.context, etc.
      },
    } as FunctionResponse<S, QE['functions'][K]['returnType']>;
  }
}

class SingleOperation<
  S extends ResolvedSchema<any>,
  QE extends QueryableEntity & { actions: any; functions: any }
> {
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

  async query<Q extends SingleQueryObject<QE>, O extends QueryOperationOptions>(
    q: Q,
    o?: O
  ): Promise<SingleQueryResponse<QE, Q, O>> {
    const request = buildQueryRequest(this.#path, q, o, this.#options.baseUrl, this.#entityset);
    const response = await this.#options.transport(request);

    if (!response.ok) {
      let error: any;
      try {
        error = await response.json();
      } catch {
        error = await response.text();
      }
      return {
        ok: false,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        result: { error },
      } as SingleQueryResponse<QE, Q, O>;
    }

    const json = await response.json();
    const { data, ...odataProps } = splitResponse(json);
    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      result: {
        data,
        ...odataProps,  // @odata.context, etc.
      },
    } as SingleQueryResponse<QE, Q, O>;
  }

  navigate<N extends keyof QE['navigations'], Nav extends QE['navigations'][N]>(
    navigation_property: N
  ): QE['navigations'][N]['collection'] extends true
    ? CollectionOperation<S, QE['navigations'][N]['target'] & { actions: any; functions: any }>
    : SingleOperation<S, QE['navigations'][N]['target'] & { actions: any; functions: any }> {
    const navigation = this.#entityset['navigations'][navigation_property] as any;
    const target = navigation.target;
    // Normalize path: remove trailing slash from #path, add single /, then navigation property
    const newPath = this.#path.endsWith('/')
      ? `${this.#path.slice(0, -1)}/${String(navigation_property)}`
      : `${this.#path}/${String(navigation_property)}`;

    if (navigation.collection) {
      return new CollectionOperation(this.#schema, target, newPath, this.#options) as any;
    } else {
      return new SingleOperation(this.#schema, target, newPath, this.#options) as any;
    }
  }

  async update<O extends UpdateOperationOptions<QE>>(
    u: UpdateObject<QE>,
    o?: O
  ): Promise<UpdateResponse<QE, O>> {
    const request = buildUpdateRequest(this.#path, u, o, this.#options.baseUrl, this.#entityset);
    const response = await this.#options.transport(request);

    if (!response.ok) {
      let error: any;
      try {
        error = await response.json();
      } catch {
        error = await response.text();
      }
      return {
        ok: false,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        result: { error },
      } as UpdateResponse<QE, O>;
    }

    const shouldReturnData =
      o?.prefer?.return_representation === true ||
      (o?.select && Array.isArray(o.select) && o.select.length > 0);

    if (shouldReturnData && response.status !== 204) {
      const json = await response.json();
      const { data, ...odataProps } = splitResponse(json);
      return {
        ok: true,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        result: {
          data,
          ...odataProps,  // @odata.context, etc.
        },
      } as UpdateResponse<QE, O>;
    } else {
      return {
        ok: true,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        result: {
          data: undefined,
        },
      } as UpdateResponse<QE, O>;
    }
  }

  async delete(): Promise<DeleteResponse> {
    const url = normalizePath(this.#options.baseUrl, this.#path);
    const request = new Request(url, { method: 'DELETE', headers: { Accept: 'application/json' } });
    const response = await this.#options.transport(request);

    if (!response.ok) {
      let error: any;
      try {
        error = await response.json();
      } catch {
        error = await response.text();
      }
      return {
        ok: false,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        result: { error },
      };
    }

    // Delete operations typically return 204 No Content with no body
    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      result: {
        data: undefined,
      },
    };
  }

  // Bound Actions (Entity Scope)
  async action<K extends ActionKeysByScope<QE['actions'], 'entity'>>(
    name: K,
    payload: { parameters: OperationParameters<S, QE['actions'][K]['parameters']> }
  ): Promise<ActionResponse<S, QE['actions'][K]['returnType']>> {
    const actionDef = this.#entityset.actions[name];
    const paramDefs = actionDef.parameters;
    const useSchemaFQN = actionDef.useSchemaFQN ?? true;

    const request = buildActionRequest(
      this.#path,
      this.#schema.namespace,
      String(name),
      payload.parameters,
      paramDefs,
      this.#schema,
      this.#options.baseUrl,
      useSchemaFQN
    );
    const response = await this.#options.transport(request);

    if (!response.ok) {
      let error: any;
      try {
        error = await response.json();
      } catch {
        error = await response.text();
      }
      return {
        ok: false,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        result: { error },
      } as ActionResponse<S, QE['actions'][K]['returnType']>;
    }

    if (response.status === 204) {
      return {
        ok: true,
        status: 204,
        statusText: response.statusText,
        headers: response.headers,
        result: {
          data: undefined,
        },
      } as ActionResponse<S, QE['actions'][K]['returnType']>;
    }
    const json = await response.json();
    const { value, ...odataProps } = json;
    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      result: {
        data: value !== undefined ? value : json,
        ...odataProps,  // @odata.context, etc.
      },
    } as ActionResponse<S, QE['actions'][K]['returnType']>;
  }

  // Bound Functions (Entity Scope)
  async function<K extends FunctionKeysByScope<QE['functions'], 'entity'>>(
    name: K,
    payload: { parameters: OperationParameters<S, QE['functions'][K]['parameters']> }
  ): Promise<FunctionResponse<S, QE['functions'][K]['returnType']>> {
    const funcDef = this.#entityset.functions[name];
    const useSchemaFQN = funcDef.useSchemaFQN ?? true;

    const request = buildFunctionRequest(
      this.#path,
      this.#schema.namespace,
      String(name),
      payload.parameters,
      this.#options.baseUrl,
      useSchemaFQN
    );
    const response = await this.#options.transport(request);

    if (!response.ok) {
      let error: any;
      try {
        error = await response.json();
      } catch {
        error = await response.text();
      }
      return {
        ok: false,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        result: { error },
      } as FunctionResponse<S, QE['functions'][K]['returnType']>;
    }

    const json = await response.json();
    const { value, ...odataProps } = json;
    if (value !== undefined) {
      return {
        ok: true,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        result: {
          data: value,
          ...odataProps,  // @odata.context, etc.
        },
      } as FunctionResponse<S, QE['functions'][K]['returnType']>;
    }
    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      result: {
        data: json,
        ...odataProps,  // @odata.context, etc.
      },
    } as FunctionResponse<S, QE['functions'][K]['returnType']>;
  }
}
