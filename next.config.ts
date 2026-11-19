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
      // Step 50: uploadProductMediaAction sends the raw file straight
      // through a Server Action, whose default body limit (1MB) is far
      // below blob-storage.ts's own MAX_VIDEO_BYTES (100MB) — every real
      // photo/video upload was silently 413ing. Set above the 100MB video
      // ceiling with headroom for multipart boundary/field overhead.
      bodySizeLimit: "110mb",
    },
  },
};

export default nextConfig;
