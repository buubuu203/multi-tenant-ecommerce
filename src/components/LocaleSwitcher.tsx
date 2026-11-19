"use client";

import { useLocale } from "@/lib/i18n/locale-context";
import { setLocaleAction } from "@/lib/i18n/set-locale-action";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Icon } from "@/app/_storefront/Icon";

export function LocaleSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = locale === "vi" ? "en" : "vi";
    startTransition(async () => {
      await setLocaleAction(next);
      router.refresh();
    });
  }

  return (
    <button
      onClick={toggle}
      disabled={pending}
      className={`btn-ghost ${className ?? ""}`}
      style={{ minHeight: "44px" }}
      aria-label={locale === "vi" ? "Switch to English" : "Chuyển sang Tiếng Việt"}
    >
      <Icon name="globe" size={18} />
      {pending ? "…" : locale === "vi" ? "VI" : "EN"}
    </button>
  );
}
