"use client";

import { useState } from "react";
import type { TenantProductMedia } from "./get-tenant-products";

// Step 50: replaces the old single <img src={product.imageUrl}> on the
// product detail page. Order always follows ProductMedia.sortOrder — the
// data layer (get-tenant-products.ts) already returns media pre-sorted,
// this component never re-sorts. Videos get native <video controls muted>
// — controls so the customer can operate playback normally, muted so
// nothing autoplays with sound (this component never sets `autoPlay`
// anyway, so nothing plays until the customer presses play).
export function ProductMediaCarousel({ media, productName }: { media: TenantProductMedia[]; productName: string }) {
  const [index, setIndex] = useState(0);

  if (media.length === 0) {
    return null;
  }

  const current = media[index];

  function go(delta: number) {
    setIndex((i) => (i + delta + media.length) % media.length);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-muted">
        {current.type === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- deliberate: no image-optimization infra in this MVP
          <img src={current.url} alt={productName} className="h-full w-full object-cover" />
        ) : (
          <video src={current.url} controls muted className="h-full w-full object-contain" />
        )}
        {media.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous media"
              className="absolute left-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
            >
              ◀
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next media"
              className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
            >
              ▶
            </button>
          </>
        )}
      </div>

      {media.length > 1 && (
        <div className="flex gap-2 overflow-x-auto">
          {media.map((item, i) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show media ${i + 1}`}
              className={`relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-md border transition-colors ${i === index ? "border-foreground" : "border-border"}`}
            >
              {item.type === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element -- deliberate: no image-optimization infra in this MVP
                <img src={item.url} alt="" className="h-full w-full object-cover" />
              ) : (
                <>
                  <video src={item.url} muted className="h-full w-full object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-xs text-white">▶</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
