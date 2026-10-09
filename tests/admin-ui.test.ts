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
  for (const page of TENANT_PAGES) {
    assert.match(readCode(page), /<AdminPageHeader/, `${page} must use AdminPageHeader`);
  }
});

test("no route renders its own shell inside the layout's", () => {
  // products/new used to wrap itself in its own <TenantTheme> and <main>,
  // which under the dashboard shell meant a <main> nested inside the
  // layout's <main> — two main landmarks on one page — plus a second theme
  // provider and two branding queries that existed only to feed it.
  for (const page of TENANT_PAGES) {
    const code = readCode(page);
    assert.doesNotMatch(code, /<main/, `${page} must not render a second main landmark`);
    assert.doesNotMatch(code, /<TenantTheme/, `${page} must not render a second theme provider`);
  }
  // The layout is the one place that owns them.
  const layout = readCode("src/app/tenant-admin/layout.tsx");
  assert.equal((layout.match(/<main/g) ?? []).length, 1);
  assert.match(layout, /<TenantTheme/);
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
  const nav = readCode("src/app/tenant-admin/AdminNav.tsx");
  assert.match(nav, /<nav/, "nav landmark");
  assert.match(nav, /aria-label=/, "the nav is named, since a page may have several");
});

// ---------- navigation ----------

test("the active nav link is marked with aria-current", () => {
  const src = readCode("src/app/tenant-admin/AdminNav.tsx");
  assert.match(src, /aria-current=\{active \? "page" : undefined\}/);
});

test("Overview matches exactly, so it does not light up on every sub-route", () => {
  // Every other admin path begins with "/tenant-admin/", so a startsWith
  // check would mark Overview current on all of them.
  const src = readCode("src/app/tenant-admin/AdminNav.tsx");
  assert.match(src, /href === "\/tenant-admin"\) return pathname === href/);
});

test("navigation never scrolls horizontally", () => {
  // WCAG 1.4.10 Reflow: content should not require two-dimensional
  // scrolling. The sidebar stacks vertically; nothing here may reintroduce
  // a horizontal strip that hides destinations off-screen.
  const src = readCode("src/app/tenant-admin/AdminNav.tsx");
  assert.doesNotMatch(src, /overflow-x-auto/);
  assert.match(src, /flex-col/);
});

test("every admin route is reachable from the navigation", () => {
  const src = readCode("src/app/tenant-admin/AdminNav.tsx");
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

// ---------- dashboard shell: sidebar + mobile disclosure ----------

test("navigation is grouped, and every group is named for assistive tech", () => {
  const src = readCode("src/app/tenant-admin/AdminNav.tsx");
  for (const group of ["Commerce", "Storefront", "Checkout"]) {
    assert.ok(src.includes(`"${group}"`), `the ${group} group must exist`);
  }
  // A visible label that also names the list, rather than a heading that
  // would compete with the page's own h1/h2 outline.
  assert.match(src, /aria-labelledby=\{group\.label/);
});

test("the mobile menu is a DISCLOSURE, not a modal dialog", () => {
  // A menu that overlays the page behaves as a dialog and then owes the
  // user a focus trap, aria-modal and an inert background. This one pushes
  // content down instead, so it owes none of those — and must not quietly
  // acquire dialog semantics without the handling that implies.
  const src = readCode("src/app/tenant-admin/AdminNav.tsx");
  assert.match(src, /aria-expanded=\{open\}/, "the trigger reports its state");
  assert.match(src, /aria-controls=\{panelId\}/, "the trigger names what it controls");
  assert.doesNotMatch(src, /aria-modal/, "not a dialog");
  assert.doesNotMatch(src, /role="dialog"/, "not a dialog");
});

test("the menu trigger is a real button with a state-appropriate name", () => {
  const src = readCode("src/app/tenant-admin/AdminNav.tsx");
  assert.match(src, /<button\s+type="button"/, "a real button, not a div");
  assert.match(src, /open \? "Close menu" : "Menu"/, "the name says what pressing it does");
});

test("Escape closes the mobile menu", () => {
  const src = readCode("src/app/tenant-admin/AdminNav.tsx");
  assert.match(src, /event\.key === "Escape"/);
  assert.match(src, /addEventListener\("keydown"/);
  assert.match(src, /removeEventListener\("keydown"/, "the listener is cleaned up");
});

test("navigating closes the mobile menu without a state write during render", () => {
  const src = readCode("src/app/tenant-admin/AdminNav.tsx");
  assert.match(src, /onClick=\{\(\) => setOpen\(false\)\}/);
});

test("the nav list is rendered once, so no duplicate links reach assistive tech", () => {
  // Shown or hidden with CSS rather than rendered twice for two
  // breakpoints — a second copy of every link would be a second set of
  // tab stops and duplicate accessible names.
  const src = readCode("src/app/tenant-admin/AdminNav.tsx");
  assert.equal((src.match(/GROUPS\.map\(/g) ?? []).length, 1, "one render of the groups");
  assert.match(src, /\$\{open \? "flex" : "hidden"\} flex-col gap-4 lg:flex/);
});

test("the active route is not signalled by colour alone", () => {
  const src = readCode("src/app/tenant-admin/AdminNav.tsx");
  assert.match(src, /aria-current=\{active \? "page" : undefined\}/, "exposed to assistive tech");
  assert.match(src, /font-semibold/, "and a weight change, not just a hue");
});

test("touch targets meet the minimum size", () => {
  // WCAG 2.2 SC 2.5.8 asks for 24x24 CSS px; 44px is the long-standing
  // touch guidance, so the mobile links and trigger use min-h-11 (44px)
  // and relax to min-h-9 only on desktop where a pointer is precise.
  const src = readCode("src/app/tenant-admin/AdminNav.tsx");
  assert.match(src, /min-h-11/);
  assert.match(src, /lg:min-h-9/);
});

test("the shell lays out as a grid that cannot overflow horizontally", () => {
  const layout = readCode("src/app/tenant-admin/layout.tsx");
  assert.match(layout, /grid-cols-1/, "single column on small screens");
  assert.match(layout, /lg:grid-cols-\[14rem_minmax\(0,1fr\)\]/, "sidebar only at lg and up");
  // minmax(0,1fr) is load-bearing: a plain 1fr lets a wide child force the
  // column past the viewport and reintroduce horizontal scrolling.
  assert.match(layout, /minmax\(0,1fr\)/);
  assert.match(layout, /min-w-0/, "the main region may shrink below its content");
});

test("the sidebar is page furniture, never an overlay that traps focus", () => {
  const layout = readCode("src/app/tenant-admin/layout.tsx");
  assert.match(layout, /<aside/);
  assert.match(layout, /lg:sticky/, "sticky so it stays reachable down a long list");
  assert.doesNotMatch(layout, /fixed inset-0/, "never covers the page");
});

test("every navigable route appears in the grouped navigation", () => {
  const src = readCode("src/app/tenant-admin/AdminNav.tsx");
  for (const page of TENANT_PAGES) {
    const route = page.replace("src/app", "").replace("/page.tsx", "");
    // products/new is an action reached from Catalog's primary button, not
    // a destination; the sidebar lists places rather than verbs.
    if (route.includes("/products/new")) continue;
    assert.ok(src.includes(`"${route}"`), `${route} must be reachable from the nav`);
  }
});

test("products/new stays reachable even though it is not in the nav", () => {
  const catalog = readCode("src/app/tenant-admin/catalog/page.tsx");
  assert.match(catalog, /href="\/tenant-admin\/products\/new"/);
});

// --- The surface system -----------------------------------------------
//
// These assert the structural half of the redesign: that configuration
// routes are built from named sections on the page canvas rather than
// forms stacked in one page-sized card, and that every state a merchant
// acts on is carried by text. They say nothing about how any of it
// looks — that is only answerable in a browser.

test("no admin route nests its content in a page-sized outer card", () => {
  // adminSectionClassName is the old page-card. A card holding cards
  // reads as one slab, which is what flattened these screens.
  for (const page of TENANT_PAGES) {
    const src = readCode(page);
    if (page.includes("/products/new")) continue; // a single centred form, legitimately one card
    assert.doesNotMatch(
      src,
      /adminSectionClassName/,
      `${page} should compose panels on the canvas instead of one outer card`,
    );
  }
});

test("configuration routes group their settings into labelled sections", () => {
  for (const route of ["payments", "shipping", "branding"]) {
    const src = readCode(`src/app/tenant-admin/${route}/page.tsx`);
    assert.match(src, /adminPanelClassName/, `${route} builds sections from the shared panel`);
    assert.match(
      src,
      /aria-labelledby=/,
      `${route}'s sections must be named for assistive technology`,
    );
  }
});

test("enabled, default and stock states are words, not only colour", () => {
  const shipping = readCode("src/app/tenant-admin/shipping/page.tsx");
  assert.match(shipping, /["']Enabled["']/, "an enabled method says so");
  assert.match(shipping, /status=["']Default["']/, "the default method says so");

  const payments = readCode("src/app/tenant-admin/payments/page.tsx");
  assert.match(payments, /StatusBadge/, "payment methods use the shared badge");

  const catalog = readCode("src/app/tenant-admin/catalog/page.tsx");
  assert.match(catalog, /Low stock/, "low stock is labelled, not inferred from a figure");
  assert.match(catalog, /Out of stock/);
  assert.match(catalog, /LOW_STOCK_THRESHOLD/, "the threshold is shared, not re-typed here");
});

test("a store with no shipping method is told checkout is blocked", () => {
  const src = readCode("src/app/tenant-admin/shipping/page.tsx");
  assert.match(src, /role="alert"/, "an unsellable store is announced, not styled red");
  assert.match(src, /Checkout is blocked/);
});

test("the one-default rule is stated on the control it governs", () => {
  const src = readCode("src/app/tenant-admin/shipping/page.tsx");
  assert.match(src, /Only one method can be the default/);
});

test("destructive controls stay confirmation-protected and set apart", () => {
  for (const route of ["shipping", "banners", "catalog"]) {
    const src = readCode(`src/app/tenant-admin/${route}/page.tsx`);
    assert.match(src, /ConfirmActionForm/, `${route} must confirm before deleting`);
    assert.match(src, /variant="danger"/, `${route}'s delete must read as destructive`);
  }
  // Separated by a rule from the Save above it, so the two never sit
  // adjacent in the scan path.
  const shipping = readCode("src/app/tenant-admin/shipping/page.tsx");
  assert.match(shipping, /border-t border-border pt-3[\s\S]*ConfirmActionForm/);
});

test("the catalog leads with products and keeps options subordinate", () => {
  const src = readCode("src/app/tenant-admin/catalog/page.tsx");
  const products = src.indexOf('title="Products"');
  const options = src.indexOf("Variant options");
  assert.ok(products > 0 && options > 0);
  assert.ok(products < options, "products must come before the store-wide option settings");
});

test("empty states say what to do next, not only that nothing is there", () => {
  const banners = readCode("src/app/tenant-admin/banners/page.tsx");
  assert.match(banners, /No banners yet/);
  assert.match(banners, /default welcome banner/, "it says what the storefront shows meanwhile");

  const catalog = readCode("src/app/tenant-admin/catalog/page.tsx");
  assert.match(catalog, /No variant options yet/);
});

test("the shipping amount field names its currency and its zero case", () => {
  const src = readCode("src/app/tenant-admin/shipping/page.tsx");
  assert.match(src, /in VND/);
  assert.match(src, /0 for free shipping/);
});

test("branding separates store identity from its uploaded assets", () => {
  const page = readCode("src/app/tenant-admin/branding/page.tsx");
  assert.match(page, /Store identity/);
  assert.match(page, /Logo, favicon and design tokens/);
  // A Markdown token file is not a third image field, and the upload
  // controls now say so.
  const controls = readCode("src/app/tenant-admin/BrandingUploadControls.tsx");
  assert.match(controls, /Design tokens/);
});
