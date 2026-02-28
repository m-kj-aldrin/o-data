## o-data

**o-data** is a TypeScript‑first OData 4.01 client and schema generator.

It has two parts:

- **Runtime library** – a strongly‑typed client for querying and mutating OData services.
- **CLI parser / schema generator** – reads an OData CSDL XML document and generates a typed schema module the runtime can consume.

---

## Features

- **Schema‑driven, fully typed client**
  - Describe your service once in a TypeScript schema; get strong types for queries, payloads, and responses.
- **Fluent query builder**
  - `$select`, `$expand` (with nested options), `$filter`, `$orderby`, `$top`, `$skip`, `$count`.
  - `$filter` DSL with navigation, `any` / `all`, enums, dates, and string functions.
- **Navigation‑aware create/update**
  - Supports `@odata.bind` for single and collection navigations, deep inserts, and batch references.
- **Actions & functions**
  - Bound and unbound operations, with correct URL shapes and parameter serialization.
- **Batch requests ($batch)**
  - Same fluent API as the client; queue operations and send them in a single multipart request. GET/query/function outside changesets; create/update/delete/action inside changesets.
- **Schema generator from CSDL**
  - CLI reads your OData metadata XML and emits a typed `schema({...})` module.
  - Powerful include/exclude/masking rules for keeping the generated surface small and relevant.

---

## Installation

```bash
# with bun
bun add o-data

# or with npm
npm install o-data

# or with pnpm
pnpm add o-data

# or with yarn
yarn add o-data
```

The runtime expects a `fetch`‑compatible environment (`Request`, `Response`, `Headers`); it works in modern Node (with `fetch`) and browsers.

---

## Runtime: Getting started

### 1. Define or generate a schema

You can either write a schema by hand:

```ts
// schema.ts
import { schema } from "o-data/schema";

export const crmSchema = schema({
  namespace: "Microsoft.Dynamics.CRM",
  alias: "mscrm",
  enumtypes: {
    IncidentStatus: {
      isFlags: false,
      members: {
        Active: 0,
        Resolved: 1,
        Cancelled: 2,
      },
    },
  },
  entitytypes: {
    Incident: {
      properties: {
        id: { type: "Edm.Guid" },
        title: { type: "Edm.String" },
        status: { type: "enum", target: "IncidentStatus" },
      },
    },
  },
  entitysets: {
    incidents: { entitytype: "Incident" },
  },
});
```

…or generate one from a CSDL XML using the CLI (see **Schema generator (CLI)** below).

### 2. Create an `OdataClient`

```ts
// client.ts
import { OdataClient } from "o-data";
import { crmSchema } from "./schema"; // or generated-o-data-schema

const client = new OdataClient(crmSchema, {
  baseUrl: "https://example.com/api/data/v9.0/",
  transport: fetch, // any (req: Request) => Promise<Response>
});
```

---

## Querying data

### Collection queries

```ts
// GET /incidents?$select=title,status&$top=10&$orderby=title asc
const response = await client.entitysets("incidents").query({
  select: ["title", "status"],
  top: 10,
  orderby: ["title", "asc"],
});

if (response.ok) {
  const incidents = response.result.data; // typed by schema + query
}
```

### Expands and nested options

```ts
// GET /incidents?$expand=incident_contact($select=name,email)
const res = await client.entitysets("incidents").query({
  expand: {
    incident_contact: {
      select: ["name", "email"],
    },
  },
});
```

### Filter builder

Filters use a small builder DSL that respects your schema:

```ts
// GET /incidents?$filter=status eq Namespace.IncidentStatus'Active'
const res = await client.entitysets("incidents").query({
  filter: (h) => h.clause("status", "eq", "Active"),
});

// Navigation + logical operators
const res2 = await client.entitysets("incidents").query({
  filter: (h) =>
    h
      .clause("title", "contains", "Support")
      .and(
        h.nav("incident_contact", (nh) =>
          nh.clause("email", "eq", "user@example.com"),
        ),
      ),
});
```

Supported operators include `eq`, `ne`, `gt`, `ge`, `lt`, `le`, `in`, `contains`, `startswith`, `endswith`.  
For enums, you can pass either the member name (`"Active"`) or the underlying numeric value (`1`); they are serialized as FQN enum literals.

### Single‑entity queries and navigation

```ts
// GET /incidents(guid-123)?$select=title
const incident = await client
  .entitysets("incidents")
  .key("guid-123")
  .query({ select: ["title"] });

// GET /incidents(guid-123)/incident_contact
const contact = await client
  .entitysets("incidents")
  .key("guid-123")
  .navigate("incident_contact")
  .query({});
```

---

## Creating and updating entities

The library infers create/update shapes from your schema and takes care of `@odata.bind` and deep inserts.

### Create

```ts
// Basic create
const created = await client.entitysets("incidents").create({
  title: "New incident",
  description: "Description",
});

// Create with navigation bind (single‑valued)
await client.entitysets("incidents").create({
  title: "Linked to contact",
  incident_contact: "guid-contact-id", // → "incident_contact@odata.bind": "/contacts(guid-contact-id)"
});

// Create with collection navigation bind
await client.entitysets("contacts").create({
  name: "John",
  contact_incidents: ["incident-id-1", "incident-id-2"],
  // → "contact_incidents@odata.bind": ["/incidents(incident-id-1)", "/incidents(incident-id-2)"]
});

// Deep insert
await client.entitysets("incidents").create({
  title: "Deep insert example",
  incident_contact: {
    name: "Nested contact",
    email: "nested@example.com",
  },
});
```

You can control response shape via options:

```ts
await client.entitysets("incidents").create(
  { title: "Return representation" },
  {
    select: ["title", "description"],
    prefer: { return_representation: true },
  },
);
```

### Update

```ts
// Simple PATCH
await client.entitysets("incidents").key("guid-123").update({
  title: "Updated title",
});

// Repoint single navigation
await client.entitysets("incidents").key("guid-123").update({
  incident_contact: "guid-new-contact",
});

// Collection navigation operations
await client
  .entitysets("contacts")
  .key("guid-contact")
  .update({
    contact_incidents: {
      add: ["incident-id-3"],
      remove: ["incident-id-1"],
    },
  });
```

Options for update mirror create: `select`, `prefer.return_representation`, custom headers.

---

## Batch requests

Use `client.batch()` to build a `$batch` request with the same fluent API. Operations are queued and sent in a single multipart request:

- **GET, query, function** – outside changesets (read-only)
- **Create, update, delete, action** – inside changesets (atomic)

```ts
const batch = client.batch();

batch.entitysets("incidents").query({ select: ["title"], top: 10 });
batch.entitysets("incidents").create({ title: "New" });
batch.entitysets("incidents").key("guid-123").update({ title: "Updated" });
batch.entitysets("incidents").key("guid-456").delete();

const response = await batch.execute();
```

`batch.execute()` returns the raw multipart `Response`; parsing individual operation responses is the application's responsibility. Use `batch.buildRequest()` to obtain the `Request` without sending it.

You can also use `.navigate(...)`, bound and unbound actions, and functions within a batch with the same API as the client.

---

## Actions and functions

### Bound actions

```ts
// POST /incidents(guid-123)/Namespace.assignIncident
const res = await client
  .entitysets("incidents")
  .key("guid-123")
  .action("assignIncident", {
    parameters: {
      assigneeId: "guid-user",
      priority: 1,
    },
  });

if (res.ok) {
  const ok: boolean = res.result.data; // mapped from Edm.Boolean
}
```

### Unbound actions (via imports)

```ts
// POST /BulkCreate
const res = await client.action("BulkCreate", {
  parameters: {
    entities: ["1", "2", "3"],
  },
});
```

### Bound functions

```ts
// GET /incidents(guid-123)/Namespace.getRelatedCount(relationType=@relationType)?@relationType='contact'
const res = await client
  .entitysets("incidents")
  .key("guid-123")
  .function("getRelatedCount", {
    parameters: { relationType: "contact" },
  });

if (res.ok) {
  const count: number = res.result.data;
}
```

### Unbound functions (via imports)

```ts
// GET /Search(query=@query,entityTypes=@entityTypes)?@query='test'&@entityTypes=...
const res = await client.function("Search", {
  parameters: {
    query: "test",
    entityTypes: ["Incident", "Contact"],
  },
});
```

For navigation‑typed parameters (actions/functions), you can use the same patterns as for create/update: IDs, `[entityset, id]`, deep insert objects, or arrays thereof; the library converts them to `@odata.bind` or nested objects as needed.

---

## Schema generator (CLI)

The CLI reads an OData CSDL XML document and generates a strongly‑typed schema module that plugs into the runtime.

### 1. Create a config file

Create `odata-parser.config.js` (or `.ts`) in your project root:

```ts
// odata-parser.config.ts
import { defineConfig } from "o-data/parser";

export default defineConfig({
  inputPath: "./metadata.xml",
  outputPath: "./src/schema",
  wantedEntities: "ALL", // or ['incidents', 'contacts']
  wantedUnboundActions: "ALL",
  wantedUnboundFunctions: "ALL",
  excludeFilters: {
    entities: [/^msdyn_/],          // drop system sets
    properties: [/^adx_/],          // drop noisy props
  },
  selectionMode: "additive",         // or 'only' for strict whitelists
  // onlyEntities, onlyBoundActions, onlyUnboundActions, mask, ... are available
});
```

Running the generator will produce e.g. `src/schema/generated-o-data-schema.ts` that looks like:

```ts
import { schema } from "o-data/schema";

export const myservice_schema = schema({
  namespace: "My.Service",
  alias: "ms",
  enumtypes: { /* ... */ },
  complextypes: { /* ... */ },
  entitytypes: { /* ... */ },
  entitysets: { /* ... */ },
  actions: { /* ... */ },
  functions: { /* ... */ },
  actionImports: { /* ... */ },
  functionImports: { /* ... */ },
});
```

### 2. Run the CLI

From your project root:

```bash
# using the global CLI name exposed by this package
npx o-data path/to/odata-parser.config.js

# or (when installed locally in a Node/Bun project)
bun x o-data path/to/odata-parser.config.js
```

If you omit the path, the CLI looks for `odata-parser.config.js` (and then `.ts`) in the current working directory.

Then in your code:

```ts
import { myservice_schema } from "./schema/generated-o-data-schema";
import { OdataClient } from "o-data";

const client = new OdataClient(myservice_schema, {
  baseUrl: "https://example.com/odata/",
  transport: fetch,
});
```

---

## Status and limitations

- The library is still **early (0.0.x)**; APIs may change.
- Some operations are marked `TODO` in the runtime (e.g. delete support outside batch, collection‑bound actions/functions implementation, richer pagination).
- The generator doesn’t yet handle OData operation overloading beyond keeping the first operation per name.

---

## Development

- **Build**

```bash
bun x tsc -p tsconfig.build.json
```

- **Tests**

```bash
bun test
```

---
