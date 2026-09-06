'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  uploadBrandingFaviconAction,
  uploadBrandingLogoAction,
  uploadDesignTokensAction,
} from './actions';

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
  const router = useRouter();

  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    setLogoError(null);
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
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
      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-muted p-3">
        <p className="text-xs text-muted-foreground">
          Upload a JPG, PNG, WebP, or SVG logo (max 5MB).
        </p>
        <button
          type="button"
          onClick={() => logoInputRef.current?.click()}
          disabled={uploading}
          className="w-fit rounded-md border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-surface disabled:opacity-50"
        >
          {uploading ? 'Uploading…' : 'Upload logo'}
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
      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-muted p-3">
        <p className="text-xs text-muted-foreground">
          Upload an ICO, PNG, or SVG favicon (max 1MB).
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
      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-muted p-3">
        <p className="text-xs text-muted-foreground">
          Upload a Markdown file with supported Color, Typography, Spacing &amp; Radius, and Shadow
          Tokens sections. Tokens are parsed server-side and applied to this store and its admin.
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
    </>
  );
}
