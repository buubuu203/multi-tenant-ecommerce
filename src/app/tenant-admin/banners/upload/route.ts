import { NextResponse } from "next/server";
import { requireTenantAdmin, NotTenantAdminError } from "@/lib/auth/require-tenant-admin";
import { MAX_BANNER_IMAGE_BYTES, uploadBannerImageFile } from "@/lib/blob-storage";

/**
 * Deliberately lives under /tenant-admin/ and NOT under /api/ — same
 * reasoning as src/app/tenant-admin/exports/[dataset]/route.ts:
 * src/proxy.ts treats /api as a platform route and bypasses tenant
 * hostname resolution entirely (see platform-routes.ts), so requireTenantAdmin()
 * would never see an x-tenant-id header here and every call would fail
 * with "No tenant resolved from request hostname" — which is exactly what
 * happened when this route previously lived at
 * /api/tenant-admin/banners/upload.
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
    return NextResponse.json({ success: false, error: "Invalid request origin." }, { status: 403 });
  }
  try {
    if (new URL(origin).host.toLowerCase() !== requestHost) {
      return NextResponse.json(
        { success: false, error: "Invalid request origin." },
        { status: 403 },
      );
    }
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request origin." }, { status: 403 });
  }

  const variant = new URL(request.url).searchParams.get("variant");
  if (variant !== "desktop" && variant !== "mobile") {
    return NextResponse.json({ success: false, error: "Invalid banner variant." }, { status: 400 });
  }

  let tenantId: string;
  try {
    ({ tenantId } = await requireTenantAdmin());
  } catch (e) {
    if (e instanceof NotTenantAdminError) {
      return NextResponse.json({ success: false, error: "Not authorized." }, { status: 404 });
    }
    // Anything else is Next.js's own redirect signal from redirectToSignIn()
    // — never caught below, or a signed-out upload would 500 instead of
    // actually redirecting the browser to sign-in.
    throw e;
  }

  // Everything from here on was previously UNGUARDED: any throw (a stream
  // error, a corrupt/oversized image sharp chokes on, Vercel Blob's put()
  // failing) crashed the request with no response body at all — the
  // client sees "Unexpected end of JSON input" and the real cause is never
  // logged anywhere. One try/catch around the actual work, same shape as
  // every mutation in this codebase: log the real error server-side,
  // return a generic message to the browser, never leave the connection
  // to just die.
  try {
    const contentType = request.headers.get("content-type")?.split(";")[0].trim() ?? "";
    const reader = request.body?.getReader();
    if (!reader) {
      return NextResponse.json(
        { success: false, error: "No image file provided." },
        { status: 400 },
      );
    }

    const parts: BlobPart[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BANNER_IMAGE_BYTES) {
        await reader.cancel();
        return NextResponse.json(
          { success: false, error: "Banner image exceeds the 8MB limit." },
          { status: 413 },
        );
      }
      const copy = new Uint8Array(value.byteLength);
      copy.set(value);
      parts.push(copy.buffer);
    }

    const file = new File(parts, "banner-image", { type: contentType });
    const result = await uploadBannerImageFile(tenantId, file, variant);
    if ("error" in result) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    console.error("Banner image upload route failed:", e);
    return NextResponse.json(
      { success: false, error: "Something went wrong uploading this image. Please try again." },
      { status: 500 },
    );
  }
}
