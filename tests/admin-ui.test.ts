import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { StatusBadge, toneForStatus } from "../src/app/tenant-admin/StatusBadge";
import { callerOwnsFormLayout, mergeFormClassName } from "../src/components/ActionForm";

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

// --- Payments and Shipping: form rhythm, readiness, blocked states ---
//
// Structure only, as above: these say the rule is expressed in the source.
// None of them has seen a rendered pixel.

test("a form with no layout of its own gets shared vertical spacing", () => {
  const src = readCode("src/components/ActionForm.tsx");
  assert.match(src, /actionFormLayoutClassName/);
  assert.match(src, /flex flex-col gap-3/, "children are spaced, not bare siblings");
  assert.match(src, /mergeFormClassName/, "caller classes are merged, never overwritten");
});

test("row-layout callers keep their own direction", () => {
  // `flex items-end gap-2` and `inline-flex` callers must not be rotated
  // into a column by the shared default.
  assert.equal(callerOwnsFormLayout("flex items-end gap-2"), true);
  assert.equal(callerOwnsFormLayout("inline-flex"), true);
  assert.equal(callerOwnsFormLayout("max-w-md"), false);
  assert.equal(callerOwnsFormLayout(undefined), false);

  // A caller that owns its layout gets back exactly what it passed.
  assert.equal(mergeFormClassName("flex items-end gap-2"), "flex items-end gap-2");
  // One that does not keeps its own classes AND gains the spacing.
  assert.match(mergeFormClassName("max-w-md"), /flex flex-col gap-3/);
  assert.match(mergeFormClassName("max-w-md"), /max-w-md/);
});

test("both shared forms separate their submit button from the fields", () => {
  for (const file of ["src/components/ActionForm.tsx", "src/components/ConfirmActionForm.tsx"]) {
    const src = readCode(file);
    assert.match(src, /ownsLayout/, `${file} decides separation from the layout it owns`);
  }
  assert.match(
    readCode("src/components/ActionForm.tsx"),
    /border-t border-border pt-3/,
    "Save sits below a rule, not flush against the last field",
  );
});

test("payment readiness is derived from the predicate checkout already uses", () => {
  const page = readCode("src/app/tenant-admin/payments/page.tsx");
  assert.match(page, /isProviderConfigured/, "no second copy of the configured rule in the UI");
  assert.match(page, /from '@\/lib\/payments\/payment-service'/);
  // Words, not colour alone.
  assert.match(page, /Needs setup/);
  assert.match(page, /'Ready'/);

  const service = readCode("src/lib/payments/payment-service.ts");
  assert.match(service, /export function isProviderConfigured/);
});

test("MoMo claims no readiness it cannot determine", () => {
  const page = readCode("src/app/tenant-admin/payments/page.tsx");
  assert.match(page, /Readiness is not shown for MoMo/);
  assert.match(page, /platform credentials this page cannot/);
});

test("bank-transfer provider fields are grouped per provider", () => {
  const page = readCode("src/app/tenant-admin/payments/page.tsx");
  assert.match(page, /<legend[\s\S]*?Manual bank transfer/);
  assert.match(page, /<legend[\s\S]*?SePay virtual account/);
  // Save behaviour is unchanged, so the form has to SAY what it keeps.
  assert.match(page, /Only the selected provider/);
  // The field names checkout reads must not drift.
  for (const name of ["bankName", "bankAccountNumber", "bankAccountHolder", "sepayBaUuid"]) {
    assert.match(page, new RegExp(`name="${name}"`), `${name} is still posted`);
  }
});

test("an all-disabled shipping list is announced as blocked too", () => {
  const src = readCode("src/app/tenant-admin/shipping/page.tsx");
  assert.match(src, /enabledCount/, "the blocked state is derived, not assumed from length");
  assert.match(src, /no shipping method is configured/);
  assert.match(src, /all shipping methods are disabled/);
  assert.match(src, /role="alert"/);
});

test("a default-but-disabled shipping method shows both states", () => {
  const src = readCode("src/app/tenant-admin/shipping/page.tsx");
  assert.match(src, /default method but it is disabled/);
  assert.match(src, /method\.enabled \? 'info' : 'neutral'/, "Default is subordinated, not hidden");
});

test("the bank-transfer route no longer writes data checkout ignores", () => {
  const src = readCode("src/app/tenant-admin/bank-transfer/page.tsx");
  // The whole point: it writes nothing at all now.
  assert.doesNotMatch(src, /updateBankTransferDetails/, "the dead action is gone");
  assert.doesNotMatch(src, /<ActionForm/, "no form writes Branding bank fields");
  assert.doesNotMatch(src, /name="bankName"/);
  assert.doesNotMatch(src, /shown to customers who choose manual bank transfer/);
  // And it sends the merchant to the one place that does own the config.
  assert.match(src, /tenant-admin\/payments/);
  assert.match(src, /read-only/);
});

test("the dead branding bank-detail writer is removed everywhere", () => {
  // Branding.bankName/bankAccountNumber/bankAccountHolder had exactly one
  // writer and no reader. The columns stay (no migration), but nothing in
  // the app presents them as settings any more.
  const actions = readCode("src/app/tenant-admin/actions.ts");
  assert.doesNotMatch(actions, /updateBankTransferDetails/);
  const branding = readCode("src/lib/branding-mutations.ts");
  assert.doesNotMatch(branding, /export async function updateBankTransferDetails/);
});

test("bank transfer state is read from the source checkout actually uses", () => {
  const src = readCode("src/app/tenant-admin/bank-transfer/page.tsx");
  assert.match(src, /tenantPaymentMethod\.findUnique/, "it reads TenantPaymentMethod");
  assert.match(src, /isProviderConfigured/, "readiness uses the checkout predicate");
  assert.doesNotMatch(src, /branding\.findUnique/, "it no longer reads Branding");
  // Tenant isolation is unchanged: scoped db plus the trusted tenantId.
  assert.match(src, /requireTenantAdmin\(\)/);
  assert.match(src, /getScopedDb\(tenantId\)/);
});

test("payments and shipping keep exactly one page heading each", () => {
  for (const rel of [
    "src/app/tenant-admin/payments/page.tsx",
    "src/app/tenant-admin/shipping/page.tsx",
    "src/app/tenant-admin/bank-transfer/page.tsx",
  ]) {
    const src = readCode(rel);
    assert.equal((src.match(/<h1/g) ?? []).length, 0, `${rel} must not add a second h1`);
    assert.equal((src.match(/<main/g) ?? []).length, 0, `${rel} must not nest a second main`);
    assert.equal(
      (src.match(/<AdminPageHeader/g) ?? []).length,
      1,
      `${rel} has exactly one page header`,
    );
  }
});

// --- Catalog CTA hierarchy ---
//
// These assert that the visible CTA model matches the ACTUAL persistence
// model: one scoped label per Server Action, and no generic "Save".

test("the catalog has exactly one dominant Add product action", () => {
  const src = readCode("src/app/tenant-admin/catalog/page.tsx");
  // One primary button on the page, and it is the creating action.
  assert.equal(
    (src.match(/className=\{adminButtonPrimaryClassName\}/g) ?? []).length,
    1,
    "exactly one primary CTA on the catalog page",
  );
  assert.match(src, /Add a product/);
});

test("import and export are secondary tools, not competing primaries", () => {
  const importForm = readCode("src/app/tenant-admin/ImportProductsForm.tsx");
  const exportButton = readCode("src/app/tenant-admin/ExportCsvButton.tsx");
  // Neither uses the filled primary treatment.
  assert.doesNotMatch(importForm, /bg-foreground/, "import is not a filled primary");
  assert.doesNotMatch(exportButton, /bg-foreground/, "export is not a filled primary");
  // Both are scoped by name.
  assert.match(importForm, /Import products/);
  assert.match(exportButton, /Export \$\{label\}/);
  // And both live behind the CSV disclosure rather than beside Add product.
  const catalog = readCode("src/app/tenant-admin/catalog/page.tsx");
  assert.ok(
    catalog.indexOf("CSV import and export") < catalog.indexOf("<ImportProductsForm"),
    "import sits inside the CSV disclosure",
  );
});

test("no catalog action is labelled with a bare generic verb", () => {
  const src = readCode("src/app/tenant-admin/catalog/page.tsx");
  for (const generic of ["Save", "Update", "Submit", "Remove", "Delete"]) {
    assert.doesNotMatch(
      src,
      new RegExp(`submitLabel="${generic}"`),
      `"${generic}" alone does not say what it commits`,
    );
  }
});

test("each catalog Server Action has its own scoped label", () => {
  const src = readCode("src/app/tenant-admin/catalog/page.tsx");
  for (const label of [
    "Save product",
    "Save variant",
    "Adjust",
    "Generate variants",
    "Assign option",
    "Add option",
    "Add value",
    "Remove option",
    "Delete value",
    "Remove discount",
  ]) {
    assert.match(src, new RegExp(`submitLabel=(\\{)?["']${label}["']`), `${label} is used`);
  }
});

test("the product form's single Save matches its single transaction", () => {
  // updateProductAction persists name, price, status AND description in one
  // call, so one page-level Save is accurate — not a facade over several.
  const actions = readCode("src/app/tenant-admin/actions.ts");
  const body = actions.slice(actions.indexOf("export async function updateProductAction"));
  const fn = body.slice(0, body.indexOf("export async function", 10));
  for (const field of ["name", "price", "status", "description"]) {
    assert.match(fn, new RegExp(`${field}:`), `${field} is part of the same transaction`);
  }

  const catalog = readCode("src/app/tenant-admin/catalog/page.tsx");
  // Exactly one form posts updateProductAction per product.
  assert.equal(
    (catalog.match(/action=\{updateProductAction\}/g) ?? []).length,
    1,
    "one product form, one Save product",
  );
  // And the description editor lives inside it rather than owning a save.
  assert.ok(
    catalog.indexOf("action={updateProductAction}") < catalog.indexOf("<DescriptionEditor"),
    "the description is part of the product form",
  );
});

test("independent resources keep their own actions rather than being merged", () => {
  const catalog = readCode("src/app/tenant-admin/catalog/page.tsx");
  // A variant is a separate resource with a separate action, so it keeps a
  // separate scoped save instead of being folded into Save product.
  assert.match(catalog, /action=\{updateProductVariantAction\}/);
  assert.match(catalog, /submitLabel="Save variant"/);
  // Inventory stays an operational adjustment, never a "Save".
  assert.match(catalog, /action=\{adjustInventoryOnHandAction\}/);
  assert.match(catalog, /submitLabel="Adjust"/);
  assert.match(catalog, /Adjust by/, "the field states what the number does");
});

test("media commits on upload, so it has no Save of its own", () => {
  const gallery = readCode("src/app/tenant-admin/ProductMediaGallery.tsx");
  assert.doesNotMatch(gallery, /submitLabel="Save"/);
  assert.match(gallery, /Upload media/);
  assert.match(gallery, /aria-label="Remove media"/);
  // The WebP wording added by the media pipeline work is still shown here.
  assert.match(gallery, /stored as WebP/);
});

test("a collapsed product summarises its own state", () => {
  const src = readCode("src/app/tenant-admin/catalog/page.tsx");
  assert.match(src, /image\{product\.media\.length === 1/, "media count is in the summary");
  assert.match(src, /'Discounted' : 'No discount'/, "discount state is in the summary");
});

test("destructive catalog actions stay confirmation-protected", () => {
  const src = readCode("src/app/tenant-admin/catalog/page.tsx");
  // These two destroy generated variant data, and both still confirm.
  for (const action of ["removeProductOptionAction", "deleteVariantOptionValueAction"]) {
    const idx = src.indexOf(`action={${action}}`);
    assert.ok(idx > -1, `${action} is still wired up`);
    const nearby = src.slice(Math.max(0, idx - 400), idx + 400);
    assert.match(nearby, /ConfirmActionForm/, `${action} still confirms`);
    assert.match(nearby, /variant="danger"/, `${action} still reads as destructive`);
  }
});

test("removing a discount requires confirmation, like every other destructive catalog action", () => {
  const src = readCode("src/app/tenant-admin/catalog/page.tsx");
  const idx = src.indexOf("action={deleteProductDiscountAction}");
  assert.ok(idx > -1, "the action is still wired up");

  // The form around it is the confirming one, not a plain ActionForm.
  const before = src.slice(Math.max(0, idx - 300), idx);
  const after = src.slice(idx, idx + 600);
  assert.match(before, /<ConfirmActionForm/, "the enclosing form is the confirming one");
  assert.match(after, /<\/ConfirmActionForm>/, "it closes as a ConfirmActionForm");
  assert.doesNotMatch(after, /<\/ActionForm>/, "it is no longer a plain ActionForm");

  assert.match(after, /submitLabel="Remove discount"/, "the scoped label is kept");
  assert.match(after, /variant="danger"/, "it still reads as destructive");
  // The confirmation says what will happen, in plain terms.
  assert.match(after, /confirmMessage="Remove this discount/);
  assert.match(after, /full price/, "the consequence is stated");
  // The payload is untouched.
  assert.match(after, /name="productId"/);
});

test("cancelling a confirmation sends no request", () => {
  // The guard lives in ConfirmActionForm: a declined confirm() calls
  // preventDefault(), so the action is never invoked. Asserted at the
  // component, which is what every destructive catalog control shares.
  const src = readCode("src/components/ConfirmActionForm.tsx");
  assert.match(src, /window\.confirm\(message\)/);
  assert.match(src, /if \(!window\.confirm\(message\)\) \{\s*e\.preventDefault\(\);/);
  assert.match(src, /disabled=\{pending\}/, "duplicate submission stays blocked");
  assert.match(src, /role="alert"/, "failures still use the alert convention");
});

test("the danger variant is additive, so default callers are unaffected", () => {
  const form = readCode("src/components/ActionForm.tsx");
  assert.match(form, /variant = 'default'/, "default is unchanged");
  assert.match(form, /variant === 'danger'/);
  assert.match(form, /border-red-300/, "danger uses the established destructive treatment");
});

test("each variant Save button gets the row's own accessible name", () => {
  const src = readCode("src/app/tenant-admin/catalog/page.tsx");
  // Visible text is unchanged...
  assert.match(src, /submitLabel="Save variant"/);
  // ...while the accessible name carries the row context.
  assert.match(src, /submitAriaLabel=\{`Save variant \$\{variantContextLabel\(/);
  // Built from the human-readable combination, never an id.
  assert.match(src, /return formatCombination\(variant, optionNameById, valueLabelById\);/);
  assert.doesNotMatch(src, /submitAriaLabel=\{`Save variant \$\{variant\.id/);
});

test("the variant context label falls back safely on every edge case", () => {
  const src = readCode("src/app/tenant-admin/catalog/page.tsx");
  const fn = src.slice(src.indexOf("function variantContextLabel"));
  const body = fn.slice(0, fn.indexOf("\n}") + 2);
  // No options -> SKU (already user-facing) -> a generic phrase.
  assert.match(body, /variant\.optionValues\.length > 0/);
  assert.match(body, /variant\.sku/);
  assert.match(body, /'without options'/);
  // formatCombination already handles a missing option or value label.
  const formatter = src.slice(src.indexOf("function formatCombination"));
  assert.match(formatter.slice(0, 700), /\?\?\s*'\?'/, "unknown labels degrade, never throw");
});

test("the accessible-name override cannot change what is submitted", () => {
  const form = readCode("src/components/ActionForm.tsx");
  assert.match(form, /submitAriaLabel\?: string;/);
  assert.match(form, /aria-label=\{submitAriaLabel\}/);
  // It is presentational only: no name, no value, no formData involvement.
  const button = form.slice(form.indexOf("<button"), form.indexOf("</button>"));
  assert.doesNotMatch(button, /name=/, "the override adds no form field");
  assert.doesNotMatch(button, /value=/);
});

test("the danger variant is additive, so default callers are unaffected", () => {
  const form = readCode("src/components/ActionForm.tsx");
  assert.match(form, /variant = 'default'/, "default is unchanged");
  assert.match(form, /variant === 'danger'/);
  assert.match(form, /border-red-300/, "danger uses the established destructive treatment");
});

test("import reports pending, success and failure accessibly", () => {
  const src = readCode("src/app/tenant-admin/ImportProductsForm.tsx");
  assert.match(src, /Importing…/, "pending state is visible, not only disabled");
  assert.match(src, /disabled=\{pending\}/, "duplicate submission is blocked");
  assert.match(src, /role="alert"/, "parse/validation errors are announced");
  assert.match(src, /role="status"/, "the import summary is announced");
  assert.match(src, /failed/, "partial failure is still reported, never silent");
});

test("catalog save feedback uses the shared accessible status conventions", () => {
  const form = readCode("src/components/ActionForm.tsx");
  assert.match(form, /disabled=\{pending \|\| disabled\}/, "Save is disabled while pending");
  assert.match(form, /role="alert"/, "failures are announced");
  const toast = readCode("src/components/Toast.tsx");
  assert.match(toast, /role="status"/, "successes are announced politely");
});

test("the catalog keeps one page heading and adds no landmark", () => {
  const src = readCode("src/app/tenant-admin/catalog/page.tsx");
  assert.equal((src.match(/<h1/g) ?? []).length, 0);
  assert.equal((src.match(/<main/g) ?? []).length, 0);
  assert.equal((src.match(/<AdminPageHeader/g) ?? []).length, 1);
});

// --- Provider switching ---

test("switching a configured payment provider requires confirmation", () => {
  const page = readCode("src/app/tenant-admin/payments/page.tsx");
  // The bank-transfer form is the confirming variant.
  assert.match(page, /<ConfirmActionForm/);
  assert.match(page, /confirmWhen=\{\{ field: 'provider', differsFrom: bankProvider \}\}/);
  // The copy states what is lost, not merely that something will change.
  assert.match(page, /Switch bank transfer provider\?/);
  assert.match(page, /is replaced by the fields of the one you picked/);
  assert.match(page, /cannot be recovered from here/);
});

test("confirmation is skipped when there is nothing to lose", () => {
  const page = readCode("src/app/tenant-admin/payments/page.tsx");
  // Derived from the stored config, on the server.
  assert.match(page, /const hasStoredBankConfig = Object\.values\(bankConfig \?\? \{\}\)/);
  assert.match(page, /value\.trim\(\) !== ''/, "a half-filled config still counts");
  assert.match(page, /skipConfirmation=\{!hasStoredBankConfig\}/);
});

test("an unchanged provider submits without a dialog", () => {
  // confirmWhen compares the SUBMITTED value against the stored one, so an
  // ordinary save of the same form is not gated.
  const src = readCode("src/components/ConfirmActionForm.tsx");
  assert.match(src, /if \(skipConfirmation\) return;/);
  assert.match(
    src,
    /String\(formData\.get\(confirmWhen\.field\) \?\? ''\) === confirmWhen\.differsFrom/,
  );
});

test("declining a provider switch sends no request", () => {
  // Structural: the guard is preventDefault() on the form's own submit, the
  // same mechanism every destructive control in this admin relies on.
  const src = readCode("src/components/ConfirmActionForm.tsx");
  assert.match(src, /if \(!window\.confirm\(message\)\) \{\s*e\.preventDefault\(\);/);
});

test("confirming preserves the existing mutation and payload", () => {
  const page = readCode("src/app/tenant-admin/payments/page.tsx");
  // Same action, same hidden method field, same provider values, same names.
  assert.match(page, /action=\{updateTenantPaymentMethodAction\}/);
  assert.match(page, /name="method" value="bank_transfer"/);
  assert.match(page, /value="bank_transfer_manual"/);
  assert.match(page, /value="bank_transfer_sepay_va"/);
  for (const field of ["bankName", "bankAccountNumber", "bankAccountHolder", "sepayBaUuid"]) {
    assert.match(page, new RegExp(`name="${field}"`));
  }
});

test("provider validation itself is unchanged", () => {
  const mutations = readCode("src/lib/tenant-payment-mutations.ts");
  // The server still rejects enabling an incompletely configured provider.
  assert.match(mutations, /input\.enabled && \(!bankName \|\| !bankAccountNumber/);
  assert.match(mutations, /input\.enabled && !baUuid/);
  // And tenantId still comes from the caller, never from form input.
  assert.match(mutations, /tenantId must be the trusted value|tenantId: string/);
  assert.doesNotMatch(mutations, /formData/);
});

test("the conditional-confirmation props default to the previous behaviour", () => {
  const src = readCode("src/components/ConfirmActionForm.tsx");
  assert.match(src, /skipConfirmation = false/, "existing callers still always confirm");
  assert.match(src, /confirmWhen\?: \{ field: string; differsFrom: string \}/);
});
