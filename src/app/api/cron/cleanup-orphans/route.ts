import { NextResponse } from "next/server";
import { list, del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Lives under /api/ deliberately (unlike every tenant-admin upload route
// in this app) — this is a PLATFORM job that scans every tenant's blobs
// in one pass, so it must NOT go through src/proxy.ts's tenant-hostname
// resolution at all, and reads the raw `prisma` client directly rather
// than getScopedDb(tenantId) for the same reason.
const PREFIXES = ["product-media/", "banners/", "branding/"];
// A file uploaded moments ago but not yet referenced in the DB (an
// in-flight upload, or a "create product" form not yet submitted) must
// never be treated as orphaned — this is the window every upload flow in
// this app already relies on (ProductMediaGallery's "create" mode holds
// media client-side, unpersisted, until the form submits).
const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

type OrphanEntry = {
  url: string;
  pathname: string;
  size: number;
  uploadedAt: string;
};

async function listAllUnderPrefix(prefix: string) {
  const blobs: Awaited<ReturnType<typeof list>>["blobs"] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

async function loadReferencedUrls(): Promise<Set<string>> {
  const [productMedia, banners, branding] = await Promise.all([
    prisma.productMedia.findMany({ select: { url: true } }),
    prisma.banner.findMany({ select: { imageUrl: true, mobileImageUrl: true } }),
    prisma.branding.findMany({ select: { logoUrl: true, faviconUrl: true } }),
  ]);
  const referenced = new Set<string>();
  for (const m of productMedia) referenced.add(m.url);
  for (const b of banners) {
    referenced.add(b.imageUrl);
    if (b.mobileImageUrl) referenced.add(b.mobileImageUrl);
  }
  for (const b of branding) {
    if (b.logoUrl) referenced.add(b.logoUrl);
    if (b.faviconUrl) referenced.add(b.faviconUrl);
  }
  return referenced;
}

/**
 * GET so it matches Vercel Cron's own invocation method, and so it can
 * also be run by hand (locally or in production) with a plain browser/
 * curl request carrying the same bearer token.
 *
 * DRY-RUN BY DEFAULT: this only ever lists orphan candidates and their
 * total size unless CLEANUP_ORPHANS_DELETE=true is explicitly set — per
 * PO instruction, nothing is deleted for real until that's reviewed and
 * approved.
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const referenced = await loadReferencedUrls();

  const now = Date.now();
  const orphans: OrphanEntry[] = [];
  for (const prefix of PREFIXES) {
    const blobs = await listAllUnderPrefix(prefix);
    for (const blob of blobs) {
      if (referenced.has(blob.url)) continue;
      if (now - new Date(blob.uploadedAt).getTime() < ORPHAN_MIN_AGE_MS) continue;
      orphans.push({
        url: blob.url,
        pathname: blob.pathname,
        size: blob.size,
        uploadedAt: blob.uploadedAt.toISOString(),
      });
    }
  }

  const totalBytes = orphans.reduce((sum, o) => sum + o.size, 0);
  const deleteEnabled = process.env.CLEANUP_ORPHANS_DELETE === "true";
  let deleted = 0;

  if (deleteEnabled && orphans.length > 0) {
    await del(orphans.map((o) => o.url));
    deleted = orphans.length;
  }

  console.log(
    `[cleanup-orphans] ${deleteEnabled ? "DELETE RUN" : "DRY RUN"}: ${orphans.length} orphan(s), ${totalBytes} bytes${deleteEnabled ? `, deleted ${deleted}` : ""}`,
  );

  return NextResponse.json({
    dryRun: !deleteEnabled,
    orphanCount: orphans.length,
    totalBytes,
    deleted,
    orphans,
  });
}
