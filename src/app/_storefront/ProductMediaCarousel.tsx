"use client";

import { useEffect, useRef, useState } from "react";
import type { TenantProductMedia } from "./get-tenant-products";
import { Icon } from "./Icon";

// Board 6: the stage is always a square, and the media inside it is
// always shown in FULL (object-contain) — never cropped. The space
// object-contain leaves empty is filled with a blurred, scaled copy of
// the same media (blur 26px, scale 1.25, matching the design board
// exactly) rather than a flat grey fill, so a non-square image/video
// still reads as "centered on its own photo," not "floating on a
// placeholder." For video there's no separate poster asset in this data
// model (TenantProductMedia has no posterUrl field) — the blurred
// backdrop reuses the video itself (muted, no controls, paused on frame
// 1) rather than inventing a poster that doesn't exist.
function MediaStage({ item }: { item: TenantProductMedia }) {
  if (item.type === "image") {
    return (
      <>
        <img
          src={item.url}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ filter: "blur(26px) saturate(1.15)", transform: "scale(1.25)" }}
        />
        <img src={item.url} alt="" className="relative z-[1] h-full w-full object-contain" />
      </>
    );
  }
  return (
    <>
      <video
        src={item.url}
        muted
        playsInline
        preload="metadata"
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover"
        style={{ filter: "blur(26px) saturate(1.15)", transform: "scale(1.25)" }}
      />
      <video
        src={item.url}
        controls
        muted
        playsInline
        className="relative z-[1] h-full w-full object-contain"
      />
    </>
  );
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Play icon + real duration (read off the video element itself via
// loadedmetadata — there's no separate duration field in the data model,
// so this is the only source of truth for it, not a guess).
function VideoThumb({ url }: { url: string }) {
  const [duration, setDuration] = useState<number | null>(null);
  return (
    <>
      <video
        src={url}
        muted
        playsInline
        preload="metadata"
        className="h-full w-full object-cover"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      />
      <span className="absolute inset-0 flex items-center justify-center" style={{ background: "#00000033" }}>
        <Icon name="play" size={22} style={{ color: "#fff", fill: "currentColor" }} />
      </span>
      {duration != null && Number.isFinite(duration) && (
        <span
          className="chip absolute right-1.5 bottom-1.5"
          style={{ minHeight: 0, padding: "1px 7px", fontSize: "11px", background: "#000000a0", color: "#fff", borderColor: "transparent" }}
        >
          {formatDuration(duration)}
        </span>
      )}
    </>
  );
}

export function ProductMediaCarousel({ media, productName }: { media: TenantProductMedia[]; productName: string }) {
  const [index, setIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);

  // Crossfade (Board 2 motion spec, 240ms): the stage never jump-cuts
  // between media — the new item fades in over the old one briefly.
  const [fading, setFading] = useState(false);
  useEffect(() => {
    // A timed visual transition, not derived state — there's no way to
    // compute "opacity 240ms after the index changed" during render; it
    // genuinely needs a timer, same posture as the showAddedFeedback
    // timeout elsewhere in this codebase.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- timed CSS transition trigger, not a synchronization loop
    setFading(true);
    const t = window.setTimeout(() => setFading(false), 240);
    return () => window.clearTimeout(t);
  }, [index]);

  if (media.length === 0) {
    return null;
  }

  const current = media[index];

  function go(delta: number) {
    setIndex((i) => (i + delta + media.length) % media.length);
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className="glass relative w-full overflow-hidden"
        style={{ aspectRatio: "1 / 1", borderRadius: "var(--radius-card)" }}
        onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (touchStartX.current == null) return;
          const dx = e.changedTouches[0].clientX - touchStartX.current;
          if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
          touchStartX.current = null;
        }}
      >
        <div
          className="spring absolute inset-0"
          style={{ opacity: fading ? 0 : 1, transition: "opacity 240ms ease" }}
          aria-label={`${productName} — ${index + 1}/${media.length}`}
        >
          <MediaStage key={current.id} item={current} />
        </div>

        {media.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous media"
              className="btn-ghost absolute top-1/2 left-3 z-[2] -translate-y-1/2 justify-center"
              style={{ width: "44px", height: "44px", padding: 0 }}
            >
              <Icon name="chevron" style={{ transform: "rotate(180deg)" }} />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next media"
              className="btn-ghost absolute top-1/2 right-3 z-[2] -translate-y-1/2 justify-center"
              style={{ width: "44px", height: "44px", padding: 0 }}
            >
              <Icon name="chevron" />
            </button>
            <span
              className="chip absolute right-3 bottom-3 z-[2]"
              style={{ minHeight: 0, padding: "4px 10px", fontSize: "12px" }}
            >
              {index + 1} / {media.length}
            </span>
          </>
        )}
      </div>

      {media.length > 1 && (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${media.length > 5 ? 5 : media.length}, 1fr)` }}>
          {media.map((item, i) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show media ${i + 1}`}
              className="relative aspect-square overflow-hidden"
              style={{
                borderRadius: "18px",
                outline: i === index ? "2.5px solid var(--ink)" : "1px solid var(--glass-border)",
                outlineOffset: "2px",
              }}
            >
              {item.type === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element -- deliberate: no image-optimization infra in this MVP
                <img src={item.url} alt="" className="h-full w-full object-cover" />
              ) : (
                <VideoThumb url={item.url} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
