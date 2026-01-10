import type {
  ResolvedSchema,
  QueryableEntity,
  CreateObject,
  CreateOperationOptions,
  CreateResult,
  CreateResponse,
  UpdateObject,
  UpdateOperationOptions,
  UpdateResult,
  UpdateResponse,
  DeleteResponse,
  CollectionQueryObject,
  QueryOperationOptions,
  CollectionQueryResult,
  CollectionQueryResponse,
  SingleQueryObject,
  SingleQueryResult,
  SingleQueryResponse,
  ActionKeysByScope,
  OperationParameters,
  ResolveReturnType,
  ActionResponse,
  FunctionKeysByScope,
  FunctionResponse,
  ODataError,
} from './schema';
import {
  buildCreateRequest,
  buildUpdateRequest,
  buildQueryRequest,
  buildActionRequest,
  buildFunctionRequest,
  splitResponse,
  normalizePath,
} from './serialization';
import type { OdataClientOptions } from '.';

// ============================================================================
// Types
// ============================================================================

export type BatchOperation<R> = {
  type: 'query' | 'mutation';
  request: Request;
  handler: (response: Response) => Promise<R>;
  contentId?: string;
};

// Capture the specific tuple type of operations
export type BatchChangeset<Ops extends readonly BatchOperation<any>[]> = {
  operations: Ops;
};

type BatchItem =
  | BatchOperation<any>
  | BatchChangeset<any>
  | Array<BatchOperation<any> | BatchChangeset<any>>;

// Helper to extract the result type from an operation
type UnwrapOp<T> = T extends BatchOperation<infer R> ? R : never;

// Helper to extract the result tuple from a changeset
type UnwrapChangeset<T> = T extends BatchChangeset<infer Ops>
  ?
      | {
          ok: true;
          operations: { -readonly [P in keyof Ops]: UnwrapOp<Ops[P]> }[number][];
        }
      | {
          ok: false;
          error: { -readonly [P in keyof Ops]: UnwrapOp<Ops[P]> }[number];
        }
  : never;

// Recursive result mapper
// Returns the full ODataResponse (not just the result) to preserve discriminated union
export type BatchResult<T> = {
  [K in keyof T]: T[K] extends BatchOperation<infer R> // Case 1: It's a single Operation
    ? R // Return full response (preserves discriminated union)
    : // Case 2: It's a single Changeset (Tuple preserved)
    T[K] extends BatchChangeset<infer Ops>
    ? UnwrapChangeset<T[K]>
    : // Case 3: It's an Array (e.g. data.map(...))
    T[K] extends Array<infer Item>
    ? Item extends BatchChangeset<any>
      ? UnwrapChangeset<Item>[] // Array of Changesets
      : Item extends BatchOperation<infer R>
      ? R[] // Array of Operations, return full response
      : never
    : never;
};

// ============================================================================
// Batch Operations
// ============================================================================

class BatchCollectionOperation<
  S extends ResolvedSchema<any>,
  QE extends QueryableEntity & { actions: any; functions: any }
> {
  #schema: S;
  #entityset: QE;
  #path: string;
  #baseUrl: string;

  constructor(schema: S, entityset: QE, path: string, baseUrl: string) {
    this.#schema = schema;
    this.#entityset = entityset;
    this.#path = path;
    this.#baseUrl = baseUrl;
  }

  create<O extends CreateOperationOptions<QE>>(
    c: CreateObject<QE>,
    o?: O & { contentId?: string }
  ): BatchOperation<CreateResponse<QE, O>> {
    const request = buildCreateRequest(this.#path, c, o, this.#baseUrl, this.#entityset);
    return {
      type: 'mutation',
      request,
      contentId: o?.contentId,
      handler: async (response) => {
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
              ...odataProps, // @odata.context, etc.
            },
          } as CreateResponse<QE, O>;
        }
        return {
          ok: true,
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          result: {
            data: undefined,
          },
        } as CreateResponse<QE, O>;
      },
    };
  }

  query<Q extends CollectionQueryObject<QE>, O extends QueryOperationOptions>(
    q: Q,
    o?: O
  ): BatchOperation<CollectionQueryResponse<QE, Q, O>> {
    const request = buildQueryRequest(this.#path, q, o, this.#baseUrl, this.#entityset);
    return {
      type: 'query',
      request,
      handler: async (response) => {
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
        let data: any;
        let odataProps: any = {};
        if ('value' in json) {
          const { value, ...props } = json;
          data = value;
          odataProps = props;
        } else {
          data = json;
        }
        return {
          ok: true,
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          result: {
            data,
            ...odataProps, // @odata.context, @odata.count, etc.
          },
        } as CollectionQueryResponse<QE, Q, O>;
      },
    };
  }

  key(key: string) {
    const newPath = `${this.#path}(${key})`;
    return new BatchSingleOperation(this.#schema, this.#entityset, newPath, this.#baseUrl);
  }

  // Bound Actions (Collection Scope)
  action<K extends ActionKeysByScope<QE['actions'], 'collection'>>(
    name: K,
    payload: { parameters: OperationParameters<S, QE['actions'][K]['parameters']> }
  ): BatchOperation<ActionResponse<S, QE['actions'][K]['returnType']>> {
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
      this.#baseUrl,
      useSchemaFQN
    );

    return {
      type: 'mutation',
      request,
      handler: async (response) => {
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
            ...odataProps, // @odata.context, etc.
          },
        } as ActionResponse<S, QE['actions'][K]['returnType']>;
      },
    };
  }

  // Bound Functions (Collection Scope)
  function<K extends FunctionKeysByScope<QE['functions'], 'collection'>>(
    name: K,
    payload: { parameters: OperationParameters<S, QE['functions'][K]['parameters']> }
  ): BatchOperation<FunctionResponse<S, QE['functions'][K]['returnType']>> {
    const funcDef = this.#entityset.functions[name];
    const useSchemaFQN = funcDef.useSchemaFQN ?? true;

    const request = buildFunctionRequest(
      this.#path,
      this.#schema.namespace,
      String(name),
      payload.parameters,
      this.#baseUrl,
      useSchemaFQN
    );

    return {
      type: 'query',
      request,
      handler: async (response) => {
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
              ...odataProps, // @odata.context, etc.
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
            ...odataProps, // @odata.context, etc.
          },
        } as FunctionResponse<S, QE['functions'][K]['returnType']>;
      },
    };
  }
}

class BatchSingleOperation<
  S extends ResolvedSchema<any>,
  QE extends QueryableEntity & { actions: any; functions: any }
> {
  #schema: S;
  #entityset: QE;
  #path: string;
  #baseUrl: string;

  constructor(schema: S, entityset: QE, path: string, baseUrl: string) {
    this.#schema = schema;
    this.#entityset = entityset;
    this.#path = path;
    this.#baseUrl = baseUrl;
  }

  query<Q extends SingleQueryObject<QE>, O extends QueryOperationOptions>(
    q: Q,
    o?: O
  ): BatchOperation<SingleQueryResponse<QE, Q, O>> {
    const request = buildQueryRequest(this.#path, q, o, this.#baseUrl, this.#entityset);
    return {
      type: 'query',
      request,
      handler: async (response) => {
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
            ...odataProps, // @odata.context, etc.
          },
        } as SingleQueryResponse<QE, Q, O>;
      },
    };
  }

  navigate<N extends keyof QE['navigations']>(
    navigation_property: N
  ): QE['navigations'][N]['collection'] extends true
    ? BatchCollectionOperation<S, QueryableEntity & { actions: any; functions: any }>
    : BatchSingleOperation<S, QueryableEntity & { actions: any; functions: any }> {
    const navigation = this.#entityset['navigations'][navigation_property] as any;
    const target = navigation.target as QueryableEntity & { actions: any; functions: any };
    // Normalize path: remove trailing slash from #path, add single /, then navigation property
    const newPath = this.#path.endsWith('/')
      ? `${this.#path.slice(0, -1)}/${String(navigation_property)}`
      : `${this.#path}/${String(navigation_property)}`;

    if (navigation.collection) {
      return new BatchCollectionOperation(this.#schema, target, newPath, this.#baseUrl) as any;
    } else {
      return new BatchSingleOperation(this.#schema, target, newPath, this.#baseUrl) as any;
    }
  }

  update<O extends UpdateOperationOptions<QE>>(
    u: UpdateObject<QE>,
    o?: O & { contentId?: string }
  ): BatchOperation<UpdateResponse<QE, O>> {
    const request = buildUpdateRequest(this.#path, u, o, this.#baseUrl, this.#entityset);
    return {
      type: 'mutation',
      request,
      contentId: o?.contentId,
      handler: async (response) => {
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
              ...odataProps, // @odata.context, etc.
            },
          } as UpdateResponse<QE, O>;
        }
        return {
          ok: true,
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          result: {
            data: undefined,
          },
        } as UpdateResponse<QE, O>;
      },
    };
  }

  delete(): BatchOperation<DeleteResponse> {
    const url = normalizePath(this.#baseUrl, this.#path);
    const request = new Request(url, { method: 'DELETE', headers: { Accept: 'application/json' } });
    return {
      type: 'mutation',
      request,
      handler: async (response) => {
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
          } as DeleteResponse;
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
        } as DeleteResponse;
      },
    };
  }

  // Bound Actions (Entity Scope)
  action<K extends ActionKeysByScope<QE['actions'], 'entity'>>(
    name: K,
    payload: { parameters: OperationParameters<S, QE['actions'][K]['parameters']> }
  ): BatchOperation<ActionResponse<S, QE['actions'][K]['returnType']>> {
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
      this.#baseUrl,
      useSchemaFQN
    );

    return {
      type: 'mutation',
      request,
      handler: async (response) => {
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
            ...odataProps, // @odata.context, etc.
          },
        } as ActionResponse<S, QE['actions'][K]['returnType']>;
      },
    };
  }

  // Bound Functions (Entity Scope)
  function<K extends FunctionKeysByScope<QE['functions'], 'entity'>>(
    name: K,
    payload: { parameters: OperationParameters<S, QE['functions'][K]['parameters']> }
  ): BatchOperation<FunctionResponse<S, QE['functions'][K]['returnType']>> {
    const funcDef = this.#entityset.functions[name];
    const useSchemaFQN = funcDef.useSchemaFQN ?? true;

    const request = buildFunctionRequest(
      this.#path,
      this.#schema.namespace,
      String(name),
      payload.parameters,
      this.#baseUrl,
      useSchemaFQN
    );

    return {
      type: 'query',
      request,
      handler: async (response) => {
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
              ...odataProps, // @odata.context, etc.
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
            ...odataProps, // @odata.context, etc.
          },
        } as FunctionResponse<S, QE['functions'][K]['returnType']>;
      },
    };
  }
}

// ============================================================================
// Batch Builder
// ============================================================================

export class BatchBuilder<S extends ResolvedSchema<any>> {
  #schema: S;
  #baseUrl: string;

  constructor(schema: S, baseUrl: string) {
    this.#schema = schema;
    this.#baseUrl = baseUrl;
  }

  entitysets<E extends keyof S['entitysets']>(entityset: E) {
    // TypeScript limitation: type instantiation is excessively deep with complex conditional types
    // Cast entitysets to any to prevent deep type resolution during access
    const entitysets = this.#schema.entitysets as any;
    const entity = entitysets[entityset];
    const Ctor = BatchCollectionOperation as any;
    const result = new Ctor(this.#schema, entity, String(entityset), this.#baseUrl);
    // Cast result back to preserve type information for consumers
    // We preserve the generic E parameter so TypeScript can track it through method calls
    // This allows proper type inference for .query() and other methods
    // @ts-expect-error - TypeScript limitation: type instantiation depth, but type is preserved for consumers
    return result as BatchCollectionOperation<
      S,
      S['entitysets'][E] & { actions: any; functions: any }
    >;
  }

  // Variadic arguments to infer Tuple type
  changeset<T extends readonly BatchOperation<any>[]>(...operations: T): BatchChangeset<T> {
    return {
      operations,
    };
  }

  tuple<T extends any[]>(...args: T): T {
    return args;
  }
}

// ============================================================================
// Batch Execution Logic
// ============================================================================

function isBatchChangeset(item: any): item is BatchChangeset<any> {
  return item && typeof item === 'object' && 'operations' in item && Array.isArray(item.operations);
}

function isBatchOperation(item: any): item is BatchOperation<any> {
  return item && typeof item === 'object' && 'request' in item && 'handler' in item;
}

async function serializeBatch(
  opsMap: Record<string, BatchItem>,
  boundary: string
): Promise<string> {
  const parts: string[] = [];
  let changesetCounter = 0;
  // Global counter ensures fallback Content-IDs are unique across the whole batch
  let contentIdCounter = 1;

  // Helper to serialize a single item (Changeset or Operation)
  const processItem = async (item: BatchOperation<any> | BatchChangeset<any>) => {
    if (isBatchChangeset(item)) {
      // It's a changeset: Create a boundary, wrap operations
      changesetCounter++;
      const changesetBoundary = `changeset_${changesetCounter}`;
      parts.push(`--${boundary}`);
      parts.push(`Content-Type: multipart/mixed; boundary=${changesetBoundary}`);
      parts.push('');

      for (const op of item.operations) {
        if (op.type !== 'mutation') throw new Error('Queries are not allowed inside a changeset');
        const opContentId = op.contentId || `${contentIdCounter++}`;
        const part = await serializeOperation(op, changesetBoundary, opContentId);
        parts.push(part);
      }
      parts.push(`--${changesetBoundary}--`);
    } else if (isBatchOperation(item)) {
      // It's a standalone operation (usually a GET query)
      const opContentId = item.contentId || `${contentIdCounter++}`;
      const part = await serializeOperation(item, boundary, opContentId);
      parts.push(part);
    }
  };

  for (const key of Object.keys(opsMap)) {
    const item = opsMap[key];
    if (!item) continue;

    if (Array.isArray(item)) {
      // Handle Array (e.g. data.map(x => bb.changeset(...)) OR [op1, op2])
      // We process each element sequentially
      for (const subItem of item) {
        await processItem(subItem);
      }
    } else {
      // Handle single top-level item (Changeset or Operation)
      await processItem(item);
    }
  }

  parts.push(`--${boundary}--`);
  return parts.join('\r\n');
}

async function serializeOperation(
  op: BatchOperation<any>,
  boundary: string,
  contentId?: string
): Promise<string> {
  const req = op.request;
  const method = req.method;
  const url = new URL(req.url);
  const path = url.pathname + url.search;

  const parts: string[] = [];
  parts.push(`--${boundary}`);
  parts.push('Content-Type: application/http');
  parts.push('Content-Transfer-Encoding: binary');

  const effectiveId = contentId || op.contentId;
  if (effectiveId) {
    parts.push(`Content-ID: ${effectiveId}`);
  }

  parts.push('');

  parts.push(`${method} ${path} HTTP/1.1`);

  req.headers.forEach((value, key) => {
    parts.push(`${key}: ${value}`);
  });

  parts.push('');

  if (method !== 'GET' && method !== 'DELETE') {
    const bodyText = await req.text();
    parts.push(bodyText);
  }

  return parts.join('\r\n');
}

function parseMultipart(text: string, boundary: string): string[] {
  const parts = text.split(`--${boundary}`);
  return parts
    .slice(1, parts.length - 1)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function parseHttpResponse(text: string): {
  status: number;
  statusText: string;
  headers: Headers;
  body: any;
} {
  const splitResult = text.split(/\r\n\r\n|\n\n/);
  const headerPart = splitResult[0] || '';
  const bodyParts = splitResult.slice(1);
  const bodyPart = bodyParts.join('\r\n\r\n');

  const headerLines = headerPart.split(/\r\n|\n/);
  const statusLine = headerLines[0] || '';

  // Extract status code and status text from HTTP status line
  // Format: "HTTP/1.1 403 Forbidden"
  const statusMatch = statusLine.match(/HTTP\/1\.[01] (\d+) (.+)/);
  if (!statusMatch || !statusMatch[1]) {
    throw new Error(`Failed to parse HTTP status line: ${statusLine}`);
  }

  const status = parseInt(statusMatch[1], 10);
  const statusText = statusMatch[2]?.trim() || 'Unknown';

  const headers = new Headers();
  for (let i = 1; i < headerLines.length; i++) {
    const line = headerLines[i]?.trim();
    if (!line) continue;
    const parts = line.split(':');
    if (parts.length > 1) {
      const key = parts[0]?.trim();
      if (!key) continue;
      const value = parts.slice(1).join(':').trim();
      headers.append(key, value);
    }
  }

  let body = null;
  if (bodyPart && bodyPart.trim()) {
    try {
      body = JSON.parse(bodyPart);
    } catch {
      body = bodyPart;
    }
  }
  return { status, statusText, headers, body };
}

export async function executeBatch<S extends ResolvedSchema<any>, R extends Record<string, any>>(
  client: OdataClientOptions,
  schema: S,
  builderFn: (bb: BatchBuilder<S>) => R
): Promise<BatchResult<R>> {
  const builder = new BatchBuilder(schema, client.baseUrl);
  const opsMap = builderFn(builder);

  const batchBoundary = `batch_${crypto.randomUUID()}`;
  const body = await serializeBatch(opsMap, batchBoundary);

  const response = await client.transport(
    new Request(normalizePath(client.baseUrl, '$batch'), {
      method: 'POST',
      headers: new Headers({
        'Content-Type': `multipart/mixed; boundary=${batchBoundary}`,
        Accept: 'multipart/mixed',
      }),
      body,
    })
  );

  const responseText = await response.text();
  // If HTTP response is not OK, we still try to parse the body
  // Some servers may return non-200 but still include multipart data
  // If parsing fails, we'll handle it when processing parts
  const contentType = response.headers.get('content-type') || '';
  let resBoundary: string = batchBoundary;
  const match = contentType.match(/boundary=([^;]+)/);
  if (match && match[1]) {
    resBoundary = match[1];
  } else {
    const firstLine = responseText.split('\n')[0]?.trim();
    if (firstLine?.startsWith('--')) {
      resBoundary = firstLine.substring(2);
    }
  }

  const batchParts = parseMultipart(responseText, resBoundary);

  // If we couldn't parse any parts and HTTP response was not OK,
  // we might have a batch-level error (not individual operation errors)
  // We still continue processing to allow any valid parts that might exist

  const result: any = {};
  let partIndex = 0;

  // Helper to process response for a single item type (Op or Changeset)
  // Returns the result of that item
  const processItemResponse = async (
    item: BatchOperation<any> | BatchChangeset<any>
  ): Promise<any> => {
    const rawPart = batchParts[partIndex++];
    if (!rawPart) {
      // Missing part - return error result instead of throwing
      // This allows other operations/changesets to still be processed
      if (isBatchChangeset(item)) {
        // For changesets, return error changeset result
        return {
          ok: false,
          error: {
            ok: false,
            status: 0,
            statusText: 'Missing response part',
            headers: new Headers(),
            result: {
              error: {
                message: 'Batch response mismatch: missing part',
                code: 'BATCH_MISSING_PART',
              },
            },
          },
        };
      } else {
        // For single operations, return error ODataResponse
        // We need to infer the error type from the operation's handler
        // Since we can't call the handler without a response, create a generic error
        return {
          ok: false,
          status: 0,
          statusText: 'Missing response part',
          headers: new Headers(),
          result: {
            error: {
              message: 'Batch response mismatch: missing part',
              code: 'BATCH_MISSING_PART',
            },
          },
        } as any; // Type assertion needed since we don't know the exact response type
      }
    }

    if (isBatchChangeset(item)) {
      // It's a changeset: parse inner multipart
      const contentTypeLine = rawPart
        .split(/\r\n|\n/)
        .find((l) => l.toLowerCase().startsWith('content-type:'));
      let innerBoundary = '';
      if (contentTypeLine) {
        const match = contentTypeLine.match(/boundary=([^;]+)/);
        if (match && match[1]) innerBoundary = match[1];
      }

      const splitRaw = rawPart.split(/\r\n\r\n|\n\n/);
      const rest = splitRaw.slice(1);
      const innerBody = rest.join('\n\n');

      if (!innerBoundary) {
        const firstInner = innerBody.split('\n')[0]?.trim();
        if (firstInner?.startsWith('--')) innerBoundary = firstInner.substring(2);
      }

      const changesetParts = parseMultipart(innerBody, innerBoundary);
      const changesetResult: any[] = [];

      for (let i = 0; i < item.operations.length; i++) {
        const op = item.operations[i];
        const rawOpPart = changesetParts[i];

        // If no response part exists, changeset failed before this operation
        if (!rawOpPart || !op) {
          // If we already have an error, return it; otherwise this is the first failure
          if (changesetResult.length > 0 && !changesetResult[changesetResult.length - 1]?.ok) {
            // Return the first error we encountered
            return {
              ok: false,
              error: changesetResult[changesetResult.length - 1],
            };
          }
          // This shouldn't happen in practice, but handle gracefully
          continue;
        }

        // Skip MIME headers (Content-Type, Content-Transfer-Encoding, Content-ID)
        // to get to the actual HTTP response
        const splitRaw = rawOpPart.split(/\r\n\r\n|\n\n/);
        const rest = splitRaw.slice(1);
        const httpResponseText = rest.join('\n\n');

        const parsed = parseHttpResponse(httpResponseText);
        const mockRes = new Response(JSON.stringify(parsed.body), {
          status: parsed.status,
          statusText: parsed.statusText,
          headers: parsed.headers,
        });
        const result = await op.handler(mockRes);
        changesetResult.push(result);

        // If this operation failed, return immediately with the error
        if (!result.ok) {
          return {
            ok: false,
            error: result,
          };
        }
      }

      // All operations succeeded
      return {
        ok: true,
        operations: changesetResult,
      };
    } else {
      // It's a single operation
      const splitRaw = rawPart.split(/\r\n\r\n|\n\n/);
      const rest = splitRaw.slice(1);
      const httpResponseText = rest.join('\n\n');

      const parsed = parseHttpResponse(httpResponseText);
      const mockRes = new Response(JSON.stringify(parsed.body), {
        status: parsed.status,
        statusText: parsed.statusText,
        headers: parsed.headers,
      });
      return await item.handler(mockRes);
    }
  };

  for (const key of Object.keys(opsMap)) {
    const item = opsMap[key];
    if (!item) continue;

    if (Array.isArray(item)) {
      // Array of items (ops or changesets)
      const arrayResult = [];
      for (const subItem of item) {
        arrayResult.push(await processItemResponse(subItem));
      }
      result[key] = arrayResult;
    } else {
      // Single item
      result[key] = await processItemResponse(item);
    }
  }

  return result;
}
