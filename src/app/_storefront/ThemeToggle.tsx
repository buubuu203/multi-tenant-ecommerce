"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";

type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "buyer-theme-mode";
const ORDER: ThemeMode[] = ["system", "light", "dark"];

function applyTheme(mode: ThemeMode) {
  if (mode === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", mode);
  }
}

// Light/dark/system toggle for the buyer header. Independent of tenant
// skin (glass/poprint) — this only ever touches data-theme, which the
// existing CSS in globals.css already branches on for both
// .storefront-glass and .admin-chrome (prefers-color-scheme as the
// "system" default, [data-theme] as the explicit override). See
// layout.tsx's inline <script> for the matching pre-hydration read that
// keeps this choice from flashing the wrong theme on load.
export function ThemeToggle() {
  // Starts "system" on both server and first client render so hydration
  // never mismatches; the real saved value (if any) is read in an effect,
  // same reasoning as the blocking <script> but for React's own state.
  const [mode, setMode] = useState<ThemeMode>("system");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "light" || saved === "dark" || saved === "system") {
        // One-time, SSR-safe localStorage hydration after mount — same
        // posture as cart-context.tsx's loadFromStorage() effect.
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time SSR-safe localStorage hydration, not a synchronization loop
        setMode(saved);
      }
    } catch {
      // Private browsing / storage disabled — stays "system".
    }
  }, []);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    setMode(next);
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Nothing to persist to — the in-memory choice still applies this session.
    }
  }

  const icon = mode === "dark" ? "moon" : mode === "light" ? "sun" : "moon";
  const titleByMode: Record<ThemeMode, string> = {
    system: "Theo hệ thống",
    light: "Sáng",
    dark: "Tối",
  };

  return (
    <button
      type="button"
      onClick={cycle}
      className="btn-ghost"
      aria-label="Chế độ sáng / tối"
      title={`Sáng / Tối / Theo hệ thống — hiện tại: ${titleByMode[mode]}`}
      style={{ width: "44px", height: "44px", padding: 0, justifyContent: "center" }}
    >
      <Icon name={icon} />
    </button>
  );
}
