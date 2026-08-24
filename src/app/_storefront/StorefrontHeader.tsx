import type { ResolvedBranding } from "./resolve-branding";

export function StorefrontHeader({ branding }: { branding: ResolvedBranding }) {
  const initial = branding.storeName.trim().charAt(0).toUpperCase() || "?";

  return (
    <header
      className="flex items-center gap-3 px-6 py-4 border-b border-black/10 dark:border-white/10"
      style={{ borderBottomColor: branding.secondaryColor }}
    >
      {branding.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- tenant-supplied URL, not a static asset
        <img
          src={branding.logoUrl}
          alt={`${branding.storeName} logo`}
          className="h-10 w-10 rounded-full object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="flex h-10 w-10 items-center justify-center rounded-full text-white font-semibold"
          style={{ backgroundColor: branding.primaryColor }}
        >
          {initial}
        </div>
      )}
      <span className="text-lg font-semibold">{branding.storeName}</span>
    </header>
  );
}
