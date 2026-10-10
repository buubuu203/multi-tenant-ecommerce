import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import sharp from "sharp";
import {
  convertImageToWebp,
  willConvertToWebp,
  WEBP_QUALITY,
  MAX_DIMENSION,
} from "../src/lib/images/webp-conversion";

const root = fileURLToPath(new URL("../", import.meta.url));

function readCode(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const IMAGE = new Set(["image/jpeg", "image/png", "image/webp"]);
const LOGO = new Set(["image/jpeg", "image/png", "image/webp", "image/svg+xml"]);

function file(bytes: Buffer | Uint8Array, name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** A real PNG, optionally with a transparent region. */
async function png(width = 40, height = 24, alpha = false): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 200, g: 40, b: 40, alpha: alpha ? 0 : 1 },
    },
  })
    .png()
    .toBuffer();
}

async function jpeg(width = 40, height = 24): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .jpeg()
    .toBuffer();
}

/** True when the bytes really are a WebP container, not merely named one. */
function isWebpBytes(buffer: Buffer): boolean {
  return (
    buffer.length > 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  );
}

async function bytesOf(f: File): Promise<Buffer> {
  return Buffer.from(await f.arrayBuffer());
}

// ---------- conversion ----------

test("a PNG upload is stored as real WebP bytes", async () => {
  const result = await convertImageToWebp(file(await png(), "photo.png", "image/png"), IMAGE);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.converted, true);
  assert.equal(result.contentType, "image/webp");
  assert.equal(result.file.name, "photo.webp", "extension follows the actual output");
  assert.equal(result.file.type, "image/webp");
  assert.ok(isWebpBytes(await bytesOf(result.file)), "the bytes are a WebP container");
});

test("a JPEG upload is stored as real WebP bytes", async () => {
  const result = await convertImageToWebp(file(await jpeg(), "shot.JPG", "image/jpeg"), IMAGE);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.converted, true);
  assert.equal(result.file.name, "shot.webp");
  assert.ok(isWebpBytes(await bytesOf(result.file)));
});

test("an already-WebP upload is passed through, not recompressed", async () => {
  const original = await sharp(await png()).webp({ quality: 95 }).toBuffer();
  const result = await convertImageToWebp(file(original, "already.webp", "image/webp"), IMAGE);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.converted, false, "the documented policy is pass-through");
  assert.equal(result.contentType, "image/webp");
  // Byte-identical: a second lossy generation was NOT applied.
  assert.deepEqual(await bytesOf(result.file), original);
});

test("dimensions are preserved, since this pipeline does not resize", async () => {
  const result = await convertImageToWebp(file(await png(133, 71), "p.png", "image/png"), IMAGE);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.width, 133);
  assert.equal(result.height, 71);
  const meta = await sharp(await bytesOf(result.file)).metadata();
  assert.equal(meta.width, 133);
  assert.equal(meta.height, 71);
});

test("PNG transparency survives conversion", async () => {
  const result = await convertImageToWebp(
    file(await png(20, 20, true), "t.png", "image/png"),
    IMAGE,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const out = sharp(await bytesOf(result.file));
  const meta = await out.metadata();
  assert.equal(meta.hasAlpha, true, "the output still has an alpha channel");
  // And the alpha is actually transparent, not an opaque alpha channel.
  const { data, info } = await out.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  assert.equal(data[3], 0, "a transparent pixel stayed transparent");
});

test("EXIF orientation is applied to the stored pixels", async () => {
  // Orientation 6 means "rotate 90° clockwise on display". A 60x30 source
  // must therefore come out 30x60 with the rotation baked in.
  const rotated = await sharp(await jpeg(60, 30))
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  const result = await convertImageToWebp(file(rotated, "r.jpg", "image/jpeg"), IMAGE);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.width, 30, "width/height reflect the applied orientation");
  assert.equal(result.height, 60);
});

test("EXIF and GPS metadata are stripped from the output", async () => {
  const withExif = await sharp(await jpeg())
    .withExif({ IFD0: { Copyright: "secret-studio" } })
    .jpeg()
    .toBuffer();
  const result = await convertImageToWebp(file(withExif, "g.jpg", "image/jpeg"), IMAGE);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const meta = await sharp(await bytesOf(result.file)).metadata();
  assert.equal(meta.exif, undefined, "no EXIF block is carried forward");
  const raw = (await bytesOf(result.file)).toString("latin1");
  assert.doesNotMatch(raw, /secret-studio/, "metadata values are not in the stored bytes");
});

// ---------- preserved formats ----------

test("an SVG logo is never rasterised", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8"/></svg>');
  const result = await convertImageToWebp(file(svg, "logo.svg", "image/svg+xml"), LOGO);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.converted, false);
  assert.equal(result.contentType, "image/svg+xml");
  assert.equal(result.file.name, "logo.svg", "the .svg extension is kept");
  assert.deepEqual(await bytesOf(result.file), svg, "the SVG bytes are untouched");
  assert.equal(willConvertToWebp("image/svg+xml"), false);
});

test("ICO is preserved, because libvips cannot write it", async () => {
  const ico = Buffer.from([0, 0, 1, 0, 1, 0]);
  for (const type of ["image/x-icon", "image/vnd.microsoft.icon"]) {
    const result = await convertImageToWebp(file(ico, "f.ico", type), new Set([type]));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.converted, false);
    assert.equal(result.contentType, type);
  }
});

// ---------- rejection ----------

test("an empty file is rejected", async () => {
  const result = await convertImageToWebp(file(Buffer.alloc(0), "e.png", "image/png"), IMAGE);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "empty");
});

test("an unsupported type is rejected", async () => {
  const result = await convertImageToWebp(file(await png(), "x.gif", "image/gif"), IMAGE);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "unsupported");
});

test("corrupt content is rejected even when the claimed MIME type is allowed", async () => {
  // A valid-looking PNG name and MIME type over bytes that are not an image
  // at all — validation reads the CONTENT, never the claim.
  const result = await convertImageToWebp(
    file(Buffer.from("this is definitely not a png"), "evil.png", "image/png"),
    IMAGE,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "corrupt");
  assert.doesNotMatch(result.error, /vips|sharp|\//, "no library internals or paths leak out");
});

test("a truncated PNG header is rejected", async () => {
  const truncated = (await png()).subarray(0, 20);
  const result = await convertImageToWebp(file(truncated, "t.png", "image/png"), IMAGE);
  assert.equal(result.ok, false);
});

test("unsafe dimensions are rejected before a full decode", async () => {
  const wide = await sharp({
    create: { width: MAX_DIMENSION + 1, height: 1, channels: 3, background: "#000" },
  })
    .png()
    .toBuffer();
  const result = await convertImageToWebp(file(wide, "bomb.png", "image/png"), IMAGE);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "too-large");
});

/**
 * A genuinely animated WebP, assembled by hand.
 *
 * sharp cannot CREATE an animated image from scratch (libvips only writes
 * animation when the source already carries page metadata), so the
 * container is built here: a VP8X header with the animation flag set, an
 * ANIM chunk, and two ANMF frames that reuse one real lossless VP8L frame
 * produced by sharp. That keeps the frame data valid rather than
 * hand-rolled, and gives a fixture libvips genuinely reports as 2 pages.
 */
async function animatedWebp(): Promise<Buffer> {
  const simple = await sharp({
    create: { width: 8, height: 8, channels: 4, background: { r: 9, g: 9, b: 9, alpha: 1 } },
  })
    .webp({ lossless: true })
    .toBuffer();

  // Pull the single encoded frame out of that ordinary WebP.
  let offset = 12;
  let frame: Buffer | null = null;
  while (offset < simple.length) {
    const id = simple.toString("ascii", offset, offset + 4);
    const size = simple.readUInt32LE(offset + 4);
    const padded = 8 + size + (size % 2);
    if (id === "VP8L" || id === "VP8 ") {
      frame = simple.subarray(offset, offset + padded);
      break;
    }
    offset += padded;
  }
  assert.ok(frame, "a frame chunk was found in the source WebP");

  const u24 = (n: number): Buffer => {
    const b = Buffer.alloc(3);
    b.writeUIntLE(n, 0, 3);
    return b;
  };
  const chunk = (id: string, data: Buffer): Buffer => {
    const header = Buffer.alloc(8);
    header.write(id, 0, "ascii");
    header.writeUInt32LE(data.length, 4);
    return Buffer.concat(data.length % 2 ? [header, data, Buffer.alloc(1)] : [header, data]);
  };

  // 0x02 is the VP8X animation flag; canvas dimensions are stored minus one.
  const vp8x = chunk("VP8X", Buffer.concat([Buffer.from([0x02, 0, 0, 0]), u24(7), u24(7)]));
  const anim = chunk("ANIM", Buffer.from([0, 0, 0, 0, 0, 0]));
  const anmf = (): Buffer =>
    chunk(
      "ANMF",
      Buffer.concat([u24(0), u24(0), u24(7), u24(7), u24(100), Buffer.from([0]), frame]),
    );

  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), vp8x, anim, anmf(), anmf()]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from("RIFF", "ascii"), size, body]);
}

test("an animated image is rejected, never silently flattened to one frame", async () => {
  const animated = await animatedWebp();
  const meta = await sharp(animated).metadata();
  assert.equal(meta.pages, 2, "the fixture really is a 2-frame animation");

  const result = await convertImageToWebp(file(animated, "a.webp", "image/webp"), IMAGE);
  assert.equal(result.ok, false, "it is rejected rather than stored as frame one");
  if (result.ok) return;
  assert.equal(result.code, "animated");
  assert.match(result.error, /Animated images are not supported/);
});

test("the animation check runs before the already-WebP pass-through", () => {
  // Order matters: an animated WebP must not slip through as "already in
  // the target format" without its page count being looked at.
  const helper = readCode("src/lib/images/webp-conversion.ts");
  const reject = helper.indexOf("code: 'animated'");
  const passthrough = helper.indexOf("PRESERVED_MIME_TYPES.has(file.type)");
  assert.ok(reject > -1 && passthrough > -1, "both branches exist");
  assert.ok(reject < passthrough, "animation is rejected before any format pass-through");
});

// ---------- wiring, authorization and failure order ----------

test("every converting upload path goes through the one shared helper", () => {
  const storage = readCode("src/lib/blob-storage.ts");
  assert.match(storage, /import \{ convertImageToWebp \}/);
  // Product media, branding logo and both banner variants.
  assert.equal(
    (storage.match(/convertImageToWebp\(/g) ?? []).length,
    3,
    "three call sites: product media, logo, banner (both banner variants share one function)",
  );
  // No second copy of the policy.
  assert.doesNotMatch(storage, /\.webp\(\{/, "encoding options live only in the helper");
});

test("the favicon path deliberately does not convert", () => {
  const storage = readCode("src/lib/blob-storage.ts");
  const favicon = storage.slice(storage.indexOf("export async function uploadBrandingFaviconFile"));
  const body = favicon.slice(0, favicon.indexOf("export async function deleteBrandingLogoFile"));
  assert.doesNotMatch(body, /convertImageToWebp/, "favicons keep their uploaded format");
  assert.match(body, /FAVICON_MIME_TYPES/, "but they are still validated");
  assert.match(body, /validateSvgUpload/, "including SVG sanitisation");
});

test("SVG sanitisation still runs on the logo path, before anything else", () => {
  const storage = readCode("src/lib/blob-storage.ts");
  const logo = storage.slice(storage.indexOf("export async function uploadBrandingLogoFile"));
  const sanitise = logo.indexOf("validateSvgUpload");
  const convert = logo.indexOf("convertImageToWebp");
  assert.ok(sanitise > -1 && convert > -1);
  assert.ok(sanitise < convert, "SVG is an exception to conversion, not to validation");
});

test("conversion happens before upload, so a failure cannot orphan an object", () => {
  const storage = readCode("src/lib/blob-storage.ts");
  for (const fn of [
    "export async function uploadProductMediaFile",
    "export async function uploadBrandingLogoFile",
    "export async function uploadBannerImageFile",
  ]) {
    const body = storage.slice(storage.indexOf(fn));
    const convert = body.indexOf("convertImageToWebp");
    const upload = body.indexOf("await put(");
    assert.ok(convert > -1 && upload > -1, `${fn} converts and uploads`);
    assert.ok(convert < upload, `${fn} must convert before it writes to storage`);
  }
});

test("the stored content type is the converted one, never the client's claim", () => {
  const storage = readCode("src/lib/blob-storage.ts");
  assert.equal(
    (storage.match(/contentType/g) ?? []).length >= 4,
    true,
    "every converting put() passes an explicit content type",
  );
});

test("tenant isolation on delete is unchanged by conversion", () => {
  const storage = readCode("src/lib/blob-storage.ts");
  for (const namespace of ["product-media", "branding", "banners"]) {
    assert.match(
      storage,
      new RegExp(`Refusing to delete a blob outside this tenant's`),
      "delete still refuses cross-tenant URLs",
    );
    assert.match(storage, new RegExp(`/${namespace}/\\$\\{tenantId\\}/`));
  }
});

test("every image upload action still authorizes before it processes", () => {
  const actions = readCode("src/app/tenant-admin/actions.ts");
  for (const fn of [
    "uploadProductMediaAction",
    "uploadBrandingLogoAction",
    "uploadBrandingFaviconAction",
    "uploadBannerImageAction",
    "uploadBannerMobileImageAction",
  ]) {
    const body = actions.slice(actions.indexOf(`export async function ${fn}`));
    const auth = body.indexOf("requireTenantAdmin()");
    const read = body.indexOf("formData.get('file')");
    assert.ok(auth > -1, `${fn} authorizes`);
    assert.ok(auth < read, `${fn} authorizes before it touches the file`);
  }
});

test("no backfill rewrites existing assets, so old PNG/JPG/SVG URLs keep working", () => {
  const storage = readCode("src/lib/blob-storage.ts");
  // Conversion is on the upload path only — nothing re-encodes on read.
  assert.doesNotMatch(storage, /backfill|rewriteExisting|migrateMedia/i);
  // The accepted-input allowlists still include the legacy formats.
  assert.match(storage, /'image\/jpeg', 'image\/png'/);
});

test("the quality setting is documented in one place", () => {
  assert.equal(WEBP_QUALITY, 82);
  const helper = readFileSync(join(root, "src/lib/images/webp-conversion.ts"), "utf8");
  assert.match(helper, /ecommerce default/, "the number is explained, not just set");
});
