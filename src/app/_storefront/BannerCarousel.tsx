"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { StorefrontBanner } from "./get-active-banners";
import { Icon } from "./Icon";
import { useDictionary } from "@/lib/i18n/use-dictionary";

// Storefront Carousel/Banner (V1). Zero banners never reaches this
// component (the caller falls back to the existing StorefrontHero — see
// page.tsx); this only ever renders for one or more ENABLED banners.
//
// V1.1: the image IS the content — no title/subtitle text is ever
// rendered over it (the merchant's photo carries the message). A
// `<picture>`-equivalent (next/image doesn't support <source> media
// swaps directly, so this picks the URL in JS instead) swaps in an
// optional, separately-cropped mobile image below this breakpoint; when
// a banner has no mobileImageUrl, the desktop image is used at every
// viewport, matching Banner.mobileImageUrl being null = "no separate
// mobile crop" throughout the rest of the app.
const MOBILE_BREAKPOINT_PX = 640;

function accessibleLabelFor(banner: StorefrontBanner): string {
  // With no title/subtitle to fall back to, the CTA label is the most
  // meaningful thing left to describe a banner to a screen reader; a
  // generic fallback covers the (permitted) case of an image-only banner
  // with no CTA at all.
  return banner.ctaLabel ? `${banner.ctaLabel} banner` : "Promotional banner";
}

export function BannerCarousel({ banners }: { banners: StorefrontBanner[] }) {
  const [index, setIndex] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [paused, setPaused] = useState(false);
  const dict = useDictionary();
  const current = banners[index];
  const hasMultiple = banners.length > 1;
  const hasCta = Boolean(current.ctaLabel && current.ctaUrl);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  function goTo(next: number) {
    setIndex((next + banners.length) % banners.length);
  }

  // Autoplay every 6s, paused on hover/focus and entirely skipped under
  // prefers-reduced-motion — restarts on `index` so a manual prev/next/
  // dot click pushes the next auto-advance out a full 6s instead of
  // firing right away.
  useEffect(() => {
    if (!hasMultiple || paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => {
      setIndex((current) => (current + 1) % banners.length);
    }, 6000);
    return () => clearInterval(id);
  }, [hasMultiple, paused, banners.length, index]);

  const imageUrl = (isMobile && current.mobileImageUrl) || current.imageUrl;

  return (
    <section
      // "region" + roledescription is the standard accessible pattern for
      // a carousel (no native HTML element covers this) — a screen reader
      // announces it as a carousel rather than a generic group.
      role="region"
      aria-roledescription="carousel"
      aria-label="Featured"
      // Full width again, matching every other section on this page
      // (header, category pills, product grid) — an earlier attempt
      // narrowed this to a centered column to shrink it, which instead
      // made it look like a stray island against the rest of the
      // full-bleed layout.
      className="glass relative flex w-full flex-col overflow-hidden"
      style={{ borderRadius: "var(--radius-card)" }}
      onKeyDown={(e) => {
        if (!hasMultiple) return;
        if (e.key === "ArrowLeft") goTo(index - 1);
        if (e.key === "ArrowRight") goTo(index + 1);
      }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchStartX.current == null || !hasMultiple) return;
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        if (Math.abs(dx) > 40) goTo(dx < 0 ? index + 1 : index - 1);
        touchStartX.current = null;
      }}
    >
      <div
        // Capped at a comfortable hero height, full width — the stored
        // image is 16:9, which would otherwise force this frame very tall
        // on a wide desktop viewport. Rather than crop (object-cover) or
        // shrink the whole banner into an island (max-width), this uses
        // the same "blurred backdrop + object-contain foreground" pattern
        // already proven on the PDP gallery (ProductMediaCarousel.tsx):
        // the real image is NEVER cropped, just letterboxed, with a
        // blurred copy of itself filling the letterbox bars instead of a
        // flat background color.
        className="relative w-full overflow-hidden"
        style={{ aspectRatio: "21/9", maxHeight: "420px" }}
        aria-live="polite"
      >
        <Image
          key={`${imageUrl}-backdrop`}
          src={imageUrl}
          alt=""
          aria-hidden="true"
          fill
          sizes="(max-width: 1023px) 100vw, 1344px"
          className="object-cover object-center"
          style={{ filter: "blur(32px) saturate(1.15)", transform: "scale(1.15)" }}
        />
        <Image
          key={imageUrl}
          src={imageUrl}
          alt={accessibleLabelFor(current)}
          fill
          priority={index === 0}
          sizes="(max-width: 1023px) 100vw, 1344px"
          className="object-contain object-center spring-fade"
        />

        {hasCta && (
          <>
            {/* Whole-slide click target (QA round, 2026-11-23): a
                decorative link covering the full frame, so a customer can
                click/tap ANYWHERE on the image — including a button baked
                into the photo itself — not just the small explicit CTA
                button below. aria-hidden + tabIndex=-1 because the real,
                accessible link for keyboard/screen-reader users is the
                visible CTA button further down; having both focusable
                would just be the same destination twice. Placed right
                after the two <Image>s, BEFORE the scrim/button/arrows/
                dots below — later siblings paint (and therefore receive
                clicks) on top of this one with no z-index needed, so the
                arrows and dots stay independently clickable. */}
            <a
              href={current.ctaUrl!}
              aria-hidden="true"
              tabIndex={-1}
              className="absolute inset-0"
            />
            {/* Scrim confined to the CTA's corner, not the whole image —
                the photo itself is the content now, so this only exists
                to keep the button legible against an arbitrary background. */}
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/50 to-transparent"
              aria-hidden="true"
            />
            <div className="absolute inset-x-0 flex justify-center" style={{ bottom: hasMultiple ? "44px" : "16px" }}>
              <a href={current.ctaUrl!} className="btn-primary cta">
                {current.ctaLabel}
              </a>
            </div>
          </>
        )}

        {hasMultiple && (
          <>
            {/* Arrows: 44px glass circles, 16px from each edge, hidden
                below 768px (swipe takes over — see onTouchStart/End). */}
            <button
              type="button"
              onClick={() => goTo(index - 1)}
              aria-label={dict.storefront.previousBanner}
              className="glass absolute top-1/2 hidden -translate-y-1/2 items-center justify-center rounded-full md:flex"
              style={{ left: "16px", width: "44px", height: "44px", border: "1px solid var(--glass-border)" }}
            >
              <Icon name="chevron" style={{ transform: "rotate(180deg)" }} />
            </button>
            <button
              type="button"
              onClick={() => goTo(index + 1)}
              aria-label={dict.storefront.nextBanner}
              className="glass absolute top-1/2 hidden -translate-y-1/2 items-center justify-center rounded-full md:flex"
              style={{ right: "16px", width: "44px", height: "44px", border: "1px solid var(--glass-border)" }}
            >
              <Icon name="chevron" />
            </button>

            {/* Dots: inside the frame, bottom:16px, centered — not a
                separate row below the image anymore. */}
            <div
              className="absolute inset-x-0 z-[1] flex items-center justify-center gap-1.5"
              style={{ bottom: "16px" }}
              role="tablist"
              aria-label="Banner selection"
            >
              {banners.map((banner, i) => (
                <button
                  key={banner.id}
                  type="button"
                  role="tab"
                  aria-selected={i === index}
                  aria-label={`Show banner ${i + 1} of ${banners.length}`}
                  onClick={() => goTo(i)}
                  // The visible dot stays 6px (design intent); the
                  // tappable area around it is padded out to the 44px
                  // minimum target size separately.
                  className="flex items-center justify-center focus-visible:outline focus-visible:outline-2"
                  style={{ width: "44px", height: "44px", outlineColor: "#fff" }}
                >
                  <span
                    aria-hidden="true"
                    className="block rounded-full transition-all"
                    style={{
                      height: "6px",
                      width: i === index ? "26px" : "6px",
                      background: i === index ? "#fff" : "#ffffff80",
                    }}
                  />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
