import Link from "next/link";
import type { ResolvedBranding, FooterContact } from "./resolve-branding";
import { Icon } from "./Icon";
import { LocalePills } from "@/components/LocalePills";
import type { useDictionary } from "@/lib/i18n/use-dictionary";

type Dict = ReturnType<typeof useDictionary>;

export function SiteFooter({
  branding,
  contact,
  dict,
}: {
  branding: ResolvedBranding;
  contact: FooterContact | null;
  dict: Dict;
}) {
  const socials = contact
    ? [
        contact.facebookUrl && { href: contact.facebookUrl, label: "Facebook" },
        contact.instagramUrl && { href: contact.instagramUrl, label: "Instagram" },
        contact.tiktokUrl && { href: contact.tiktokUrl, label: "TikTok Shop" },
        contact.zaloUrl && { href: contact.zaloUrl, label: "Zalo" },
      ].filter((s): s is { href: string; label: string } => Boolean(s))
    : [];
  const hasContactLine = Boolean(contact && (contact.address || contact.phone || contact.email || contact.businessId));

  return (
    <footer
      className="glass grid grid-cols-1 gap-7 sm:grid-cols-3"
      style={{ borderRadius: "var(--radius-card)", padding: "28px 32px" }}
      aria-label={dict.footer.ariaLabel}
    >
      <div className="flex flex-col gap-2.5">
        <span className="ui" style={{ fontSize: "20px" }}>
          {branding.storeName}
        </span>
        {/* Each line/button below renders only when its own field has
            data — never a placeholder, never an empty gap where a line
            would be. */}
        {contact?.tagline && (
          <span className="small" style={{ color: "var(--ink-2)" }}>
            {contact.tagline}
          </span>
        )}
        {contact?.address && (
          <span className="small flex items-start gap-2" style={{ color: "var(--ink-2)" }}>
            <Icon name="pin" size={15} style={{ marginTop: "2px", flexShrink: 0 }} />
            {contact.address}
          </span>
        )}
        {contact?.phone && (
          <span className="small flex items-start gap-2" style={{ color: "var(--ink-2)" }}>
            <Icon name="phone" size={15} style={{ marginTop: "2px", flexShrink: 0 }} />
            {contact.phone}
          </span>
        )}
        {contact?.email && (
          <span className="small flex items-start gap-2" style={{ color: "var(--ink-2)" }}>
            <Icon name="mail" size={15} style={{ marginTop: "2px", flexShrink: 0 }} />
            {contact.email}
          </span>
        )}
        {contact?.businessId && (
          <span className="small flex items-start gap-2" style={{ color: "var(--ink-2)" }}>
            <Icon name="store" size={15} style={{ marginTop: "2px", flexShrink: 0 }} />
            {contact.businessId}
          </span>
        )}
        {!hasContactLine && !socials.length ? null : socials.length > 0 ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {socials.map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noreferrer"
                className="chip"
                style={{ minHeight: "44px" }}
              >
                {s.label}
              </a>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2.5">
        <span className="kicker">{dict.footer.shop}</span>
        <Link href="/" className="small" style={{ minHeight: "36px", display: "inline-flex", alignItems: "center" }}>
          {dict.footer.allProducts}
        </Link>
        <Link href="/orders" className="small" style={{ minHeight: "36px", display: "inline-flex", alignItems: "center" }}>
          {dict.footer.trackOrder}
        </Link>
      </div>

      <div className="flex flex-col gap-2.5">
        <span className="kicker">{dict.footer.policy}</span>
        <Link href="/policy" className="small" style={{ minHeight: "36px", display: "inline-flex", alignItems: "center" }}>
          {dict.footer.purchasePolicy}
        </Link>
        <Link href="/privacy" className="small" style={{ minHeight: "36px", display: "inline-flex", alignItems: "center" }}>
          {dict.footer.privacy}
        </Link>
      </div>

      {/* "Tìm cửa hàng" + embedded map — explicitly deferred to a later
          phase, so this column is left out of the grid entirely (not
          rendered empty) and the 3 real columns above share the row
          evenly (grid-cols-3, not 4). */}

      <div
        className="small col-span-full flex flex-wrap items-center justify-between gap-2 pt-3.5"
        style={{ borderTop: "1px solid var(--divider)", color: "var(--ink-2)" }}
      >
        <span>© {new Date().getFullYear()} {branding.storeName}</span>
        <LocalePills />
      </div>
    </footer>
  );
}
