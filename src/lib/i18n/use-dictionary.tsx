"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Dictionary } from "./dictionaries";

const DictionaryContext = createContext<Dictionary | null>(null);

export function DictionaryProvider({
  dictionary,
  children,
}: {
  dictionary: Dictionary;
  children: ReactNode;
}) {
  return (
    <DictionaryContext.Provider value={dictionary}>
      {children}
    </DictionaryContext.Provider>
  );
}

export function useDictionary(): Dictionary {
  const dict = useContext(DictionaryContext);
  if (!dict) throw new Error("useDictionary must be used within DictionaryProvider");
  return dict;
}
