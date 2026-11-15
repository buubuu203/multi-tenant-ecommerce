import type { ResolvedBranding } from "./resolve-branding";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export function StorefrontHero({
  branding,
  comingSoon,
  dict,
  fillViewport = false,
}: {
  branding: ResolvedBranding;
  comingSoon: boolean;
  dict: Dictionary;
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
        {comingSoon
          ? dict.storefront.comingSoonHeading.replace("{storeName}", branding.storeName)
          : dict.storefront.welcomeHeading.replace("{storeName}", branding.storeName)}
      </h1>
      <p className="max-w-md text-sm text-white/85 sm:text-base">
        {comingSoon ? dict.storefront.comingSoonBody : dict.storefront.welcomeBody}
      </p>
      <span
        className="mt-2 rounded-full px-4 py-1.5 text-xs font-medium tracking-wide text-white uppercase"
        style={{ backgroundColor: branding.secondaryColor }}
      >
        {comingSoon ? dict.storefront.comingSoon : dict.storefront.nowOpen}
      </span>
    </section>
  );
}
