/**
 * Creates a LOCAL tenant carrying a tenant id you choose, plus enough
 * synthetic data to exercise the admin screens.
 *
 * WHY THIS EXISTS. requireTenantAdmin() authorizes only when the Clerk
 * user's publicMetadata.tenantId equals the tenant resolved from the
 * request hostname. A Clerk account set up for Preview therefore cannot
 * sign in to a local tenant, because local tenants have different ids.
 *
 * The obvious fix — repointing the Clerk account at a local tenant id —
 * breaks that account everywhere else. This does the opposite: it gives
 * the LOCAL database a tenant with the id the account already carries,
 * so one account works in both places and nothing about Clerk changes.
 *
 * LOCAL ONLY. It refuses any target that is not localhost, and it never
 * touches an existing tenant. Everything it writes belongs to the tenant
 * it creates, so removing that tenant removes all of it.
 *
 * Usage:
 *   npx tsx scripts/seed-local-qa-tenant.ts --tenant-id=<uuid> [--slug=qa-local] [--apply]
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { createOrder, updateOrderStatus } from '../src/lib/order-mutations';
import { createPaymentForOrder } from '../src/lib/payments/payment-service';

const DAY = 24 * 60 * 60 * 1000;

function flag(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
}

class SeedError extends Error {}

/**
 * The only guard that matters. A tenant id is not a secret and a slug is
 * not a safety mechanism; the host is. Anything that is not loopback is
 * refused outright, so this cannot reach Preview or Production even if
 * DATABASE_URL is pointed at one by mistake.
 */
async function assertLocal(): Promise<string> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new SeedError('DATABASE_URL is not set.');

  const host = new URL(url).hostname;
  if (!/^(localhost|127\.0\.0\.1|::1)$/.test(host)) {
    throw new SeedError(
      `Refusing to run: DATABASE_URL points at "${host}", which is not local.\n` +
        'This script only ever seeds a local development database.',
    );
  }
  return host;
}

async function main() {
  const host = await assertLocal();
  const tenantId = flag('tenant-id');
  const slug = flag('slug') ?? 'qa-local';
  const apply = process.argv.includes('--apply');

  if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
    throw new SeedError('--tenant-id=<uuid> is required (the id your Clerk account points at).');
  }

  // Narrowed once, so the closures below see a plain string rather than
  // string | undefined.
  const tid: string = tenantId;

  const existing = await prisma.tenant.findFirst({
    where: { OR: [{ id: tid }, { slug }] },
    select: { id: true, slug: true },
  });
  if (existing) {
    throw new SeedError(
      `A tenant already exists (slug "${existing.slug}"). Remove it first, deliberately.`,
    );
  }

  const hostname = `${slug}.localhost`;
  process.stdout.write(
    [
      '',
      `Local QA tenant  —  ${apply ? 'APPLY' : 'DRY RUN'}`,
      `  Database      ${host}`,
      `  Tenant id     ${tid}`,
      `  Slug          ${slug}`,
      `  Hostname      http://${hostname}:3000/tenant-admin`,
      '',
      '  Would create: 1 tenant, 1 domain, 1 location, 2 shipping methods,',
      '  2 payment methods, 3 products, 3 customers, 4 orders, 4 payments.',
      '',
    ].join('\n') + '\n',
  );

  if (!apply) {
    process.stdout.write('Nothing written. Re-run with --apply.\n\n');
    return;
  }

  await prisma.tenant.create({
    data: { id: tid, slug, name: 'QA Local Shop', status: 'active' },
  });
  await prisma.domain.create({
    data: { tenantId, hostname, type: 'subdomain', isPrimary: true },
  });
  await prisma.branding.create({
    data: { tenantId, storeName: 'QA Local Shop', primaryColor: '#0f6b63' },
  });
  const location = await prisma.location.create({
    data: { tenantId, name: 'Kho QA', isDefault: true },
  });
  const standard = await prisma.tenantShippingMethod.create({
    data: {
      tenantId: tid,
      name: 'Giao hàng tiêu chuẩn',
      amount: 30_000,
      enabled: true,
      isDefault: true,
      sortOrder: 0,
    },
  });
  const express = await prisma.tenantShippingMethod.create({
    data: { tenantId, name: 'Giao hàng nhanh', amount: 60_000, enabled: true, sortOrder: 1 },
  });
  await prisma.tenantPaymentMethod.create({
    data: { tenantId, method: 'cod', provider: 'cod', enabled: true },
  });
  await prisma.tenantPaymentMethod.create({
    data: {
      tenantId: tid,
      method: 'bank_transfer',
      provider: 'bank_transfer_manual',
      enabled: true,
      config: {
        bankName: 'QA TEST BANK (khong co that)',
        accountNumber: '0000000000',
        accountHolder: 'QA LOCAL TEST',
      },
    },
  });

  // One product reuses an existing local media URL so the storefront has
  // a real picture to show; the other two deliberately have none, which
  // is what the "Thiếu ảnh" badge and the card placeholder exist for.
  const borrowed = await prisma.productMedia.findFirst({ select: { url: true, type: true } });

  async function product(name: string, price: number, sku: string, onHand: number, media: boolean) {
    const p = await prisma.product.create({
      data: { tenantId: tid, name, status: 'active', description: 'Sản phẩm QA tạo tự động.' },
    });
    const v = await prisma.productVariant.create({
      data: { tenantId: tid, productId: p.id, price, sku, status: 'active', combinationKey: '' },
    });
    await prisma.inventory.create({
      data: { tenantId: tid, productVariantId: v.id, locationId: location.id, onHand },
    });
    if (media && borrowed) {
      await prisma.productMedia.create({
        data: { tenantId: tid, productId: p.id, url: borrowed.url, type: borrowed.type, sortOrder: 0 },
      });
    }
    return v.id;
  }

  const tote = await product('Áo thun QA', 250_000, 'QA-L-TSHIRT', 50, true);
  const pin = await product('Nón QA (chưa có ảnh)', 180_000, 'QA-L-CAP', 8, false);
  await product('Túi QA (chưa có ảnh)', 320_000, 'QA-L-BAG', 3, false);

  async function order(opts: {
    name: string;
    email: string;
    phone: string;
    variantId: string;
    qty: number;
    shippingMethodId: string;
    daysAgo: number;
  }) {
    const r = await createOrder(
      tid,
      [{ productVariantId: opts.variantId, quantity: opts.qty }],
      'cod',
      { name: opts.name, email: opts.email, phone: opts.phone },
      {
        address: '123 Đường Nguyễn Huệ, Toà nhà QA, Tầng 12',
        ward: 'Phường Bến Nghé',
        district: 'Quận 1',
        city: 'Thành phố Hồ Chí Minh',
        note: 'Giao giờ hành chính, gọi trước khi tới.',
      },
      opts.shippingMethodId,
    );
    if (!r.success) throw new SeedError(`createOrder: ${r.error}`);
    const total =
      r.data.items.reduce((s, i) => s + i.price * i.quantity, 0) + r.data.shippingAmount;
    const pay = await createPaymentForOrder(tid, r.data.orderId, 'cod', total, 'QA local');
    if (!pay.success) throw new SeedError(`createPaymentForOrder: ${pay.error}`);

    const when = new Date(Date.now() - opts.daysAgo * DAY);
    await prisma.order.update({ where: { id: r.data.orderId }, data: { createdAt: when } });
    await prisma.payment.updateMany({ where: { orderId: r.data.orderId }, data: { createdAt: when } });
    await prisma.orderEvent.updateMany({
      where: { orderId: r.data.orderId },
      data: { createdAt: when },
    });
    return r.data.orderId;
  }

  const c1 = { name: 'Nguyễn Văn QA', email: 'qa-local-1@example.invalid', phone: '+84900000001' };
  const c2 = { name: 'Trần Thị QA', email: 'qa-local-2@example.invalid', phone: '+84900000002' };

  const o1 = await order({ ...c1, variantId: tote, qty: 2, shippingMethodId: standard.id, daysAgo: 12 });
  const o2 = await order({ ...c1, variantId: pin, qty: 1, shippingMethodId: express.id, daysAgo: 6 });
  await order({ ...c1, variantId: tote, qty: 1, shippingMethodId: standard.id, daysAgo: 2 });
  await order({ ...c2, variantId: tote, qty: 1, shippingMethodId: standard.id, daysAgo: 1 });

  await updateOrderStatus(tid, o2, 'fulfilled', { type: 'tenant_admin' });
  await updateOrderStatus(tid, o1, 'cancelled', { type: 'tenant_admin' });

  // Shares c2's phone with a different email, so the duplicate-phone
  // badge has something to flag. Checkout cannot create a customer with
  // no orders, so this one is created directly.
  await prisma.customer.create({
    data: {
      tenantId: tid,
      name: 'Lê Thị QA (trùng SĐT)',
      email: `qa-local-3-${randomUUID().slice(0, 4)}@example.invalid`,
      phone: c2.phone,
    },
  });

  const [products, customers, orders, events] = await Promise.all([
    prisma.product.count({ where: { tenantId: tid } }),
    prisma.customer.count({ where: { tenantId: tid } }),
    prisma.order.count({ where: { tenantId: tid } }),
    prisma.orderEvent.count({ where: { tenantId: tid } }),
  ]);

  process.stdout.write(
    [
      'Created:',
      `  products   ${products}`,
      `  customers  ${customers}`,
      `  orders     ${orders}`,
      `  events     ${events}`,
      '',
      `Sign in at  http://${hostname}:3000/tenant-admin`,
      '',
      'To remove everything this created:',
      `  npx prisma db execute --stdin <<< 'DELETE FROM tenants WHERE id = '"'"'${tid}'"'"';'`,
      '',
    ].join('\n') + '\n',
  );
}

main()
  .catch((e) => {
    process.stderr.write(`\n${e instanceof Error ? e.message : String(e)}\n\n`);
    process.exitCode = e instanceof SeedError ? 2 : 1;
  })
  .finally(() => prisma.$disconnect());
