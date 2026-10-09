import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { StatusBadge, toneForStatus } from "../src/app/tenant-admin/StatusBadge";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Source with comments stripped — line comments FIRST, so a // comment
 *  mentioning a path cannot be read as an opening block comment. */
function readCode(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function adminPages(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(root, rel)).isDirectory()) out.push(...adminPages(rel));
    else if (entry === "page.tsx") out.push(rel);
  }
  return out;
}

const TENANT_PAGES = adminPages("src/app/tenant-admin");

// ---------- StatusBadge ----------

test("a status renders its LABEL as text, never colour alone", () => {
  // WCAG 1.4.1: colour must not be the only way meaning is conveyed.
  const el = StatusBadge({ status: "fulfilled" });
  assert.equal(el.props.children, "fulfilled", "the label itself must be rendered");
});

test("the status-to-tone mapping is shared, so one status reads the same everywhere", () => {
  assert.equal(toneForStatus("fulfilled"), "success");
  assert.equal(toneForStatus("succeeded"), "success");
  assert.equal(toneForStatus("active"), "success");
  assert.equal(toneForStatus("pending"), "warning");
  assert.equal(toneForStatus("draft"), "warning");
  assert.equal(toneForStatus("failed"), "danger");
  assert.equal(toneForStatus("cancelled"), "neutral");
  assert.equal(toneForStatus("archived"), "neutral");
});

test("an unmapped or missing status degrades to a readable neutral", () => {
  // Never an unstyled/invisible badge for a status nobody has mapped yet.
  assert.equal(toneForStatus("something-new"), "neutral");
  assert.equal(toneForStatus(null), "neutral");
  assert.equal(toneForStatus(undefined), "neutral");
  assert.equal(toneForStatus(""), "neutral");
});

test("status matching is case-insensitive", () => {
  assert.equal(toneForStatus("Fulfilled"), "success");
  assert.equal(toneForStatus("PENDING"), "warning");
});

test("an explicit tone can override the shared mapping", () => {
  const el = StatusBadge({ status: "Default", tone: "info" });
  assert.match(String(el.props.className), /blue/);
});

// ---------- AdminPageHeader ----------

test("the page header renders its title as an h2, not a second h1", () => {
  // The layout owns the h1 (the store name), so a page heading must be h2
  // or the page ends up with two top-level headings.
  const src = readCode("src/app/tenant-admin/AdminPageHeader.tsx");
  assert.match(src, /<h2/);
  assert.doesNotMatch(src, /<h1/);
});

test("the page header wraps rather than overflowing on narrow screens", () => {
  const src = readCode("src/app/tenant-admin/AdminPageHeader.tsx");
  assert.match(src, /flex-col/, "stacks by default");
  assert.match(src, /sm:flex-row/, "only goes horizontal when there is room");
  assert.match(src, /flex-wrap/, "actions wrap rather than overflow");
});

test("every Tenant Admin page uses the shared header", () => {
  // products/new is the exception: it is a focused full-page form with its
  // own back link, not a dashboard section.
  const exceptions = new Set(["src/app/tenant-admin/products/new/page.tsx"]);
  for (const page of TENANT_PAGES) {
    if (exceptions.has(page)) continue;
    assert.match(readCode(page), /<AdminPageHeader/, `${page} must use AdminPageHeader`);
  }
});

// ---------- heading hierarchy and landmarks ----------

test("exactly one h1 lives in the admin layout, and no page adds another", () => {
  const layout = readCode("src/app/tenant-admin/layout.tsx");
  assert.equal((layout.match(/<h1/g) ?? []).length, 1, "the layout owns the single h1");
  for (const page of TENANT_PAGES) {
    assert.doesNotMatch(readCode(page), /<h1/, `${page} must not render a second h1`);
  }
});

test("the admin layout provides header, nav and main landmarks", () => {
  const layout = readCode("src/app/tenant-admin/layout.tsx");
  assert.match(layout, /<header/, "header landmark");
  assert.match(layout, /<main/, "main landmark");
  const nav = readCode("src/app/tenant-admin/AdminTabs.tsx");
  assert.match(nav, /<nav/, "nav landmark");
  assert.match(nav, /aria-label=/, "the nav is named, since a page may have several");
});

// ---------- navigation ----------

test("the active nav link is marked with aria-current", () => {
  const src = readCode("src/app/tenant-admin/AdminTabs.tsx");
  assert.match(src, /aria-current=\{active \? "page" : undefined\}/);
});

test("Overview matches exactly, so it does not light up on every sub-route", () => {
  // Every other admin path begins with "/tenant-admin/", so a startsWith
  // check would mark Overview current on all of them.
  const src = readCode("src/app/tenant-admin/AdminTabs.tsx");
  assert.match(src, /href === "\/tenant-admin"\s*\?\s*pathname === href/);
});

test("navigation WRAPS instead of scrolling horizontally", () => {
  // WCAG 1.4.10 Reflow: content should not require two-dimensional
  // scrolling. An overflow-x strip also hides destinations with no
  // affordance on a touch device that has no hover.
  const src = readCode("src/app/tenant-admin/AdminTabs.tsx");
  assert.match(src, /flex-wrap/);
  assert.doesNotMatch(src, /overflow-x-auto/);
});

test("every admin route is reachable from the navigation", () => {
  const src = readCode("src/app/tenant-admin/AdminTabs.tsx");
  for (const page of TENANT_PAGES) {
    const route = page
      .replace("src/app", "")
      .replace("/page.tsx", "")
      .replace(/^\/tenant-admin$/, "/tenant-admin");
    // products/new is reached from the Catalog page's primary action, not
    // from the top-level nav, which stays at section level.
    if (route.includes("/products/new")) continue;
    assert.ok(src.includes(`"${route}"`), `${route} must appear in the nav`);
  }
});

// ---------- orders list ----------

test("the orders list has no horizontally-scrolling wide table", () => {
  // The 790px min-width table was the reflow problem at 375px.
  const src = readCode("src/app/tenant-admin/orders/page.tsx");
  assert.doesNotMatch(src, /min-w-\[790px\]/);
});

test("each order is rendered once, as a disclosure", () => {
  const src = readCode("src/app/tenant-admin/orders/page.tsx");
  assert.match(src, /<details/, "orders use a native disclosure");
  assert.match(src, /<summary/);
  // The page used to map over `orders` twice: once for the table and once
  // for a second full set of detail cards.
  const listRenders = (src.match(/orders\.map\(/g) ?? []).length;
  assert.equal(listRenders, 2, "one map builds the timeline id list, one renders the list");
});

test("the selection checkbox keeps its accessible name and bulk-form wiring", () => {
  const src = readCode("src/app/tenant-admin/orders/page.tsx");
  assert.match(src, /aria-label=\{`Select order \$\{order\.id\}`\}/);
  assert.match(src, /form="bulk-orders-form"/);
  assert.match(src, /name="orderIds"/);
});

test("money uses .money and identifiers use monospace, not the reverse", () => {
  const src = readCode("src/app/tenant-admin/orders/page.tsx");
  assert.match(src, /className="money/, "monetary values carry .money");
  assert.match(src, /font-mono/, "order ids stay monospace");
  // The id is secondary: shortened in the summary, full value in detail.
  assert.match(src, /order\.id\.slice\(0, 8\)/);
});

test("dates are machine-readable and unambiguous", () => {
  const src = readCode("src/app/tenant-admin/orders/page.tsx");
  assert.match(src, /<time\s+dateTime=/, "a machine-readable value is exposed");
  // A US numeric format on a Vietnamese store is a real misreading risk.
  assert.doesNotMatch(src, /toLocaleDateString\("en-US"\)/);
});

test("the orders list distinguishes 'none yet' from 'none matching'", () => {
  const src = readCode("src/app/tenant-admin/orders/page.tsx");
  assert.match(src, /No orders match these filters/);
  assert.match(src, /No orders yet/);
});

// ---------- catalog ----------

test("the catalog has no horizontally-scrolling product table", () => {
  const src = readCode("src/app/tenant-admin/catalog/page.tsx");
  assert.doesNotMatch(src, /min-w-\[620px\]/);
});

test("the catalog keeps its export copy and its no-customer-data note", () => {
  const src = readCode("src/app/tenant-admin/catalog/page.tsx");
  assert.match(src, /Contains no\s+customer data/);
});

test("the catalog distinguishes 'none yet' from 'none matching'", () => {
  const src = readCode("src/app/tenant-admin/catalog/page.tsx");
  assert.match(src, /No products match these filters/);
  assert.match(src, /No products yet/);
});

// ---------- regressions the redesign must not undo ----------

test("the orders export keeps its personal-data warning verbatim", () => {
  const src = readFileSync(join(root, "src/app/tenant-admin/orders/page.tsx"), "utf8");
  assert.match(src, /Contains customer personal data/);
  for (const field of ["name", "email", "phone", "shipping address"]) {
    assert.ok(src.includes(field), `the warning must still name ${field}`);
  }
  assert.match(src, /no longer protected by/);
});

test("bulk confirmation from 664bac2 survives the redesign", () => {
  const src = readCode("src/app/tenant-admin/BulkOrderStatusForm.tsx");
  assert.match(src, /onSubmit=/);
  assert.match(src, /window\.confirm\(/);
  assert.match(src, /bulkOrderStatusConfirmMessage\(/);
  assert.match(src, /NO_SELECTION_ERROR/);
  assert.equal((src.match(/disabled=\{pending\}/g) ?? []).length, 2);
});

test("the destructive bulk action is styled differently from the safe one", () => {
  // Cancelling releases inventory and cannot be undone; it must not look
  // identical to the harmless action beside it.
  const src = readCode("src/app/tenant-admin/BulkOrderStatusForm.tsx");
  assert.match(src, /adminButtonDangerClassName/);
  assert.match(src, /adminButtonSecondaryClassName/);
});

test("the bulk toolbar announces the selection count", () => {
  const src = readCode("src/app/tenant-admin/BulkOrderStatusForm.tsx");
  assert.match(src, /role="status"/, "the count change is announced, not just drawn");
  assert.match(src, /selectedCount/);
});

test("the danger button variant carries its own focus ring", () => {
  // So the distinction from a safe action survives keyboard navigation.
  const styles = readCode("src/app/tenant-admin/styles.ts");
  assert.match(styles, /adminButtonDangerClassName[\s\S]*?focus-visible:outline-red-600/);
});
