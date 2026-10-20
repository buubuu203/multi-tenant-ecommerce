"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import "@uiw/react-md-editor/markdown-editor.css";

// MDEditor touches `document`/`navigator` at module scope in some builds —
// loading it via next/dynamic with ssr:false is the standard, documented
// way to use this library in Next.js (avoids a server-render crash), same
// posture as ProductMediaGallery.tsx's own client-only upload UI elsewhere
// in this file's directory.
const MDEditor = dynamic(() => import("@uiw/react-md-editor"), { ssr: false });

// Product.description stays a plain Markdown STRING in the database (no
// schema change) — this component is purely a nicer way to author that
// same string. It renders a real <textarea name="description"> under the
// hood (via a hidden mirror input) so the surrounding <form>'s existing
// FormData-based submit handling (createProductAction/updateProductAction)
// needs zero changes; MDEditor itself is a controlled React component, not
// a native form field, so submitting its value requires this thin bridge.
export function DescriptionEditor({ defaultValue }: { defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue ?? "");

  return (
    <div data-color-mode="light">
      <input type="hidden" name="description" value={value} />
      <MDEditor
        value={value}
        onChange={(next) => setValue(next ?? "")}
        height={220}
        preview="live"
        // Bold/italic/heading/lists/link/quote are the default toolbar —
        // exactly the formatting surface this feature was scoped to. Undo/
        // redo works via the editor's own history, no extra config needed.
      />
    </div>
  );
}
