# demo

Local playground for this worktree. Gitignored — not part of the published package.

Use it to:

1. Generate a typed schema from Dynamics CSDL (`csdl.xml`).
2. Hover types in the editor against that schema (and against a tiny handwritten one).
3. Optionally send real requests with cookies from `.env`.

## Files

| File | What it is for |
| --- | --- |
| `handwritten.ts` | Small `schema()` example. Open this to see inference without CSDL. |
| `playground.ts` | Generated CRM schema + mock transport. Hover `query` / `update` / `expand` here. |
| `live.ts` | Same generated schema, real `fetch`. Uncomment a call; needs `.env`. |
| `odata-parser.config.ts` | Which entities/actions the generator keeps. |
| `csdl.xml` | Input metadata (large). |
| `generated-o-data-schema.ts` | Generator output. Do not edit; regenerate instead. |

## Regenerate the schema

From the repo root:

```bash
bun src/cli.ts demo/odata-parser.config.ts
```

Output is `demo/generated-o-data-schema.ts`. `demo/tsconfig.json` maps `@mkja/o-data/schema` to `src`, so the generated file type-checks against the local library.

## Run

```bash
cd demo
bun playground.ts
bun --env-file=.env live.ts
```

`live.ts` does not send anything until you uncomment a request.
