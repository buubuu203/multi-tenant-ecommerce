"use client";

import { useState } from "react";
import type { StorefrontBanner } from "./get-active-banners";

// Storefront Carousel/Banner (V1). Zero banners never reaches this
// component (the caller falls back to the existing StorefrontHero — see
// page.tsx); this only ever renders for one or more ENABLED banners.
export function BannerCarousel({ banners }: { banners: StorefrontBanner[] }) {
  const [index, setIndex] = useState(0);
  const current = banners[index];
  const hasMultiple = banners.length > 1;

  function goTo(next: number) {
    setIndex((next + banners.length) % banners.length);
  }

  return (
    <section
      // "region" + roledescription is the standard accessible pattern for
      // a carousel (no native HTML element covers this) — a screen reader
      // announces it as a carousel rather than a generic group.
      role="region"
      aria-roledescription="carousel"
      aria-label="Featured"
      className="relative flex flex-col"
      onKeyDown={(e) => {
        if (!hasMultiple) return;
        if (e.key === "ArrowLeft") goTo(index - 1);
        if (e.key === "ArrowRight") goTo(index + 1);
      }}
    >
      <div
        className="relative flex min-h-[220px] flex-col items-center justify-center gap-3 overflow-hidden bg-cover bg-center px-6 py-16 text-center text-white sm:min-h-[320px] sm:py-24"
        style={{ backgroundImage: `url(${current.imageUrl})` }}
        aria-live="polite"
      >
        {/* Scrim for text legibility over an arbitrary merchant photo —
            independent of the image itself, never baked into the upload. */}
        <div className="absolute inset-0 bg-black/40" aria-hidden="true" />
        <div className="relative flex flex-col items-center gap-3">
          <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-4xl">{current.title}</h2>
          {current.subtitle && (
            <p className="max-w-md text-sm text-white/90 sm:text-base">{current.subtitle}</p>
          )}
          {current.ctaLabel && current.ctaUrl && (
            <a
              href={current.ctaUrl}
              className="mt-2 rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90"
            >
              {current.ctaLabel}
            </a>
          )}
        </div>

        {hasMultiple && (
          <>
            <button
              type="button"
              onClick={() => goTo(index - 1)}
              aria-label="Previous banner"
              className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white transition-colors hover:bg-black/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => goTo(index + 1)}
              aria-label="Next banner"
              className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white transition-colors hover:bg-black/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            >
              ›
            </button>
          </>
        )}
      </div>

      {hasMultiple && (
        <div className="flex items-center justify-center gap-1.5 bg-background py-2" role="tablist" aria-label="Banner selection">
          {banners.map((banner, i) => (
            <button
              key={banner.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Show banner ${i + 1} of ${banners.length}`}
              onClick={() => goTo(i)}
              className={`h-2 w-2 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground ${
                i === index ? "bg-foreground" : "bg-border hover:bg-muted-foreground"
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
