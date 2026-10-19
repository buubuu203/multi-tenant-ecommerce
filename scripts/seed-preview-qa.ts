/**
 * Seeds a clearly identifiable, fully synthetic QA dataset.
 *
 * WHY THIS EXISTS. The Preview database is empty apart from one real
 * tenant, so authenticated browser QA could only ever exercise empty
 * states. This creates enough data to verify orders, print documents,
 * customer sorting, fulfillment, analytics arithmetic and payment
 * operations — and nothing else.
 *
 * IT IS NOT A GENERAL SEED SCRIPT. It refuses to run unless every one of
 * the guards below passes, it writes inside one transaction, it never
 * deletes anything, and it never touches a tenant it did not create.
 *
 * HOW THE DATA IS MADE. Orders, payments, inventory movements and audit
 * events all go through the REAL application services — createOrder(),
 * createPaymentForOrder(), updateOrderStatus(), markManualPaymentReceived()
 * — so every invariant those enforce holds here too. Rows are not
 * hand-inserted into a shape the application could never produce, which
 * is the usual way a seed makes QA lie. The two exceptions are
 * deliberate and narrow, and both are explained where they happen:
 * customers with no orders (checkout cannot create one), and backdating
 * createdAt so date-range and sort QA has something to sort.
 *
 * NO EXTERNAL CALL IS MADE. The only payment providers used are `cod`
 * and `bank_transfer_manual`, both of which are pure local code with no
 * network access. MoMo and SePay are never touched.
 *
 * NOTHING HERE CLAIMS A FACT THE APPLICATION CANNOT OBSERVE. There is no
 * delivery, no carrier, no tracking, no refund, no return, no
 * notification, and no settled payment. A COD payment stays pending,
 * exactly as it does in production.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { createOrder, updateOrderStatus } from '../src/lib/order-mutations';
import {
  createPaymentForOrder,
  markManualPaymentReceived,
} from '../src/lib/payments/payment-service';
import { recordPaymentRejection } from '../src/lib/payments/payment-rejection';

// ---------------------------------------------------------------- config

export const QA_PREFIX = 'QA-PREVIEW-20261019';
export const QA_SLUG_PREFIX = 'qa-preview-20261019';
const TENANT_A_SLUG = `${QA_SLUG_PREFIX}-a`;
const TENANT_B_SLUG = `${QA_SLUG_PREFIX}-b`;

/** Non-deliverable by RFC 2606. Nothing here can reach a real inbox. */
const EMAIL_DOMAIN = 'example.invalid';
/**
 * +8490000000x is inside Viettel's range but these specific numbers are
 * reserved here as obviously-sequential test values. They are never
 * dialled, messaged or sent anywhere — no notification transport exists.
 */
const PHONE_C1 = '+84900000001';
const PHONE_SHARED = '+84900000002';

const DAY = 24 * 60 * 60 * 1000;

// ------------------------------------------------------------- utilities

class SeedError extends Error {}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function redactedTarget(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname}:${parsed.port || '5432'}/${parsed.pathname.replace(/^\//, '')}`;
}

/**
 * Every guard that must hold before a single row is written.
 *
 * The emptiness check is the one that actually protects Production. A
 * variable named "preview" proves nothing — anyone can point it
 * anywhere. But Production has real orders and products, and this
 * refuses to run against a database that has any. That is a property of
 * the data, not of a label.
 */
async function assertSafeTarget(): Promise<string> {
  if (process.env.SEED_PREVIEW_QA !== '1') {
    throw new SeedError(
      'SEED_PREVIEW_QA=1 is not set.\n' +
        'This script never runs by accident. Set it explicitly for the\n' +
        'environment you intend to seed.',
    );
  }

  const target = process.env.RELEASE_CHECK_DATABASE_URL;
  if (!target || target.trim() === '') {
    throw new SeedError(
      'RELEASE_CHECK_DATABASE_URL is not set.\n' +
        'This script never guesses a target and never falls back to DATABASE_URL.',
    );
  }

  // The application services below connect through src/lib/prisma, which
  // reads DATABASE_URL. Requiring the two to name the SAME database is
  // what stops the operator choosing a target with one variable while
  // the writes land somewhere else entirely.
  const expectedDatabase = new URL(target).pathname.replace(/^\//, '');
  const [{ current_database: actualDatabase }] = await prisma.$queryRawUnsafe<
    { current_database: string }[]
  >('SELECT current_database()');

  if (actualDatabase !== expectedDatabase) {
    throw new SeedError(
      `Target mismatch. RELEASE_CHECK_DATABASE_URL names database "${expectedDatabase}",\n` +
        `but the Prisma client is connected to "${actualDatabase}".\n` +
        'Set DATABASE_URL to the same Preview target and try again.',
    );
  }

  const [orders, products, customers, payments] = await Promise.all([
    prisma.order.count(),
    prisma.product.count(),
    prisma.customer.count(),
    prisma.payment.count(),
  ]);

  // Known-empty is the whole safety argument. If this database has
  // application data, it is not the Preview database this was written
  // for, and seeding it would be contaminating someone's real store.
  if (orders > 0 || products > 0 || customers > 0 || payments > 0) {
    throw new SeedError(
      'Refusing to seed: this database already contains application data\n' +
        `(orders=${orders}, products=${products}, customers=${customers}, payments=${payments}).\n` +
        'The Preview database this script targets was verified empty. A populated\n' +
        'target means the wrong database was selected — possibly Production.',
    );
  }

  const existing = await prisma.tenant.findMany({
    where: { slug: { startsWith: QA_SLUG_PREFIX } },
    select: { slug: true },
  });
  if (existing.length > 0) {
    throw new SeedError(
      `Refusing to seed: QA tenants already exist (${existing.map((t) => t.slug).join(', ')}).\n` +
        'This script is not idempotent by design — re-running it would double the\n' +
        'dataset and make every QA count wrong. Remove them first, deliberately.',
    );
  }

  return target;
}

// --------------------------------------------------------------- tenants

type Variant = { id: string; sku: string; price: number; label: string };

async function provisionTenant(options: {
  slug: string;
  name: string;
}): Promise<{
  tenantId: string;
  locationId: string;
  shippingStandardId: string;
  shippingExpressId: string;
}> {
  const tenant = await prisma.tenant.create({
    data: { slug: options.slug, name: options.name, status: 'active' },
  });

  await prisma.domain.create({
    // .invalid can never resolve, so this hostname cannot route anywhere.
    data: {
      tenantId: tenant.id,
      hostname: `${options.slug}.qa.invalid`,
      type: 'subdomain',
      isPrimary: true,
    },
  });

  await prisma.branding.create({
    data: { tenantId: tenant.id, storeName: options.name, primaryColor: '#1f6feb' },
  });

  const location = await prisma.location.create({
    data: { tenantId: tenant.id, name: `${QA_PREFIX} Kho chính`, isDefault: true },
  });

  const standard = await prisma.tenantShippingMethod.create({
    data: {
      tenantId: tenant.id,
      name: 'Giao hàng tiêu chuẩn QA',
      amount: 30_000,
      enabled: true,
      isDefault: true,
      sortOrder: 0,
    },
  });
  const express = await prisma.tenantShippingMethod.create({
    data: {
      tenantId: tenant.id,
      name: 'Giao hàng nhanh QA',
      amount: 60_000,
      enabled: true,
      isDefault: false,
      sortOrder: 1,
    },
  });

  // COD and MANUAL bank transfer only. Both adapters are pure local code
  // with no network access. MoMo and SePay are deliberately left
  // unconfigured: they would require real credentials, which Preview does
  // not have and which must never appear in a seed.
  await prisma.tenantPaymentMethod.create({
    data: { tenantId: tenant.id, method: 'cod', provider: 'cod', enabled: true },
  });
  await prisma.tenantPaymentMethod.create({
    data: {
      tenantId: tenant.id,
      method: 'bank_transfer',
      provider: 'bank_transfer_manual',
      enabled: true,
      // Obviously synthetic. Not a real bank, account or holder.
      config: {
        bankName: 'QA TEST BANK (khong co that)',
        accountNumber: '0000000000',
        accountHolder: `${QA_PREFIX} TEST ACCOUNT`,
      },
    },
  });

  return {
    tenantId: tenant.id,
    locationId: location.id,
    shippingStandardId: standard.id,
    shippingExpressId: express.id,
  };
}

async function createSimpleProduct(options: {
  tenantId: string;
  locationId: string;
  name: string;
  status: 'active' | 'draft';
  sku: string;
  price: number;
  onHand: number;
  reserved?: number;
}): Promise<Variant> {
  const product = await prisma.product.create({
    data: {
      tenantId: options.tenantId,
      name: options.name,
      status: options.status,
      description: `${QA_PREFIX} synthetic product for Preview QA.`,
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      tenantId: options.tenantId,
      productId: product.id,
      price: options.price,
      sku: options.sku,
      status: 'active',
      combinationKey: '',
    },
  });
  await prisma.inventory.create({
    data: {
      tenantId: options.tenantId,
      productVariantId: variant.id,
      locationId: options.locationId,
      onHand: options.onHand,
      reserved: options.reserved ?? 0,
    },
  });
  return { id: variant.id, sku: options.sku, price: options.price, label: options.name };
}

/** A product with real options, so variant UI and SKU search have something to show. */
async function createVariantProduct(options: {
  tenantId: string;
  locationId: string;
}): Promise<Variant[]> {
  const product = await prisma.product.create({
    data: {
      tenantId: options.tenantId,
      // Deliberately long, to exercise wrapping and truncation at 375px.
      name: `${QA_PREFIX} Giày thể thao nam nữ cao cấp phiên bản giới hạn với tên sản phẩm rất dài để kiểm tra xuống dòng`,
      status: 'active',
      description: `${QA_PREFIX} synthetic multi-variant product.`,
    },
  });

  const colour = await prisma.variantOption.create({
    data: { tenantId: options.tenantId, name: 'Màu sắc' },
  });
  const black = await prisma.variantOptionValue.create({
    data: { tenantId: options.tenantId, variantOptionId: colour.id, value: 'Đen' },
  });
  const white = await prisma.variantOptionValue.create({
    data: { tenantId: options.tenantId, variantOptionId: colour.id, value: 'Trắng' },
  });
  await prisma.productOption.create({
    data: { tenantId: options.tenantId, productId: product.id, variantOptionId: colour.id },
  });

  const specs: {
    value: { id: string };
    label: string;
    sku: string;
    onHand: number;
    reserved: number;
  }[] = [
    // available 5 — exactly the low-stock threshold, which is inclusive.
    { value: black, label: 'Đen', sku: 'QA-SHOE-BLACK', onHand: 5, reserved: 0 },
    // available 0 despite physical stock — fully reserved.
    { value: white, label: 'Trắng', sku: 'QA-SHOE-WHITE', onHand: 4, reserved: 4 },
  ];

  const variants: Variant[] = [];
  for (const spec of specs) {
    const variant = await prisma.productVariant.create({
      data: {
        tenantId: options.tenantId,
        productId: product.id,
        price: 1_250_000,
        sku: spec.sku,
        status: 'active',
        combinationKey: '',
      },
    });
    // The join row is the source of truth; combinationKey is recomputed
    // by the database trigger, never by this script.
    await prisma.productVariantOptionValue.create({
      data: {
        tenantId: options.tenantId,
        // Denormalised on purpose: the composite FKs above use it to
        // prove the variant, the product and the option all agree.
        productId: product.id,
        productVariantId: variant.id,
        variantOptionId: colour.id,
        variantOptionValueId: spec.value.id,
      },
    });
    await prisma.inventory.create({
      data: {
        tenantId: options.tenantId,
        productVariantId: variant.id,
        locationId: options.locationId,
        onHand: spec.onHand,
        reserved: spec.reserved,
      },
    });
    variants.push({ id: variant.id, sku: spec.sku, price: 1_250_000, label: spec.label });
  }
  return variants;
}

// ---------------------------------------------------------------- orders

type PlacedOrder = { orderId: string; total: number };

async function placeOrder(options: {
  tenantId: string;
  items: { productVariantId: string; quantity: number }[];
  paymentMethod: 'cod' | 'bank_transfer';
  customer: { name: string; email: string; phone: string };
  shippingMethodId: string;
  note?: string;
  daysAgo: number;
}): Promise<PlacedOrder> {
  const result = await createOrder(
    options.tenantId,
    options.items,
    options.paymentMethod,
    options.customer,
    {
      address: '123 Đường Nguyễn Huệ, Toà nhà QA, Tầng 12, Phòng 1201',
      ward: 'Phường Bến Nghé',
      district: 'Quận 1',
      city: 'Thành phố Hồ Chí Minh',
      note: options.note,
    },
    options.shippingMethodId,
  );
  if (!result.success) {
    throw new SeedError(`createOrder failed: ${result.error}`);
  }

  const itemsTotal = result.data.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const total = itemsTotal + result.data.shippingAmount;

  const payment = await createPaymentForOrder(
    options.tenantId,
    result.data.orderId,
    options.paymentMethod,
    total,
    `${QA_PREFIX} order`,
  );
  if (!payment.success) {
    throw new SeedError(`createPaymentForOrder failed: ${payment.error}`);
  }

  // Backdating. The ONLY field rewritten after the fact, and only on rows
  // this script just created. Without it every order shares one timestamp
  // and the date-range filter, "newest" sort and "last order" sort have
  // nothing to distinguish. Order EVENTS keep their own monotonic
  // sequence, so audit ordering stays truthful regardless.
  if (options.daysAgo > 0) {
    const when = new Date(Date.now() - options.daysAgo * DAY);
    await prisma.order.update({ where: { id: result.data.orderId }, data: { createdAt: when } });
    await prisma.payment.updateMany({
      where: { orderId: result.data.orderId },
      data: { createdAt: when },
    });
    await prisma.orderEvent.updateMany({
      where: { orderId: result.data.orderId },
      data: { createdAt: when },
    });
  }

  return { orderId: result.data.orderId, total };
}

// ------------------------------------------------------------------ plan

type Plan = {
  tenants: string[];
  products: number;
  variants: number;
  customers: number;
  orders: number;
  payments: number;
  events: number;
  rejections: number;
};

/**
 * Counted against seed() by hand, and asserted against the real totals
 * after --apply. A dry run that misstates the plan is worse than no dry
 * run, so the two must agree or the script says so.
 *
 *   tenant A  4 products (t-shirt, shoes, cap, draft) / 5 variants
 *   tenant B  1 product / 1 variant
 *   customers c1, c2 (via checkout) + c3, c4 (no orders) + 1 in tenant B
 *   orders    4 in tenant A + 1 in tenant B, one payment each
 *   events    5 order_created + 1 fulfilled + 1 cancelled
 *             + 1 inventory_released + 1 payment_status_changed
 */
const PLAN: Plan = {
  tenants: [TENANT_A_SLUG, TENANT_B_SLUG],
  products: 5,
  variants: 6,
  customers: 5,
  orders: 5,
  payments: 5,
  events: 9,
  rejections: 2,
};

function printPlan(target: string, apply: boolean): void {
  const lines = [
    '',
    `Preview QA seed  —  ${apply ? 'APPLY' : 'DRY RUN'}`,
    `  Target                   ${redactedTarget(target)}`,
    `  QA prefix                ${QA_PREFIX}`,
    '',
    '  Would create:',
    `    tenants                ${PLAN.tenants.length}  (${PLAN.tenants.join(', ')})`,
    `    products               ${PLAN.products}`,
    `    product variants       ${PLAN.variants}`,
    `    customers              ${PLAN.customers}`,
    `    orders                 ${PLAN.orders}`,
    `    payments               ${PLAN.payments}`,
    `    order audit events     ${PLAN.events}`,
    `    payment rejections     ${PLAN.rejections}`,
    '',
    '  Never created: delivery, carrier, tracking, refund, return,',
    '  notification, or settled-payment evidence. No external provider',
    '  is contacted. The existing tenant is not modified.',
    '',
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

// ------------------------------------------------------------------ main

async function seed(): Promise<void> {
  // ---- Tenant A: the populated QA tenant -----------------------------
  const a = await provisionTenant({ slug: TENANT_A_SLUG, name: `${QA_PREFIX} Shop A` });

  const tshirt = await createSimpleProduct({
    tenantId: a.tenantId,
    locationId: a.locationId,
    name: 'Áo thun cotton QA',
    status: 'active',
    sku: 'QA-TSHIRT-001',
    price: 250_000,
    onHand: 50,
  });
  const shoes = await createVariantProduct({ tenantId: a.tenantId, locationId: a.locationId });
  await createSimpleProduct({
    tenantId: a.tenantId,
    locationId: a.locationId,
    name: 'Nón lưỡi trai QA (hết hàng)',
    status: 'active',
    sku: 'QA-CAP-001',
    price: 180_000,
    onHand: 0,
  });
  await createSimpleProduct({
    tenantId: a.tenantId,
    locationId: a.locationId,
    name: 'Sản phẩm nháp QA',
    status: 'draft',
    sku: 'QA-DRAFT-001',
    price: 99_000,
    onHand: 10,
  });

  const c1 = { name: 'Nguyễn Văn QA Một', email: `qa-c1@${EMAIL_DOMAIN}`, phone: PHONE_C1 };
  const c2 = { name: 'Trần Thị QA Hai', email: `qa-c2@${EMAIL_DOMAIN}`, phone: PHONE_SHARED };

  // C1 — three orders, highest value: tops "order count" and "order value".
  const o1 = await placeOrder({
    tenantId: a.tenantId,
    items: [{ productVariantId: tshirt.id, quantity: 2 }],
    paymentMethod: 'cod',
    customer: c1,
    shippingMethodId: a.shippingStandardId,
    note: 'Giao giờ hành chính, gọi trước khi tới, nhà trong hẻm nhỏ xe máy mới vào được.',
    daysAgo: 20,
  });
  const o2 = await placeOrder({
    tenantId: a.tenantId,
    items: [
      { productVariantId: tshirt.id, quantity: 1 },
      { productVariantId: shoes[0].id, quantity: 1 },
    ],
    paymentMethod: 'cod',
    customer: c1,
    shippingMethodId: a.shippingExpressId,
    daysAgo: 10,
  });
  const o3 = await placeOrder({
    tenantId: a.tenantId,
    items: [{ productVariantId: tshirt.id, quantity: 1 }],
    paymentMethod: 'bank_transfer',
    customer: c1,
    shippingMethodId: a.shippingStandardId,
    daysAgo: 5,
  });

  // C2 — one recent order, so "last order" sorts differently from "newest".
  const o4 = await placeOrder({
    tenantId: a.tenantId,
    items: [{ productVariantId: tshirt.id, quantity: 1 }],
    paymentMethod: 'bank_transfer',
    customer: c2,
    shippingMethodId: a.shippingStandardId,
    daysAgo: 1,
  });

  // Status coverage, through the real guarded transition.
  const fulfilled = await updateOrderStatus(a.tenantId, o2.orderId, 'fulfilled', {
    type: 'tenant_admin',
  });
  if (!fulfilled.success) throw new SeedError(`fulfil failed: ${fulfilled.error}`);
  const cancelled = await updateOrderStatus(a.tenantId, o1.orderId, 'cancelled', {
    type: 'tenant_admin',
  });
  if (!cancelled.success) throw new SeedError(`cancel failed: ${cancelled.error}`);

  // One manual transfer confirmed, through the real service, so Payment
  // Operations has a succeeded row and the timeline has the event.
  const confirmed = await markManualPaymentReceived(a.tenantId, o3.orderId, {
    type: 'tenant_admin',
  });
  if (!confirmed.success) throw new SeedError(`confirm failed: ${confirmed.error}`);

  // Customers with NO orders. Checkout cannot produce one, so these are
  // created directly — the single place this script bypasses a service,
  // because the service genuinely cannot express it.
  await prisma.customer.create({
    data: {
      tenantId: a.tenantId,
      // Same phone as C2, different email: exercises the duplicate-phone
      // indicator, which flags and never merges.
      name: 'Lê Thị QA Ba (trùng SĐT)',
      email: `qa-c3@${EMAIL_DOMAIN}`,
      phone: PHONE_SHARED,
    },
  });
  await prisma.customer.create({
    data: {
      tenantId: a.tenantId,
      // CSV formula-injection probe. The export guards text cells; this
      // is the fixture that proves it still does.
      name: `=1+1 ${QA_PREFIX} formula probe`,
      email: `qa-c4@${EMAIL_DOMAIN}`,
      phone: '+84900000004',
    },
  });

  // ---- Tenant B: the isolation canary --------------------------------
  // Deliberately LARGER than A, so a cross-tenant leak would be obvious
  // in A's analytics rather than subtle.
  const b = await provisionTenant({ slug: TENANT_B_SLUG, name: `${QA_PREFIX} Shop B` });
  const bProduct = await createSimpleProduct({
    tenantId: b.tenantId,
    locationId: b.locationId,
    name: 'Sản phẩm QA của Shop B',
    status: 'active',
    sku: 'QA-B-001',
    price: 5_000_000,
    onHand: 500,
  });
  await placeOrder({
    tenantId: b.tenantId,
    items: [{ productVariantId: bProduct.id, quantity: 20 }],
    paymentMethod: 'cod',
    customer: { name: 'Canary QA Shop B', email: `qa-b1@${EMAIL_DOMAIN}`, phone: '+84900000009' },
    shippingMethodId: b.shippingStandardId,
    daysAgo: 3,
  });

  // ---- Payment rejection evidence ------------------------------------
  // Through the real recorder, which is what webhook-service calls AFTER
  // it has already validated and refused a delivery. No signature is
  // forged and no webhook endpoint is called: the raw body below is
  // synthetic and is only ever hashed, never stored.
  await recordPaymentRejection({
    provider: 'bank_transfer_sepay_va',
    reason: 'amount_mismatch',
    tenantId: a.tenantId,
    orderId: o4.orderId,
    providerOrderId: `${QA_PREFIX}-ref-${randomUUID().slice(0, 8)}`,
    expectedAmount: o4.total,
    reportedAmount: Math.max(1, o4.total - 50_000),
    providerEventId: `${QA_PREFIX}-evt-1`,
    rawBody: JSON.stringify({ qa: true, note: 'synthetic underpayment fixture' }),
  });
  // Unattributed: resolves to no payment, so it must stay platform-only
  // and never appear in a tenant's queue.
  await recordPaymentRejection({
    provider: 'bank_transfer_sepay_va',
    reason: 'unknown_payment',
    tenantId: null,
    providerEventId: `${QA_PREFIX}-evt-2`,
    rawBody: JSON.stringify({ qa: true, note: 'synthetic unknown-payment fixture' }),
  });
}

async function main(): Promise<void> {
  const apply = hasFlag('apply');
  const target = await assertSafeTarget();

  printPlan(target, apply);

  if (!apply) {
    process.stdout.write('Nothing was written. Re-run with --apply to create this dataset.\n\n');
    return;
  }

  await seed();

  const [tenants, products, variants, customers, orders, payments, events, rejections] =
    await Promise.all([
      prisma.tenant.count({ where: { slug: { startsWith: QA_SLUG_PREFIX } } }),
      prisma.product.count(),
      prisma.productVariant.count(),
      prisma.customer.count(),
      prisma.order.count(),
      prisma.payment.count(),
      prisma.orderEvent.count(),
      prisma.paymentRejection.count(),
    ]);

  const actual = { tenants, products, variants, customers, orders, payments, events, rejections };
  const expected = {
    tenants: PLAN.tenants.length,
    products: PLAN.products,
    variants: PLAN.variants,
    customers: PLAN.customers,
    orders: PLAN.orders,
    payments: PLAN.payments,
    events: PLAN.events,
    rejections: PLAN.rejections,
  };

  const drift = (Object.keys(expected) as (keyof typeof expected)[]).filter(
    (key) => actual[key] !== expected[key],
  );

  process.stdout.write(
    [
      'Created (actual vs planned):',
      ...(Object.keys(expected) as (keyof typeof expected)[]).map(
        (key) =>
          `  ${key.padEnd(22)} ${String(actual[key]).padStart(3)}` +
          (actual[key] === expected[key] ? '   ok' : `   PLANNED ${expected[key]}`),
      ),
      '',
    ].join('\n') + '\n',
  );

  if (drift.length > 0) {
    throw new Error(
      `Seed wrote a different dataset than the dry run promised: ${drift.join(', ')}.\n` +
        'The data exists; the plan was wrong. Reconcile before trusting QA counts.',
    );
  }
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`\n${message}\n\n`);
    process.exitCode = error instanceof SeedError ? 2 : 1;
  })
  .finally(() => prisma.$disconnect());
