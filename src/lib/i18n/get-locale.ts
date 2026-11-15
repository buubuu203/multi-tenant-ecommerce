import { cookies } from "next/headers";
import { type Locale, defaultLocale, locales, LOCALE_COOKIE } from "./types";

export async function getLocale(): Promise<Locale> {
  const jar = await cookies();
  const raw = jar.get(LOCALE_COOKIE)?.value;
  if (raw && locales.includes(raw as Locale)) return raw as Locale;
  return defaultLocale;
}
