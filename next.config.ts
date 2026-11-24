import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Banner images (BannerCarousel.tsx) are the one place in this app
    // that uses next/image — every other image is a deliberate raw <img>
    // (no image-optimization infra, see comments throughout). The banner
    // is the single largest above-the-fold image on the storefront, so
    // the LCP/priority benefit is worth the one exception. Images are
    // uploaded to Vercel Blob (blob-storage.ts); the store-id subdomain
    // varies per environment, hence the wildcard.
    remotePatterns: [
      { protocol: "https", hostname: "**.public.blob.vercel-storage.com" },
    ],
  },
  experimental: {
    serverActions: {
      // Production incident (2026-11-19): this used to be "110mb", aimed
      // at blob-storage.ts's old 100MB video ceiling — but on Vercel, this
      // setting can never matter past 4.5MB. Vercel enforces a hard,
      // non-configurable 4.5MB request body limit on every Function
      // (Server Actions included, see
      // https://vercel.com/docs/functions/limitations); anything larger
      // is rejected by the platform itself with a bare 413 before Next.js
      // or this config is ever consulted. "110mb" was therefore never
      // actually in effect in production — every upload above 4.5MB was
      // (and, for video, still is) silently failing regardless of this
      // value. 4.3mb just clears our own 4MB app-level image/logo caps
      // (blob-storage.ts's MAX_IMAGE_BYTES / MAX_LOGO_BYTES) plus small
      // multipart overhead, while staying under Vercel's ceiling.
      bodySizeLimit: "4.3mb",
    },
  },
};

export default nextConfig;
