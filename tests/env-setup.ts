// Preloaded via `node --import ./tests/env-setup.ts` BEFORE any test file
// (or the modules it imports, like src/lib/prisma.ts) is evaluated — ESM
// resolves and evaluates imported modules before an importing file's own
// top-level code runs, so calling dotenv.config() inside a test file
// itself is too late if that file also imports prisma.ts. This preload
// step is the only reliable place to do it.
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
