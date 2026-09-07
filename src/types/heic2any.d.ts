// heic2any ships no TypeScript types and has no @types package. Minimal
// ambient declaration covering only the shape actually used
// (ProductMediaGallery.tsx's convertHeicToJpeg()) — not a full API surface.
declare module "heic2any" {
  export type HeicConvertOptions = {
    blob: Blob;
    toType?: string;
    quality?: number;
  };
  export default function heic2any(options: HeicConvertOptions): Promise<Blob | Blob[]>;
}
