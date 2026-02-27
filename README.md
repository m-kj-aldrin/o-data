# o-data

Type-safe OData client and schema generator for Node and Bun.

## Installation

```bash
npm install o-data
# or
pnpm add o-data
# or
yarn add o-data
```

## Generating a schema from CSDL

Create an ESM config file in your project root, for example `odata-parser.config.mjs`:

```js
import { defineConfig } from "o-data/parser";

export default defineConfig({
  inputPath: "csdl.xml",
  outputPath: "src/odata",
  // filters and masks...
});
```

Then run the CLI (after your project has `csdl.xml` in place):

```bash
npx o-data generate-schema             # uses odata-parser.config.mjs in cwd
npx o-data generate-schema path/to/config.mjs
```

This will write a file like `src/odata/generated-o-data-schema.ts` in your project.

## Using the generated schema with the client

```ts
import { OdataClient } from "o-data";
import { my_service_schema } from "./src/odata/generated-o-data-schema";

const client = new OdataClient(my_service_schema, {
  baseUrl: "https://example.crm.dynamics.com/api/data/v9.0/",
  transport: fetch,
});
```

You can now build strongly-typed OData queries using the generated schema.

