"use client";

import { useLocale } from "@/lib/i18n/locale-context";
import { setLocaleAction } from "@/lib/i18n/set-locale-action";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

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
      className={`rounded-md border border-border px-2 py-1 text-xs font-medium transition-colors hover:bg-accent ${className ?? ""}`}
      aria-label={locale === "vi" ? "Switch to English" : "Chuyển sang Tiếng Việt"}
    >
      {pending ? "…" : locale === "vi" ? "EN" : "VI"}
    </button>
  );
}
