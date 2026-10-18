# E-Com Platform

A multi-tenant e-commerce platform built with Next.js, TypeScript, and Prisma.

> Product vision, architecture, and decision records are maintained in Notion, not
> in this repository.

## Prerequisites

- Node.js 20+
- npm
- A PostgreSQL database (local or hosted) — required. The application is backed by
  Prisma throughout, and `npm run build` runs `prisma generate`.

## Installation

```bash
npm install
```

## Environment Variables

1. Copy `.env.example` to `.env.local`
2. Fill in real values — at minimum `DATABASE_URL`. Payment providers are
   optional and each stays disabled until its variables are set: `MOMO_*`
   (partner code, access key, secret key, endpoint, IPN and redirect URLs) and
   `SEPAY_*` (API base URL, API token, webhook secret).

```bash
cp .env.example .env.local
```

`.env.local` is git-ignored and should never be committed.

## Running Locally

```bash
npm run dev
```

Open the URL printed in the terminal (usually [http://localhost:3000](http://localhost:3000)).

## Lint

```bash
npm run lint
```

## Build

```bash
npm run build
```

## Tests

```bash
npm test
```

738 tests on the Node test runner, run serially (`--test-concurrency=1`) because
the database-backed ones share one local database. They require `DATABASE_URL`
to point at a local development database: several provision and delete their own
tenants. Never point them at Preview or Production.

## Other Scripts

| Command | Purpose |
|---|---|
| `npm run format` | Format code with Prettier |
| `npm run format:check` | Check formatting without writing |
| `npm run db:generate` | Regenerate the Prisma client from schema |
| `npm run db:migrate` | Create/apply a database migration (dev) |
| `npm run db:studio` | Open Prisma Studio (visual DB browser) |

## Release

Release readiness, the outstanding migration blockers and the full QA status are
documented in [docs/release-readiness.md](docs/release-readiness.md), with the
step-by-step procedure in [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md).

These commands are read-only checks against an explicitly chosen target. They
never fall back to `DATABASE_URL`, and they exit 2 if no target is set.

| Command | Purpose |
|---|---|
| `npm run release:preflight` | Migration-history drift across the whole release |
| `npm run release:preflight:order-events` | Pre-migration checks for the OrderEvent sequence |
| `npm run release:verify:order-events` | Post-migration verification of that migration |
| `npm run release:prune:rejections` | Payment-rejection retention pruning (dry run unless `--apply`) |

```bash
RELEASE_CHECK_DATABASE_URL="postgresql://..." npm run release:preflight
```

