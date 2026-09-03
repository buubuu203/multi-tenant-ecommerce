import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
