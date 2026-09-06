import { prisma } from "../prisma";

/**
 * Tenant-scoped database access — the foundation for future Tenant Admin
 * functionality. Every query issued through the client returned by
 * getScopedDb(tenantId) is automatically confined to that tenant's own
 * rows, using a Prisma Client Extension (the current, supported mechanism
 * in Prisma 7 — the older `$use` middleware API was removed).
 *
 * SECURITY NOTE: this is a database abstraction only. getScopedDb() trusts
 * whatever tenantId its caller supplies — it does not itself verify that
 * the caller is authenticated or authorized for that tenant. Establishing
 * a verified tenantId (from authentication/authorization) is a later
 * checkpoint; callers here are responsible for supplying one.
 *
 * Covers: findMany/findFirst/findUnique(+OrThrow)/count/create/createMany/
 * update/updateMany/upsert/delete/deleteMany. aggregate/groupBy are not
 * covered yet — not used anywhere in V1 today; add them here first if that
 * changes, rather than assuming they're already scoped.
 *
 * Scoped models: domain, branding, product (Checkpoint 4C); productVariant,
 * variantOption, variantOptionValue, productOption, productVariantOptionValue,
 * location, inventory (Checkpoint 4F, architecture v4.1); tenantShippingMethod
 * (V1 Configurable Shipping). Future tenant-owned models must be added here
 * explicitly — they are not automatically covered just by having a tenantId
 * column. Note: tenantPaymentMethod, order, orderItem, and customer remain
 * NOT covered by this extension (an established, pre-existing gap this
 * change does not close) — their callers instead manually thread tenantId
 * through every where/create/update clause explicitly; see
 * tenant-payment-mutations.ts and order-mutations.ts for that pattern.
 */

type QueryArgs = Record<string, unknown>;

function scopeArgsForOperation(operation: string, args: QueryArgs, tenantId: string): QueryArgs {
  const scoped: QueryArgs = { ...args };

  switch (operation) {
    case "findFirst":
    case "findFirstOrThrow":
    case "findMany":
    case "findUnique":
    case "findUniqueOrThrow":
    case "count":
    case "delete":
    case "deleteMany":
      scoped.where = { ...(scoped.where as QueryArgs | undefined), tenantId };
      break;

    case "create":
      scoped.data = { ...(scoped.data as QueryArgs | undefined), tenantId };
      break;

    case "createMany":
      if (Array.isArray(scoped.data)) {
        scoped.data = scoped.data.map((row: QueryArgs) => ({ ...row, tenantId }));
      }
      break;

    case "update":
    case "updateMany": {
      scoped.where = { ...(scoped.where as QueryArgs | undefined), tenantId };
      const data = { ...(scoped.data as QueryArgs | undefined) };
      delete data.tenantId; // never allow a write to move a record to another tenant
      scoped.data = data;
      break;
    }

    case "upsert": {
      scoped.where = { ...(scoped.where as QueryArgs | undefined), tenantId };
      scoped.create = { ...(scoped.create as QueryArgs | undefined), tenantId };
      const update = { ...(scoped.update as QueryArgs | undefined) };
      delete update.tenantId;
      scoped.update = update;
      break;
    }

    default:
      break;
  }

  return scoped;
}

export function getScopedDb(tenantId: string) {
  if (!tenantId) {
    throw new Error("getScopedDb requires a non-empty tenantId");
  }

  return prisma.$extends({
    name: `tenant-scope:${tenantId}`,
    query: {
      domain: {
        async $allOperations({ operation, args, query }) {
          return query(scopeArgsForOperation(operation, args as QueryArgs, tenantId));
        },
      },
      branding: {
        async $allOperations({ operation, args, query }) {
          return query(scopeArgsForOperation(operation, args as QueryArgs, tenantId));
        },
      },
      product: {
        async $allOperations({ operation, args, query }) {
          return query(scopeArgsForOperation(operation, args as QueryArgs, tenantId));
        },
      },
      productVariant: {
        async $allOperations({ operation, args, query }) {
          return query(scopeArgsForOperation(operation, args as QueryArgs, tenantId));
        },
      },
      variantOption: {
        async $allOperations({ operation, args, query }) {
          return query(scopeArgsForOperation(operation, args as QueryArgs, tenantId));
        },
      },
      variantOptionValue: {
        async $allOperations({ operation, args, query }) {
          return query(scopeArgsForOperation(operation, args as QueryArgs, tenantId));
        },
      },
      productOption: {
        async $allOperations({ operation, args, query }) {
          return query(scopeArgsForOperation(operation, args as QueryArgs, tenantId));
        },
      },
      productVariantOptionValue: {
        async $allOperations({ operation, args, query }) {
          return query(scopeArgsForOperation(operation, args as QueryArgs, tenantId));
        },
      },
      location: {
        async $allOperations({ operation, args, query }) {
          return query(scopeArgsForOperation(operation, args as QueryArgs, tenantId));
        },
      },
      inventory: {
        async $allOperations({ operation, args, query }) {
          return query(scopeArgsForOperation(operation, args as QueryArgs, tenantId));
        },
      },
      tenantShippingMethod: {
        async $allOperations({ operation, args, query }) {
          return query(scopeArgsForOperation(operation, args as QueryArgs, tenantId));
        },
      },
    },
  });
}
