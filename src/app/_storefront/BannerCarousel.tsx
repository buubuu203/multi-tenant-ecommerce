"use client";

import { useState } from "react";
import type { StorefrontBanner } from "./get-active-banners";

// Storefront Carousel/Banner (V1). Zero banners never reaches this
// component (the caller falls back to the existing StorefrontHero — see
// page.tsx); this only ever renders for one or more ENABLED banners.
//
// V1.1: the image IS the content — no title/subtitle text is ever
// rendered over it (the merchant's photo carries the message). A
// `<picture>` element swaps in an optional, separately-cropped mobile
// image below this breakpoint; when a banner has no mobileImageUrl, the
// desktop image is used at every viewport, matching Banner.mobileImageUrl
// being null = "no separate mobile crop" throughout the rest of the app.
const MOBILE_BREAKPOINT = "(max-width: 639px)";

function accessibleLabelFor(banner: StorefrontBanner): string {
  // With no title/subtitle to fall back to, the CTA label is the most
  // meaningful thing left to describe a banner to a screen reader; a
  // generic fallback covers the (permitted) case of an image-only banner
  // with no CTA at all.
  return banner.ctaLabel ? `${banner.ctaLabel} banner` : "Promotional banner";
}

export function BannerCarousel({ banners }: { banners: StorefrontBanner[] }) {
  const [index, setIndex] = useState(0);
  const current = banners[index];
  const hasMultiple = banners.length > 1;
  const hasCta = Boolean(current.ctaLabel && current.ctaUrl);

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
        // A fixed, consistent aspect ratio (taller on mobile, wide on
        // sm+) so every banner — whatever the merchant's source photo
        // dimensions — fills the frame via object-cover rather than
        // stretching or being cropped unpredictably by content height.
        className="relative aspect-[4/3] w-full overflow-hidden bg-surface-muted sm:aspect-[21/9]"
        aria-live="polite"
      >
        <picture>
          {current.mobileImageUrl && <source media={MOBILE_BREAKPOINT} srcSet={current.mobileImageUrl} />}
          <img
            src={current.imageUrl}
            alt={accessibleLabelFor(current)}
            className="absolute inset-0 h-full w-full object-cover"
          />
        </picture>

        {hasCta && (
          <>
            {/* Scrim confined to the CTA's corner, not the whole image —
                the photo itself is the content now, so this only exists
                to keep the button legible against an arbitrary background. */}
            <div
              className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/50 to-transparent"
              aria-hidden="true"
            />
            <div className="absolute inset-x-0 bottom-4 flex justify-center sm:bottom-6">
              <a
                href={current.ctaUrl!}
                className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black shadow-sm transition-opacity hover:opacity-90"
              >
                {current.ctaLabel}
              </a>
            </div>
          </>
        )}

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
