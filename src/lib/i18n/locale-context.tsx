"use client";

import { createContext, useContext, useTransition, type ReactNode } from "react";
import type { Locale } from "./types";

const LocaleContext = createContext<Locale>("vi");

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}
