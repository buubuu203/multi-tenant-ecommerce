"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";

// The header's search box (Board 5) — the single search input on the
// page; ProductList reads its own filter state from the `?q=` URL param
// this writes, rather than owning a second input (see ProductList.tsx's
// doc comment on why it dropped its old inline one). Submitting from any
// page navigates to "/" with the query attached, since the catalog only
// renders on the home route.
export function SearchBox({ placeholder }: { placeholder: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(() => searchParams.get("q") ?? "");

  // Keep the field in sync if the URL changes from elsewhere (e.g. the
  // browser back button after a search) — genuinely subscribing to an
  // external system (the URL) and syncing local state from it, the exact
  // case this lint rule's own description carves out.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from the URL (an external system), not a synchronization loop
    setValue(searchParams.get("q") ?? "");
  }, [searchParams]);

  function submit() {
    const params = new URLSearchParams(pathname === "/" ? searchParams.toString() : "");
    if (value.trim()) params.set("q", value.trim());
    else params.delete("q");
    router.push(`/${params.toString() ? `?${params.toString()}` : ""}`);
  }

  return (
    <div className="relative flex-1" style={{ maxWidth: "560px", margin: "0 auto" }}>
      <span
        className="pointer-events-none absolute"
        style={{ left: "16px", top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)" }}
      >
        <Icon name="search" size={20} />
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="field-glass"
        style={{ paddingLeft: "46px", borderRadius: "var(--radius-pill)" }}
      />
    </div>
  );
}
