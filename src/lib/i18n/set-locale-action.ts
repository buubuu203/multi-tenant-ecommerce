"use server";

import { cookies } from "next/headers";
import { type Locale, locales, LOCALE_COOKIE } from "./types";

export async function setLocaleAction(locale: string) {
  if (!locales.includes(locale as Locale)) return;
  const jar = await cookies();
  jar.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
