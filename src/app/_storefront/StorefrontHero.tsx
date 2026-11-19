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
      className={`glass flex flex-col items-center justify-center gap-4 px-6 py-16 text-center sm:py-20 ${
        fillViewport ? "flex-1" : ""
      }`}
      style={{
        borderRadius: "var(--radius-card)",
        background: `linear-gradient(145deg, ${branding.primaryColor}, ${branding.secondaryColor})`,
        color: "#fff",
      }}
    >
      <span className="kicker" style={{ color: "rgba(255,255,255,0.85)" }}>
        {comingSoon ? dict.storefront.comingSoon : dict.storefront.nowOpen}
      </span>
      <h1 className="display-section" style={{ fontSize: "clamp(28px, 5vw, 44px)", margin: 0 }}>
        {comingSoon
          ? dict.storefront.comingSoonHeading.replace("{storeName}", branding.storeName)
          : dict.storefront.welcomeHeading.replace("{storeName}", branding.storeName)}
      </h1>
      <p className="max-w-md text-sm sm:text-base" style={{ color: "rgba(255,255,255,0.88)" }}>
        {comingSoon ? dict.storefront.comingSoonBody : dict.storefront.welcomeBody}
      </p>
    </section>
  );
}
