"use client";

import { useLocale } from "@/lib/i18n/locale-context";
import { setLocaleAction } from "@/lib/i18n/set-locale-action";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

// Footer's "VI · EN" control (Board 5) — two real buttons, not a static
// label. Same underlying mechanism as LocaleSwitcher.tsx (cookie-backed
// setLocaleAction + router.refresh()), so picking a locale here and the
// header's own switcher always agree: there is exactly one locale cookie,
// and <html lang> is set server-side off it on every re-render — nothing
// here sets it directly.
export function LocalePills() {
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(next: "vi" | "en") {
    if (next === locale || pending) return;
    startTransition(async () => {
      await setLocaleAction(next);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Language">
      {(["vi", "en"] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => choose(code)}
          disabled={pending}
          aria-pressed={locale === code}
          className="chip"
          style={{
            minHeight: "44px",
            minWidth: "44px",
            justifyContent: "center",
            ...(locale === code ? { background: "var(--ink)", color: "var(--on-ink)", borderColor: "var(--ink)" } : {}),
          }}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
