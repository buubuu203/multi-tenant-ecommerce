# E-Com Platform

A multi-tenant e-commerce platform built with Next.js, TypeScript, and Prisma.

> Product vision, architecture, and decision records are maintained in Notion, not
> in this repository.

## Prerequisites

- Node.js 20+
- npm
- A PostgreSQL database (local or hosted) — only needed once database features are
  implemented; not required to run the current scaffold

## Installation

```bash
npm install
```

## Environment Variables

1. Copy `.env.example` to `.env.local`
2. Fill in real values — at minimum, `DATABASE_URL` once you have a database to
   connect to

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

No test suite exists yet. This section will be updated once tests are added.

## Other Scripts

| Command | Purpose |
|---|---|
| `npm run format` | Format code with Prettier |
| `npm run format:check` | Check formatting without writing |
| `npm run db:generate` | Regenerate the Prisma client from schema |
| `npm run db:migrate` | Create/apply a database migration (dev) |
| `npm run db:studio` | Open Prisma Studio (visual DB browser) |
