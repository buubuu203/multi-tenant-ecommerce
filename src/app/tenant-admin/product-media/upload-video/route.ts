import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireTenantAdmin, NotTenantAdminError } from "@/lib/auth/require-tenant-admin";
import { MAX_VIDEO_UPLOAD_BYTES } from "@/lib/blob-storage";

/**
 * Token-issuing endpoint for @vercel/blob's client (browser-direct) video
 * upload — the bytes themselves never pass through this or any other
 * server route, only this small JSON handshake does. Deliberately lives
 * under /tenant-admin/ and NOT /api/, for the exact reason documented in
 * banners/upload/route.ts: src/proxy.ts bypasses tenant hostname
 * resolution for /api, which would make requireTenantAdmin() fail here.
 */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const requestHost = (
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? ""
  )
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (!origin || !requestHost) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  try {
    if (new URL(origin).host.toLowerCase() !== requestHost) {
      return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  let tenantId: string;
  try {
    ({ tenantId } = await requireTenantAdmin());
  } catch (e) {
    if (e instanceof NotTenantAdminError) {
      return NextResponse.json({ error: "Not authorized." }, { status: 404 });
    }
    throw e; // Next.js's own redirect signal from redirectToSignIn()
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // Defense in depth: `pathname` is client-supplied, but the client
        // only ever gets one from createProductVideoPathnameAction, which
        // already embeds THIS SAME requireTenantAdmin()-derived tenantId.
        // Re-checking it here means a forged or stale pathname can never
        // mint a token for another tenant's namespace, matching the
        // convention deleteProductMediaFile() already relies on.
        if (!pathname.startsWith(`product-media/${tenantId}/`)) {
          throw new Error("Pathname does not belong to this tenant.");
        }
        return {
          allowedContentTypes: ["video/mp4", "video/webm"],
          maximumSizeInBytes: MAX_VIDEO_UPLOAD_BYTES,
          addRandomSuffix: false,
        };
      },
      // onUploadCompleted needs a PUBLICLY reachable callback URL to ever
      // fire — it will not fire against a local dev server, and nothing
      // here is load-bearing: the client itself persists the resulting
      // ProductMedia row once upload() resolves (see
      // ProductMediaGallery.tsx's uploadSingleVideo), the same way the
      // existing image flow already works.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    console.error("Video upload token route failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start this upload." },
      { status: 400 },
    );
  }
}
