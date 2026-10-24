// Notifications: a capability audit expressed as tests.
//
// The finding is that this application cannot send, queue, or prove the
// delivery of anything. These tests keep that true, and make adding a
// notification feature a deliberate act rather than something that
// slips in with a provider SDK.
//
// They also pin the distinctions that are easiest to collapse: contact
// details are not consent, an accepted API call is not a delivery, and a
// fulfilled order is not a delivered parcel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

function source(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

function code(relativePath: string): string {
  return source(relativePath)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function walk(dir: string, filename: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(root, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(root, rel)).isDirectory()) walk(rel, filename, out);
    else if (entry === filename) out.push(rel);
  }
  return out;
}

const SRC_FILES = (function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(root, dir))) {
    const rel = `${dir}/${entry}`;
    if (rel.startsWith('src/generated')) continue;
    if (statSync(join(root, rel)).isDirectory()) collect(rel, out);
    else if (/\.tsx?$/.test(entry)) out.push(rel);
  }
  return out;
})('src');

// ---------- no provider, no transport, no scheduler ----------

test('no notification provider dependency is installed', () => {
  const pkg = JSON.parse(source('package.json')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const installed = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const transports =
    /mail|smtp|sendgrid|resend|postmark|twilio|nodemailer|zalo|firebase|^sns$|^ses$|onesignal|pusher/i;
  const schedulers = /^bull|^bee-queue|agenda|node-cron|^cron$|bullmq|graphile-worker|pg-boss/i;

  for (const name of installed) {
    assert.ok(!transports.test(name), `${name} looks like a message transport`);
    assert.ok(!schedulers.test(name), `${name} looks like a queue or scheduler`);
  }
});

test('no notification provider is configured by environment', () => {
  // Every env var the application reads. None of them configures a
  // message transport, so nothing could be sent even accidentally.
  const referenced = new Set<string>();
  for (const file of [...SRC_FILES, ...walk('scripts', 'ts' as string).filter(() => false)]) {
    for (const match of source(file).matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      referenced.add(match[1]);
    }
  }
  assert.ok(referenced.size > 0, 'the scan actually found environment variables');

  for (const name of referenced) {
    assert.ok(
      !/MAIL|SMTP|SENDGRID|RESEND|POSTMARK|TWILIO|ZALO|SMS|NOTIF/i.test(name),
      `${name} suggests a notification provider is configured`,
    );
  }
});

test('no module sends, queues or schedules a message', () => {
  for (const file of SRC_FILES) {
    const body = code(file);
    for (const forbidden of [
      /\bsendMail\b/,
      /\bsendEmail\b/,
      /\bsendSms\b/,
      /\bsendMessage\b/,
      /\benqueue\b/,
      /\bscheduleJob\b/,
      /\boutbox\b/i,
      /\bdeadLetter\b/i,
    ]) {
      assert.doesNotMatch(body, forbidden, `${file} matches ${forbidden}`);
    }
  }
});

// ---------- contact is not consent ----------

test('CONTACT DETAILS ARE NOT CONSENT — no consent or preference field exists', () => {
  const schema = source('prisma/schema.prisma');
  const customer = schema.slice(schema.indexOf('model Customer {'));
  const body = customer.slice(0, customer.indexOf('\n}'));

  // Contact details exist.
  assert.match(body, /email\s+String/);
  assert.match(body, /phone\s+String/);

  // Permission to use them does not.
  for (const absent of [
    /consent/i,
    /optIn/i,
    /optOut/i,
    /unsubscrib/i,
    /marketing/i,
    /preference/i,
    /zaloId/i,
  ]) {
    assert.doesNotMatch(body, absent, `Customer unexpectedly has ${absent}`);
  }
});

test('no code treats the presence of an email or phone as permission', () => {
  // A customer's contact fields are used for order lookup and for the
  // documents a merchant prints. Nothing reads them to decide whether a
  // message may be sent, because no such decision exists.
  for (const file of SRC_FILES) {
    const body = code(file);
    assert.doesNotMatch(body, /canNotify|mayContact|isSubscribed|hasConsent/i, `${file}`);
  }
});

// ---------- no delivery state can be claimed ----------

test('no model records a notification, its status, or its history', () => {
  // Comments stripped and field names anchored: "representation" in a
  // comment should not read as a sentAt column.
  const schema = source('prisma/schema.prisma')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  for (const absent of [
    /model\s+Notification/i,
    /model\s+Message/i,
    /model\s+Outbox/i,
    /\bproviderMessageId\b/i,
    /\bdeliveredAt\b/i,
    /\bsentAt\b/i,
    /\bretryCount\b/i,
    /\btemplateKey\b/i,
  ]) {
    assert.doesNotMatch(schema, absent, `the schema unexpectedly contains ${absent}`);
  }
});

test('nothing claims a MESSAGE was sent, accepted or delivered', () => {
  // Matching the bare word "delivered" is the wrong test: this codebase
  // legitimately says "delivery address", "webhook delivery", and — in
  // the fulfillment page and the guide — that it does NOT report
  // delivery. What must never appear is a claim about a MESSAGE.
  const claims = [
    /message\s+(was\s+)?(sent|delivered|accepted)/i,
    /notification\s+(was\s+)?(sent|delivered)/i,
    /email\s+(was\s+)?(sent|delivered)/i,
    /sms\s+(was\s+)?(sent|delivered)/i,
    /customer\s+(was\s+)?(notified|contacted)/i,
    /đã gửi (tin nhắn|email|thông báo)/i,
    /đã thông báo cho khách/i,
  ];
  for (const file of SRC_FILES) {
    const body = code(file);
    for (const claim of claims) {
      assert.doesNotMatch(body, claim, `${file} claims ${claim}`);
    }
  }
});

// ---------- facts that must not trigger a claim ----------

test('FULFILLED IS NOT DELIVERED — no shipment or delivery event exists', () => {
  const events = code('src/lib/order-events.ts');
  const block = events.slice(events.indexOf('export type OrderEventType'));
  const body = block.slice(0, block.indexOf(';'));
  for (const absent of ['shipped', 'delivered', 'dispatched', 'picked_up', 'in_transit']) {
    assert.ok(!body.includes(absent), `the event vocabulary must not contain ${absent}`);
  }
});

test('a pending COD payment is not a payment confirmation', async () => {
  const { classifyOrder } = await import('../src/lib/fulfillment-queue');
  const cod = classifyOrder({
    orderStatus: 'pending',
    paymentMethod: 'cod',
    paymentStatus: 'pending',
    hasShippingMethod: true,
  });
  // Ready to prepare, which is an internal readiness statement — not a
  // statement that the customer has paid.
  assert.equal(cod.category, 'ready_to_fulfill');
  assert.notEqual(cod.category, 'paid' as unknown as typeof cod.category);
});

test('no refund notification can exist, because no refund evidence does', () => {
  const schema = source('prisma/schema.prisma');
  assert.doesNotMatch(schema, /model\s+Refund/i);
  for (const file of SRC_FILES) {
    const body = code(file);
    assert.doesNotMatch(body, /notifyRefund|refundNotification/i, `${file}`);
  }
});

// ---------- no surface, no action, no route ----------

test('no admin surface offers to contact a customer', () => {
  const pages = [
    ...walk('src/app/tenant-admin', 'page.tsx'),
    ...walk('src/app/platform-admin', 'page.tsx'),
  ];
  assert.ok(pages.length > 10, 'the page scan actually found pages');

  for (const page of pages) {
    const body = code(page);
    for (const action of [
      /Email customer/i,
      /Send SMS/i,
      /Send Zalo/i,
      /Resend notification/i,
      /Send test/i,
      /Notify customer/i,
    ]) {
      assert.doesNotMatch(body, action, `${page} offers ${action}`);
    }
  }
});

test('no Server Action could record or send a notification', () => {
  const actions = code('src/app/tenant-admin/actions.ts');
  assert.doesNotMatch(actions, /notif/i);
  assert.doesNotMatch(actions, /sendM|mail|sms/i);
});

test('no notification route exists', () => {
  const routes = [
    ...walk('src/app/tenant-admin', 'page.tsx'),
    ...walk('src/app/tenant-admin', 'route.ts'),
    ...walk('src/app/platform-admin', 'page.tsx'),
    ...walk('src/app/api', 'route.ts'),
  ];
  for (const route of routes) {
    assert.ok(!/notification|messages?\//i.test(route), `${route} looks like a notification route`);
  }
});

// ---------- the documented position ----------

test('the capability audit is documented and says notifications are unsupported', () => {
  // Prose wraps, so every prose assertion tolerates a line break.
  const doc = source('docs/notifications.md').replace(/\s+/g, ' ');
  assert.match(doc, /not supported/i);
  assert.match(doc, /Outcome A/);

  // The distinctions the audit exists to protect.
  assert.match(doc, /contact[\s\S]{0,20}(is|are) not consent/i);
  assert.match(doc, /accept/i);
  assert.match(doc, /deliver/i);

  // And none of the claims it exists to prevent.
  for (const claim of [
    /message was sent/i,
    /customer was notified/i,
    /provider accepted the message/i,
    /marketing consent (is|was) (obtained|recorded)/i,
  ]) {
    assert.doesNotMatch(doc, claim, `the document makes the claim ${claim}`);
  }
});

test('the reliable trigger events are documented honestly', () => {
  const doc = source('docs/notifications.md').replace(/\s+/g, ' ');
  // The four events that genuinely exist, and the ones that do not.
  for (const present of [
    'order_created',
    'order_status_changed',
    'payment_status_changed',
    'inventory_released',
  ]) {
    assert.ok(doc.includes(present), `the document should list ${present}`);
  }
  assert.match(doc, /shipment/i, 'it must say shipment events do not exist');
  assert.match(doc, /no delivery evidence/i);
});
