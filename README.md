# E-Com Platform

A reusable, multi-tenant, white-label e-commerce platform for physical products.
See [docs/architecture.md](docs/architecture.md) for the product vision and system
design, and [docs/decisions.md](docs/decisions.md) for the decision log.

**Status**: project scaffolding only. No commerce features implemented yet — see
[docs/architecture.md#walking-skeleton](docs/architecture.md#walking-skeleton) for
what's built next.

## Documentation

- [docs/architecture.md](docs/architecture.md) — vision, scope, stack, architecture
- [docs/multi-tenancy.md](docs/multi-tenancy.md) — tenant model and identification
- [docs/security.md](docs/security.md) — tenant isolation and access control
- [docs/decisions.md](docs/decisions.md) — architecture decision log

## Getting Started

1. Copy `.env.example` to `.env.local` and fill in a real `DATABASE_URL`.
2. Install dependencies: `npm install`
3. Run the dev server: `npm run dev`
4. Open [http://localhost:3000](http://localhost:3000)

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the local dev server |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm run format` | Format code with Prettier |
| `npm run format:check` | Check formatting without writing |
| `npm run db:generate` | Regenerate the Prisma client from schema |
| `npm run db:migrate` | Create/apply a database migration (dev) |
| `npm run db:studio` | Open Prisma Studio (visual DB browser) |

Built with Next.js, TypeScript, Tailwind CSS, and Prisma.
