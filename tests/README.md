# Tests

Run with `npm test`.

## Conventions

- **Runner:** Node's built-in test runner (`node:test` + `node:assert/strict`),
  with `tsx` as the loader for TypeScript. No jest/vitest — nothing to
  configure, nothing extra in the dependency tree.
- **Env loading:** `tests/env-setup.ts` is preloaded via `--import` so
  `.env.local` is read *before* any test file (or the modules it imports,
  like `src/lib/prisma.ts`) is evaluated. ESM evaluates imported modules
  before the importing file's own top-level code, so calling
  `dotenv.config()` inside a test file is too late if that file also
  imports Prisma.
- **Database:** DB-backed tests run against the **local dev Postgres only**
  (whatever `.env.local`'s `DATABASE_URL` points at). No Preview or
  Production credential is ever read. Each file creates its own throwaway
  tenants with a random UUID suffix and deletes them in `after()`, so runs
  are deterministic and independent of pre-existing local data.
- **`--test-concurrency=1` is load-bearing.** The local Postgres is reached
  through a connection pooler, and running test files concurrently caused
  intermittent `08P01: bind message supplies N parameters, but prepared
  statement "" requires 0` failures — the classic unnamed-prepared-statement
  collision you get when pooled connections are shared across concurrent
  clients. Serialising the files removes the collision entirely. Do not
  drop this flag to speed the suite up without first confirming the pooling
  behaviour has changed.

## What is and isn't covered

Covered: tenant isolation, order-lookup privacy rules, discount
calculation/expiry, banner CTA URL validation, image-crop geometry,
rate-limit bucketing, and the Tenant Admin authorization decision.

Not covered: UI/DOM interaction (toast rendering, crop drag/zoom,
click-through flows). There is no jsdom/testing-library in this project;
those remain manual-QA items.
