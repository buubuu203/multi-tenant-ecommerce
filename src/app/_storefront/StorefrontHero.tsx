import type { ResolvedBranding } from "./resolve-branding";

export function StorefrontHero({
  branding,
  comingSoon,
  fillViewport = false,
}: {
  branding: ResolvedBranding;
  comingSoon: boolean;
  /**
   * Stretch to fill the remaining viewport height. Correct only when the
   * hero is the page's ONLY content (a coming-soon store, or an open one
   * with no products yet — ProductList renders nothing in that case).
   *
   * It must stay off when a catalogue follows: `flex-1` absorbs all
   * leftover space, so on a tall screen the hero grew to ~60% of the fold
   * around a few lines of text and pushed the products — the actual point
   * of a shop — below it.
   */
  fillViewport?: boolean;
}) {
  return (
    <section
      className={`flex flex-col items-center justify-center gap-4 px-6 py-20 text-center text-white sm:py-28 ${
        fillViewport ? "flex-1" : ""
      }`}
      style={{ backgroundColor: branding.primaryColor }}
    >
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        {comingSoon ? `${branding.storeName} is coming soon` : `Welcome to ${branding.storeName}`}
      </h1>
      <p className="max-w-md text-sm text-white/85 sm:text-base">
        {comingSoon
          ? "We're getting ready. Check back soon."
          : "This storefront is running on our shared platform, styled with this shop's own branding."}
      </p>
      <span
        className="mt-2 rounded-full px-4 py-1.5 text-xs font-medium tracking-wide text-white uppercase"
        style={{ backgroundColor: branding.secondaryColor }}
      >
        {comingSoon ? "Coming soon" : "Now open"}
      </span>
    </section>
  );
}
