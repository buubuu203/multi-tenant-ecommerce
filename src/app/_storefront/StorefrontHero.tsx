import type { ResolvedBranding } from "./resolve-branding";

export function StorefrontHero({
  branding,
  comingSoon,
}: {
  branding: ResolvedBranding;
  comingSoon: boolean;
}) {
  return (
    <section
      className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center text-white"
      style={{ backgroundColor: branding.primaryColor }}
    >
      <h1 className="text-3xl font-semibold sm:text-4xl">
        {comingSoon ? `${branding.storeName} is coming soon` : `Welcome to ${branding.storeName}`}
      </h1>
      <p className="max-w-md text-white/90">
        {comingSoon
          ? "We're getting ready. Check back soon."
          : "This storefront is running on our shared platform, styled with this shop's own branding."}
      </p>
      <span
        className="mt-4 rounded-full px-4 py-1.5 text-sm font-medium text-white"
        style={{ backgroundColor: branding.secondaryColor }}
      >
        {comingSoon ? "Coming soon" : "Now open"}
      </span>
    </section>
  );
}
