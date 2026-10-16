// Tenant Admin user guide: entry point, coverage, privacy and structure.
// Content and routing assertions — the guide reads no tenant data, so
// there are no fixtures and nothing to clean up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { HELP_SECTIONS, QUICK_START } from "../src/app/tenant-admin/help/help-content";

const root = fileURLToPath(new URL("../", import.meta.url));

function source(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

function code(relativePath: string): string {
  return source(relativePath)
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Every real Tenant Admin route, from the filesystem. */
function tenantAdminRoutes(dir = "src/app/tenant-admin"): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(root, rel)).isDirectory()) out.push(...tenantAdminRoutes(rel));
    else if (entry === "page.tsx") out.push(rel.replace("src/app", "").replace("/page.tsx", ""));
  }
  return out;
}

const ROUTES = tenantAdminRoutes();
const NAV = source("src/app/tenant-admin/AdminNav.tsx");
const LAYOUT = source("src/app/tenant-admin/layout.tsx");
const PAGE = source("src/app/tenant-admin/help/page.tsx");

// ---------- entry point ----------

test("the shared header has exactly one help link", () => {
  const matches = LAYOUT.match(/href="\/tenant-admin\/help"/g) ?? [];
  assert.equal(matches.length, 1, "one entry point, in the shared shell");
});

test("the help link has an accessible name and needs no JavaScript", () => {
  assert.match(LAYOUT, /aria-label="Mở hướng dẫn sử dụng"/);
  // A plain <Link>, not a button with client state.
  assert.match(LAYOUT, /<Link\s+href="\/tenant-admin\/help"/);
  assert.doesNotMatch(LAYOUT, /'use client'/, "the shell stays a Server Component");
  // The glyph itself is decorative; the accessible name carries meaning.
  assert.match(LAYOUT, /<span aria-hidden="true">\?<\/span>/);
});

test("the existing account controls are untouched", () => {
  assert.match(LAYOUT, /<AdminAccountBar \/>/);
  assert.match(LAYOUT, /View storefront/);
});

test("no page adds a second help link of its own", () => {
  for (const route of ROUTES) {
    if (route === "/tenant-admin/help") continue;
    const file = `src/app${route}/page.tsx`;
    assert.doesNotMatch(
      source(file),
      /\/tenant-admin\/help/,
      `${route} must not duplicate the help entry point`,
    );
  }
});

test("the help link is not in the sidebar navigation", () => {
  // It belongs in the header beside the account controls, not among the
  // places a merchant navigates to.
  assert.doesNotMatch(NAV, /\/tenant-admin\/help/);
});

// ---------- authorization and data access ----------

test("the guide authorizes like every other admin route", () => {
  assert.match(PAGE, /requireTenantAdmin\(\)/);
  assert.match(PAGE, /export const dynamic = 'force-dynamic'/);
});

test("the guide reads no tenant data at all", () => {
  const body = code("src/app/tenant-admin/help/page.tsx");
  for (const forbidden of [/getScopedDb/, /prisma/, /findMany/, /findFirst/, /\$queryRaw/]) {
    assert.doesNotMatch(body, forbidden, "rendering help must not query the database");
  }
  // And the content module is plain data.
  const content = code("src/app/tenant-admin/help/help-content.ts");
  assert.doesNotMatch(content, /import .*prisma|getScopedDb/);
});

test("the guide is not indexable", () => {
  assert.match(PAGE, /robots: \{ index: false, follow: false \}/);
});

test("the guide is not reachable from a public route", () => {
  // It lives under the authorized tenant-admin tree, and no storefront
  // surface links to it.
  for (const file of [
    "src/app/_storefront/StorefrontHeader.tsx",
    "src/app/sitemap.ts",
  ]) {
    let contents = "";
    try {
      contents = source(file);
    } catch {
      continue; // the file may not exist; nothing to assert then
    }
    assert.doesNotMatch(contents, /tenant-admin\/help/, `${file} must not link the guide`);
  }
});

// ---------- coverage ----------

test("every navigation destination has a guide section", () => {
  const navRoutes = [...NAV.matchAll(/\["(\/tenant-admin[^"]*)", "[^"]*"\]/g)].map((m) => m[1]);
  assert.ok(navRoutes.length >= 10, "the navigation was actually parsed");

  const documented = new Set(
    HELP_SECTIONS.map((section) => section.route).filter((route): route is string => !!route),
  );
  for (const route of navRoutes) {
    assert.ok(documented.has(route), `${route} is in the nav but has no guide section`);
  }
});

test("per-record routes are covered by their parent section", () => {
  // These have no nav entry and no section of their own, by design.
  const inPageRoutes = [
    "/tenant-admin/products/new",
    "/tenant-admin/orders/[orderId]/print",
    "/tenant-admin/customers/[customerId]",
  ];
  for (const route of inPageRoutes) {
    assert.ok(ROUTES.includes(route), `${route} should exist`);
  }
  // products/new has its own section; print and customer detail are
  // explained inside the print and customer sections.
  assert.ok(HELP_SECTIONS.some((s) => s.route === "/tenant-admin/products/new"));
  assert.ok(HELP_SECTIONS.some((s) => s.id === "in-chung-tu"));
  assert.ok(HELP_SECTIONS.some((s) => s.id === "khach-hang"));
});

test("every route a section links to really exists", () => {
  for (const section of HELP_SECTIONS) {
    if (!section.route) continue;
    assert.ok(
      ROUTES.includes(section.route),
      `${section.title} links to ${section.route}, which is not a real page`,
    );
  }
});

test("a section without a route explains where to find it instead", () => {
  for (const section of HELP_SECTIONS) {
    if (section.route) continue;
    assert.ok(
      section.routeNote && section.routeNote.length > 10,
      `${section.title} must say where it lives`,
    );
  }
});

test("no section links to Platform Admin", () => {
  const serialized = JSON.stringify(HELP_SECTIONS) + PAGE;
  assert.ok(!serialized.includes("/platform-admin"), "Tenant Admin help stays tenant-scoped");
});

test("every section is complete", () => {
  assert.ok(HELP_SECTIONS.length >= 14, "all pages are covered");
  assert.ok(QUICK_START.length >= 3);
  const ids = new Set<string>();
  for (const section of HELP_SECTIONS) {
    assert.ok(section.id && !ids.has(section.id), `${section.id} must be a unique anchor`);
    ids.add(section.id);
    assert.ok(section.title.length > 0);
    assert.ok(section.purpose.length > 20, `${section.id} needs a real purpose`);
    assert.ok(section.canDo.length > 0, `${section.id} needs "can do"`);
    assert.ok(section.workflow.length > 0, `${section.id} needs a workflow`);
    assert.ok(section.concepts.length > 0, `${section.id} needs concepts`);
    assert.ok(section.limits.length > 0, `${section.id} must state its limits`);
  }
});

test("the table of contents anchors resolve to rendered section ids", () => {
  // The page renders one <section id={section.id}> per entry and the
  // contents links to #id, so every anchor has a target by construction.
  assert.match(PAGE, /href=\{`#\$\{section\.id\}`\}/);
  assert.match(PAGE, /id=\{section\.id\}/);
});

// ---------- the limitations that must not be softened ----------

test("the print section states it is not an invoice or a carrier label", () => {
  const print = HELP_SECTIONS.find((s) => s.id === "in-chung-tu");
  assert.ok(print);
  const limits = print.limits.join(" ");
  assert.match(limits, /không phải hoá đơn VAT/);
  assert.match(limits, /hoá đơn điện tử/);
  assert.match(limits, /không phải vận đơn chính thức/);
  assert.match(limits, /không có mã vận đơn/i);
});

test("order and fulfillment sections refuse to imply delivery or COD collection", () => {
  const orders = HELP_SECTIONS.find((s) => s.id === "don-hang");
  assert.ok(orders);
  assert.match(orders.limits.join(" "), /không chứng minh[\s\S]*đã giao tới khách/);
  assert.match(orders.limits.join(" "), /thu hộ tiền COD/);

  const fulfillment = HELP_SECTIONS.find((s) => s.id === "chuan-bi-giao");
  assert.ok(fulfillment);
  const limits = fulfillment.limits.join(" ");
  assert.match(limits, /không phải hệ thống vận chuyển/);
  assert.match(limits, /đã giao, giao thất bại, bị trả lại/);
});

test("money wording never claims settled revenue", () => {
  for (const id of ["tong-quan", "khach-hang"]) {
    const section = HELP_SECTIONS.find((s) => s.id === id);
    assert.ok(section);
    const text = JSON.stringify(section);
    assert.match(text, /không phải doanh thu đã thu/, `${id} must not call it revenue`);
  }
});

test("payment sections deny accounting and settlement claims", () => {
  const ops = HELP_SECTIONS.find((s) => s.id === "van-hanh-thanh-toan");
  assert.ok(ops);
  const limits = ops.limits.join(" ");
  assert.match(limits, /không phải phần mềm kế toán/);
  assert.match(limits, /không phải hệ thống đối soát ngân hàng/);
  assert.match(limits, /không bao giờ khẳng định tiền đã về tài khoản/);

  const payments = HELP_SECTIONS.find((s) => s.id === "thanh-toan");
  assert.ok(payments);
  assert.match(payments.limits.join(" "), /sẽ bị thay thế/, "provider switch is warned about");
});

test("shipping section denies carrier integration", () => {
  const shipping = HELP_SECTIONS.find((s) => s.id === "van-chuyen");
  assert.ok(shipping);
  const limits = shipping.limits.join(" ");
  assert.match(limits, /không kết nối với đơn vị vận chuyển nào/);
  assert.match(limits, /không có mã vận đơn/);
});

test("the CSV section states atomicity and the SKU limitation", () => {
  const csv = HELP_SECTIONS.find((s) => s.id === "nhap-xuat-csv");
  assert.ok(csv);
  const limits = csv.limits.join(" ");
  assert.match(limits, /một lần duy nhất/, "all-or-nothing is stated");
  assert.match(limits, /chưa có SKU thì không cập nhật được/);
  assert.match(limits, /Không nhập được giảm giá, hình ảnh/);
});

test("the customer section states what cannot be done", () => {
  const customers = HELP_SECTIONS.find((s) => s.id === "khach-hang");
  assert.ok(customers);
  const limits = customers.limits.join(" ");
  assert.match(limits, /Không sửa, xoá hay gộp khách hàng/);
  assert.match(limits, /thông tin cá nhân/);
});

test("the catalog section does not claim existing images are rewritten", () => {
  const catalog = HELP_SECTIONS.find((s) => s.id === "san-pham");
  assert.ok(catalog);
  assert.match(catalog.limits.join(" "), /Ảnh cũ đã có từ trước vẫn giữ nguyên định dạng/);
});

// ---------- privacy and honesty ----------

test("the guide contains no identifiers, secrets or invented support channels", () => {
  const everything = JSON.stringify(HELP_SECTIONS) + QUICK_START.join(" ") + PAGE;
  for (const forbidden of [
    /tenantId/,
    /customerId/,
    /paymentId/,
    /providerMetadata/,
    /rawPayload/,
    /payloadDigest/,
    /signature/i,
    /apiKey/i,
    /[\w.+-]+@[\w-]+\.[\w.]+/, // no support email
    /\bhttps?:\/\//, // no external links
  ]) {
    assert.doesNotMatch(everything, forbidden, `the guide must not contain ${forbidden}`);
  }
});

test("the guide avoids internal implementation vocabulary", () => {
  const prose = JSON.stringify(HELP_SECTIONS);
  for (const jargon of [/Prisma/i, /webhook/i, /\bSQL\b/i, /migration/i, /schema/i]) {
    assert.doesNotMatch(prose, jargon, `${jargon} is not merchant-facing language`);
  }
});

test("the guide does not promise features as coming soon", () => {
  const prose = JSON.stringify(HELP_SECTIONS);
  for (const promise of [/sắp ra mắt/i, /sắp có/i, /trong tương lai/i, /đang phát triển/i]) {
    assert.doesNotMatch(prose, promise, "planned features must not be described");
  }
});

// ---------- structure and accessibility ----------

test("the page adds no h1 and no second main landmark", () => {
  assert.doesNotMatch(PAGE, /<h1/, "the layout owns the h1");
  assert.doesNotMatch(PAGE, /<main/);
  assert.match(PAGE, /<AdminPageHeader/);
});

test("heading structure is sections at h2 with h3 subheadings", () => {
  // AdminPageHeader renders the page title as h2; each guide section's
  // own title is h2 and its parts are h3, so the order never skips.
  assert.match(PAGE, /<h2 id=\{`\$\{section\.id\}-title`\}/);
  assert.match(PAGE, /<h3 className=\{adminEyebrowClassName\}>Bạn có thể làm gì<\/h3>/);
});

test("the table of contents is a labelled navigation region", () => {
  assert.match(PAGE, /<nav aria-labelledby="muc-luc"/);
  assert.match(PAGE, /<h3 id="muc-luc"/);
});

test("route links carry descriptive accessible names", () => {
  assert.match(PAGE, /aria-label=\{`Đi tới trang \$\{section\.title\}`\}/);
});

test("the guide needs no client-side interaction", () => {
  assert.doesNotMatch(PAGE, /'use client'/);
  assert.doesNotMatch(PAGE, /useState|onClick/);
  // Plain anchors and links only: it works without JavaScript.
  assert.match(PAGE, /<a\s+href=\{`#\$\{section\.id\}`\}/);
});

test("long text wraps and the guide does not depend on screenshots", () => {
  assert.doesNotMatch(PAGE, /<img/, "no screenshots are claimed or embedded");
  assert.doesNotMatch(PAGE, /whitespace-nowrap/, "nothing is forced onto one line");
});
