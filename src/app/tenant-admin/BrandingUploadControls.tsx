'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  uploadBrandingFaviconAction,
  uploadBrandingLogoAction,
  uploadDesignTokensAction,
} from './actions';
import { compressImageInBrowser } from '@/lib/images/client-compress';

// Raster logo SELECTION cap — the server (blob-storage.ts's
// MAX_LOGO_BYTES) still caps at 4MB, a Vercel Functions platform limit
// that cannot be raised. The gap is closed by compressImageInBrowser,
// same as ProductMediaGallery/BannerImageUpload.
const MAX_LOGO_RASTER_INPUT_BYTES = 10 * 1024 * 1024;
// SVG is never compressed (it's mandated to stay vector — see
// blob-storage.ts's uploadBrandingLogoFile comment), so there is no
// compression step to close a gap with; this stays at the server's own
// 4MB cap.
const MAX_LOGO_SVG_INPUT_BYTES = 4 * 1024 * 1024;
// Favicon is NOT included in the 10MB/compress policy: blob-storage.ts's
// uploadBrandingFaviconFile explicitly stores favicons byte-for-byte
// (ICO/PNG/SVG) and never converts to WebP — a browser tab icon has to
// stay in a format the browser's own <link rel="icon"> will accept, and
// compressing to WebP would silently break that contract. Favicons are
// also tiny by nature, so the server's existing 1MB cap is left as-is.
const MAX_FAVICON_INPUT_BYTES = 1 * 1024 * 1024;

export function BrandingUploadControls({
  initialLogoUrl,
  initialFaviconUrl,
  hasTokens,
}: {
  initialLogoUrl: string;
  initialFaviconUrl: string;
  hasTokens: boolean;
}) {
  const logoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);
  const tokenInputRef = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);
  const [faviconUrl, setFaviconUrl] = useState(initialFaviconUrl);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [faviconError, setFaviconError] = useState<string | null>(null);
  const [tokenMessage, setTokenMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const router = useRouter();

  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    setLogoError(null);
    const isSvg = file.type === 'image/svg+xml';

    let fileToUpload = file;
    if (isSvg) {
      if (file.size > MAX_LOGO_SVG_INPUT_BYTES) {
        setLogoError('Logo vượt 4MB, vui lòng chọn ảnh nhỏ hơn.');
        return;
      }
    } else {
      if (file.size > MAX_LOGO_RASTER_INPUT_BYTES) {
        setLogoError('Logo vượt 10MB, vui lòng chọn ảnh nhỏ hơn.');
        return;
      }
      setOptimizing(true);
      const compressed = await compressImageInBrowser(file);
      setOptimizing(false);
      if (!compressed.ok) {
        setLogoError(compressed.error);
        return;
      }
      fileToUpload = compressed.file;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append('file', fileToUpload);
    const result = await uploadBrandingLogoAction(formData);
    setUploading(false);
    if (!result.success) {
      setLogoError(result.error);
      return;
    }
    setLogoUrl(result.data.url);
    router.refresh();
  }

  async function uploadTokens(file: File | undefined) {
    if (!file) return;
    setTokenMessage(null);
    const formData = new FormData();
    formData.append('file', file);
    const result = await uploadDesignTokensAction(formData);
    if (result.success) {
      setTokenMessage('Design tokens uploaded and applied.');
      router.refresh();
    } else {
      setTokenMessage(result.error);
    }
  }

  async function uploadFavicon(file: File | undefined) {
    if (!file) return;
    setFaviconError(null);
    if (file.size > MAX_FAVICON_INPUT_BYTES) {
      setFaviconError('Favicon vượt 1MB, vui lòng chọn ảnh nhỏ hơn.');
      return;
    }
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    const result = await uploadBrandingFaviconAction(formData);
    setUploading(false);
    if (!result.success) {
      setFaviconError(result.error);
      return;
    }
    setFaviconUrl(result.data.url);
    router.refresh();
  }

  return (
    <>
      {/* Three named groups rather than one flat run of controls: a URL
          field and an upload button do the same job two ways, and the
          design-token file is a different kind of thing entirely. */}
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="text-sm font-semibold tracking-tight">Logo</h3>
        <p className="text-xs text-muted-foreground">
          Paste a URL or upload a file — either sets the logo.
        </p>
        <label className="flex flex-col gap-1.5">
          Logo URL
          <input
            name="logoUrl"
            value={logoUrl}
            onChange={(event) => setLogoUrl(event.target.value)}
            placeholder="https://..."
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
          />
        </label>
        <div className="flex flex-col gap-2 rounded-xl bg-surface-muted p-3">
          <p className="text-xs text-muted-foreground">
            Upload a JPG, PNG, or WebP logo up to 10MB (optimized to WebP in your browser before
            upload), or an SVG logo up to 4MB (kept as-is).
          </p>
          <button
            type="button"
            onClick={() => logoInputRef.current?.click()}
            disabled={uploading || optimizing}
            className="w-fit rounded-md border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-surface disabled:opacity-50"
          >
            {optimizing ? 'Đang tối ưu ảnh…' : uploading ? 'Đang tải lên…' : 'Upload logo'}
          </button>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/svg+xml"
            className="hidden"
            onChange={(event) => {
              void uploadLogo(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          {logoError && <p className="text-xs text-red-600">{logoError}</p>}
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="text-sm font-semibold tracking-tight">Favicon</h3>
        <p className="text-xs text-muted-foreground">The small icon shown in the browser tab.</p>
        <label className="flex flex-col gap-1.5">
          Favicon URL
          <input
            name="faviconUrl"
            value={faviconUrl}
            onChange={(event) => setFaviconUrl(event.target.value)}
            placeholder="https://..."
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
          />
        </label>
        <div className="flex flex-col gap-2 rounded-xl bg-surface-muted p-3">
          <p className="text-xs text-muted-foreground">
            Upload an ICO, PNG, or SVG favicon (max 1MB). Favicons are stored in the format you
            upload — browser tab icons are not converted to WebP.
          </p>
          <button
            type="button"
            onClick={() => faviconInputRef.current?.click()}
            disabled={uploading}
            className="w-fit rounded-md border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-surface disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : 'Upload favicon'}
          </button>
          <input
            ref={faviconInputRef}
            type="file"
            accept="image/x-icon,image/vnd.microsoft.icon,image/png,image/svg+xml"
            className="hidden"
            onChange={(event) => {
              void uploadFavicon(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          {faviconError && <p className="text-xs text-red-600">{faviconError}</p>}
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="text-sm font-semibold tracking-tight">Design tokens</h3>
        <p className="text-xs text-muted-foreground">
          Colours, type, spacing and shadows for the whole storefront — not an image.
        </p>
        <div className="flex flex-col gap-2 rounded-xl bg-surface-muted p-3">
          <p className="text-xs text-muted-foreground">
            Upload a Markdown file with supported Color, Typography, Spacing &amp; Radius, and
            Shadow Tokens sections. Tokens are parsed server-side and applied to this store and its
            admin.
          </p>
          <button
            type="button"
            onClick={() => tokenInputRef.current?.click()}
            className="w-fit rounded-md border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-surface"
          >
            Upload design tokens
          </button>
          <input
            ref={tokenInputRef}
            type="file"
            accept=".md,text/markdown"
            className="hidden"
            onChange={(event) => {
              void uploadTokens(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <p className="text-xs text-muted-foreground">
            {hasTokens ? 'A token configuration is active.' : 'No token file uploaded yet.'}
          </p>
          {tokenMessage && (
            <p
              className={`text-xs ${tokenMessage.includes('uploaded') ? 'text-green-700' : 'text-red-600'}`}
            >
              {tokenMessage}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
