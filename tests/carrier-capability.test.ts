// Carrier and shipments: a capability audit expressed as tests.
//
// The finding is that this application cannot create a shipment, name a
// carrier, issue a tracking number, or prove that anything was picked
// up, delivered or collected. These tests keep that true, and make
// adding a carrier feature a deliberate act rather than something that
// arrives with an SDK.
//
// They also pin the distinctions a shipment feature is most tempted to
// collapse: a merchant's shipping method is not a carrier, a fulfilled
// order is not a shipped parcel, a printed COD amount is not collected
// cash, and a shipping note is not a waybill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { CATEGORY_LABEL, classifyOrder } from '../src/lib/fulfillment-queue';

const root = fileURLToPath(new URL('../', import.meta.url));

function source(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

/** Source with comments and prose stripped, so a disclaimer never satisfies a check. */
function code(relativePath: string): string {
  return source(relativePath)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
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

const SCHEMA = source('prisma/schema.prisma');

// ---------- 1. no shipment model ----------

test('no shipment model exists, and none is falsely treated as existing', () => {
  // The schema is the authority. A model block, not a passing mention.
  const models = [...SCHEMA.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
  for (const name of models) {
    assert.ok(
      !/shipment|parcel|consignment|waybill|delivery/i.test(name),
      `schema defines model ${name}; this audit says no shipment model exists`,
    );
  }

  // And nothing in application code may query one through Prisma.
  for (const file of SRC_FILES) {
    const src = code(file);
    assert.ok(
      !/\b(?:db|prisma|tx)\s*\.\s*shipment\b/.test(src),
      `${file} queries a shipment model that does not exist`,
    );
  }
});

// ---------- 2. no tracking number ----------

test('no tracking-number field exists or is exposed', () => {
  assert.ok(!/^\s*trackingNumber\b/m.test(SCHEMA), 'schema declares a trackingNumber column');

  for (const file of SRC_FILES) {
    const src = code(file);
    // A property or variable actually named for tracking — not Tailwind's
    // `tracking-wide`, which is letter-spacing and appears throughout.
    assert.ok(
      !/\btracking(?:Number|Code|Id)\b/i.test(src),
      `${file} references a tracking identifier that nothing issues`,
    );
  }
});

// ---------- 3. no carrier is invented ----------

test('no carrier name is invented anywhere in application source', () => {
  const carriers =
    /\b(?:GHN|GHTK|Viettel\s?Post|Ninja\s?Van|Ahamove|Lalamove|J&T|Best\s?Express|SPX|Shopee\s?Express|DHL|FedEx|UPS)\b/i;
  for (const file of SRC_FILES) {
    const src = code(file);
    const hit = carriers.exec(src);
    assert.ok(!hit, `${file} names carrier "${hit?.[0]}" though no carrier integration exists`);
  }
});

test('a shipping method is merchant free text, not a carrier key', () => {
  // If shippingMethodName were ever mapped to a carrier, there would be a
  // lookup keyed on it. There must not be one.
  for (const file of SRC_FILES) {
    const src = code(file);
    assert.ok(
      !/carrier(?:For|Key|By|From)\s*[([]/i.test(src) && !/CARRIER_(?:BY|FOR|MAP)/i.test(src),
      `${file} appears to resolve a carrier from a shipping method`,
    );
  }
  // The schema's own field stays a plain nullable string.
  assert.match(
    SCHEMA,
    /shippingMethodName\s+String\?/,
    'shippingMethodName must remain nullable free text',
  );
});

// ---------- 4-5. fulfilled is neither shipped nor delivered ----------

test('the order status enum contains no shipment state', () => {
  const block = /enum\s+OrderStatus\s*\{([^}]*)\}/.exec(SCHEMA);
  assert.ok(block, 'OrderStatus enum not found');
  const values = block[1]
    .replace(/\/\/[^\n]*/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  assert.deepEqual(values, ['pending', 'fulfilled', 'cancelled']);
});

test('FULFILLED IS NOT SHIPPED — no label renames it', () => {
  for (const [key, label] of Object.entries(CATEGORY_LABEL)) {
    assert.ok(
      !/\b(?:shipped|dispatched|picked\s?up|in\s?transit|delivered|en\s?route)\b/i.test(label),
      `category "${key}" is labelled "${label}", which claims shipment state`,
    );
  }
});

test('FULFILLED IS NOT DELIVERED — nothing maps the status to a delivery claim', () => {
  for (const file of SRC_FILES) {
    const src = code(file);
    // A conditional that turns the fulfilled status into delivery wording.
    assert.ok(
      !/['"`]fulfilled['"`][^\n]{0,80}\b(?:delivered|shipped|in\s?transit)\b/i.test(src),
      `${file} maps the fulfilled status to a delivery claim`,
    );
    assert.ok(
      !/\b(?:delivered|shipped)\b[^\n]{0,40}=[^\n=][^\n]{0,40}['"`]fulfilled['"`]/i.test(src),
      `${file} derives a delivery claim from the fulfilled status`,
    );
  }
});

test('fulfilling an order consumes reserved stock and touches no shipment concept', () => {
  const mutations = code('src/lib/order-mutations.ts');
  assert.match(
    mutations,
    /consumeReservedInventoryInTx/,
    'fulfilled must still mean the inventory movement it means today',
  );
  assert.ok(
    !/\b(?:shipment|carrier|tracking|dispatch)\b/i.test(mutations),
    'order-mutations.ts must not acquire shipment vocabulary',
  );
});

// ---------- 6. fulfilled does not imply COD collection ----------

test('COD stays pending after fulfillment and is never a payment blocker', () => {
  // A pending COD order is preparable — cash is settled with the courier.
  assert.deepEqual(
    classifyOrder({
      orderStatus: 'pending',
      paymentMethod: 'cod',
      paymentStatus: 'pending',
      hasShippingMethod: true,
    }),
    { category: 'ready_to_fulfill', blockers: [] },
  );

  // Fulfilling it does not make it paid: the category is the order's own
  // terminal state, and nothing anywhere reports collection.
  assert.equal(
    classifyOrder({
      orderStatus: 'fulfilled',
      paymentMethod: 'cod',
      paymentStatus: 'pending',
      hasShippingMethod: true,
    }).category,
    'fulfilled',
  );
});

test('no code claims COD cash was collected', () => {
  for (const file of SRC_FILES) {
    const src = code(file);
    assert.ok(
      !/\b(?:cod|cash)\s*(?:was\s*)?collected\b/i.test(src) && !/\bcodCollected\b/i.test(src),
      `${file} claims COD cash was collected; nothing records that`,
    );
  }
});

// ---------- 7-8. print documents ----------

test('the shipping note is not called an official carrier waybill', () => {
  const note = source('src/app/tenant-admin/orders/[orderId]/print/ShippingNoteDocument.tsx');
  assert.match(note, /not an official carrier label/, 'it must say what it is not');
  assert.ok(!/\bwaybill\b/i.test(note), 'it must not call itself a waybill');
});

test('no print document exposes a fake tracking, carrier or delivery field', () => {
  // The question is whether a document renders a VALUE it cannot have —
  // not whether the words appear. The shipping note's footer says "No
  // tracking number is issued by this store", which is the honest
  // disclosure this phase exists to protect, so a bare phrase match
  // would fail on exactly the sentence we want to keep.
  //
  // Everything these documents display comes from PrintableOrder via a
  // JSX expression, so the precise check is: no interpolated expression
  // may name a shipment field, and the type may not offer one.
  const printable = code('src/lib/order-print.ts');
  const forbiddenField =
    /\b(?:trackingNumber|trackingCode|carrierName|carrierKey|waybill|labelUrl|deliveredAt|pickedUpAt|estimatedDelivery)\b/i;
  assert.ok(
    !forbiddenField.test(printable),
    'PrintableOrder offers a shipment field that nothing stores',
  );

  const dir = 'src/app/tenant-admin/orders/[orderId]/print';
  const documents = readdirSync(join(root, dir)).filter((f) => f.endsWith('.tsx'));
  assert.ok(documents.length >= 3, 'expected the three print documents');

  for (const file of documents) {
    const src = code(`${dir}/${file}`);
    for (const expression of src.match(/\{[^{}]*\}/g) ?? []) {
      assert.ok(
        !forbiddenField.test(expression) &&
          !/\b(?:tracking|carrier|waybill|barcode)\b/i.test(expression),
        `${file} renders ${expression.trim()}, a shipment value with no stored evidence`,
      );
    }
  }
});

test('the printed COD amount is an instruction to collect, never a record of collection', () => {
  const print = code('src/lib/order-print.ts');
  // Derived from the order's own payment method and total, nothing else.
  assert.match(print, /paymentMethod === 'cod' \? total : null/);
  const note = source('src/app/tenant-admin/orders/[orderId]/print/ShippingNoteDocument.tsx');
  assert.match(note, /Collect on delivery/, 'the heading states an instruction');
  assert.ok(!/\bcollected\b/i.test(note), 'the note must never say the amount was collected');
});

// ---------- 9-10. no carrier call, no carrier dependency ----------

test('no carrier SDK or logistics dependency is installed', () => {
  const pkg = JSON.parse(source('package.json')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const installed = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const carrierish =
    /ghn|ghtk|viettel|ninjavan|ahamove|lalamove|giaohang|shippo|easypost|aftership|shipengine|dhl|fedex|^ups$/i;

  for (const name of installed) {
    assert.ok(
      !carrierish.test(name),
      `${name} is installed; this audit says no carrier SDK exists`,
    );
  }
});

test('no carrier API is called from application source', () => {
  // Every outbound fetch in the repo must be a payment provider. A new
  // one pointing at a logistics host fails here.
  for (const file of SRC_FILES) {
    const src = code(file);
    const urls = src.match(/https?:\/\/[^\s'"`)]+/g) ?? [];
    for (const url of urls) {
      assert.ok(
        !/ghn|ghtk|viettelpost|ninjavan|ahamove|lalamove|giaohangnhanh|giaohangtietkiem/i.test(url),
        `${file} contacts a carrier endpoint: ${url}`,
      );
    }
  }
});

// ---------- 11. no shipment route ----------

test('no shipment, tracking or carrier route is exposed', () => {
  const routes = (function collect(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(join(root, dir))) {
      const rel = `${dir}/${entry}`;
      if (statSync(join(root, rel)).isDirectory()) collect(rel, out);
      else if (/^(?:page|route)\.tsx?$/.test(entry)) out.push(rel);
    }
    return out;
  })('src/app');

  for (const route of routes) {
    assert.ok(
      !/\/(?:shipments?|tracking|carriers?|delivery)\//.test(route),
      `${route} exposes a shipment surface with no shipment model behind it`,
    );
  }
});

// ---------- 12. no delivery state rendered without evidence ----------

test('no admin surface offers a shipment action it cannot perform', () => {
  for (const file of SRC_FILES.filter((f) => f.endsWith('.tsx'))) {
    const src = code(file);
    for (const forbidden of [
      /mark\s+as\s+shipped/i,
      /mark\s+as\s+delivered/i,
      /assign\s+(?:a\s+)?carrier/i,
      /add\s+tracking/i,
      /(?:create|book)\s+(?:a\s+)?shipment/i,
      /(?:print|generate)\s+(?:a\s+)?(?:shipping\s+)?label/i,
      /schedule\s+(?:a\s+)?pickup/i,
    ]) {
      assert.ok(!forbidden.test(src), `${file} offers ${forbidden}, which nothing implements`);
    }
  }
});

test('the fulfillment workspace states it is not a shipment system', () => {
  const page = source('src/app/tenant-admin/fulfillment/page.tsx');
  assert.match(page, /internal queue, not a shipment or carrier system/);
  assert.match(page, /no tracking number/);
  // And it keeps the fulfilled/shipped distinction explicit.
  assert.match(page, /not[\s\S]{0,40}shipped[\s\S]{0,40}delivered/i);
});

// ---------- 13. no carrier credential configuration ----------

test('no carrier credential or account configuration is claimed', () => {
  for (const file of SRC_FILES) {
    const src = code(file);
    const envs = src.match(/process\.env\.[A-Z0-9_]+/g) ?? [];
    for (const env of envs) {
      assert.ok(
        !/GHN|GHTK|VIETTEL|NINJA|AHAMOVE|LALAMOVE|CARRIER|SHIPPING_API|LOGISTICS/i.test(env),
        `${file} reads ${env}; no carrier credential exists`,
      );
    }
  }

  // The tenant-scoped shipping model stays a flat-rate list with no
  // credential, token or account column.
  const block = /model\s+TenantShippingMethod\s*\{([^}]*)\}/.exec(SCHEMA);
  assert.ok(block, 'TenantShippingMethod not found');
  assert.ok(
    !/(?:apiKey|token|secret|credential|carrierAccount|webhookSecret)/i.test(block[1]),
    'TenantShippingMethod must not gain credential fields without a designed secret store',
  );
});

// ---------- 14. no shipping event persisted as delivery evidence ----------

test('the order event vocabulary cannot express a shipment', () => {
  const block = /enum\s+OrderEventType\s*\{([^}]*)\}/.exec(SCHEMA);
  assert.ok(block, 'OrderEventType enum not found');
  const values = block[1]
    .replace(/\/\/[^\n]*/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  assert.deepEqual(values, [
    'order_created',
    'order_status_changed',
    'payment_status_changed',
    'inventory_released',
  ]);
});

test('no webhook route can record a delivery', () => {
  const webhooks = ['src/app/api/momo/webhook/route.ts', 'src/app/api/webhooks/sepay/route.ts'];
  for (const file of webhooks) {
    const src = code(file);
    assert.ok(
      !/\b(?:shipment|tracking|delivered|carrier|pickup)\b/i.test(src),
      `${file} accepts shipment vocabulary; both webhooks are payment-only`,
    );
  }
});

test('the payment provider interface has no carrier operation', () => {
  const provider = code('src/lib/payments/provider.ts');
  const methods = [...provider.matchAll(/^\s{2}(\w+)\(/gm)].map((m) => m[1]);
  assert.deepEqual(methods.sort(), ['cancelPayment', 'createPayment', 'handleWebhook']);
});

test('the shipping snapshot on an order is never mutated after creation', () => {
  // The immutability of the destination is load-bearing for any future
  // shipment: a label is printed against it.
  for (const file of SRC_FILES) {
    const src = code(file);
    const updates = src.match(/\.update(?:Many)?\s*\(\s*\{[\s\S]{0,400}?\}\s*\)/g) ?? [];
    for (const update of updates) {
      if (!/\border\b/i.test(update)) continue;
      assert.ok(
        !/shippingAddress|shippingWard|shippingDistrict|shippingCity|shippingMethodName|shippingAmount/.test(
          update,
        ),
        `${file} mutates an order's shipping snapshot`,
      );
    }
  }
});

// ---------- the documentation itself ----------

test('the carrier audit documents the outcome and the limits it claims', () => {
  const doc = source('docs/carrier-readiness.md');
  assert.match(doc, /Outcome A/, 'the chosen outcome must be stated');
  assert.match(doc, /no shipment model/i);
  assert.match(doc, /Nothing records that cash was collected/i);
  assert.match(doc, /`delivered` may only ever\s+be written from a verified carrier event/);
  // The unresolved decisions are the reason Outcome B was rejected, so
  // they must be written down rather than silently encoded.
  for (const decision of [
    /split shipments/i,
    /partial fulfillment/i,
    /cancellation after handoff/i,
    /carrier fee reconciliation/i,
    /label reprint/i,
  ]) {
    assert.match(doc, decision);
  }
});
