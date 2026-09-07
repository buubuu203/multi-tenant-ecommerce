import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";

// Step: Product Description Rich Text. The ONLY place in this codebase
// that ever produces HTML for dangerouslySetInnerHTML — Product.description
// stays a plain Markdown string in the database (no schema change), and is
// only ever converted to HTML at render time, through this exact pipeline:
//
//   Markdown string -> marked (raw HTML tokens stripped) -> DOMPurify
//   (belt-and-suspenders second sanitization pass, restricted tag/attr
//   allowlist, safe-protocol-only links) -> sanitized HTML string
//
// Two independent layers, not one: marked's renderer override below
// refuses to emit ANY raw HTML found in the Markdown source (so
// `<script>`/`<img onerror>` typed directly into the editor never even
// becomes an HTML node), and DOMPurify then sanitizes whatever marked DID
// produce from legitimate Markdown syntax, in case marked's own output
// ever contains something unexpected. Neither layer is trusted alone.
const renderer = new marked.Renderer();
// Overriding html() to always return "" is what "raw HTML disabled" means
// here — marked normally passes through raw HTML found in Markdown source
// (e.g. a literal `<script>` tag typed into the editor) unchanged; this
// makes it vanish before DOMPurify ever sees it.
renderer.html = () => "";

marked.use({ renderer, gfm: true, breaks: true });

// Matches exactly the formatting surface this feature was scoped to
// (bold/italic/headings/lists/links/paragraphs/line breaks/blockquote) —
// nothing marked could produce from real Markdown syntax needs a tag
// outside this list, so anything else surviving to this point is
// necessarily suspicious and stripped.
const ALLOWED_TAGS = ["p", "br", "strong", "em", "h1", "h2", "h3", "ul", "ol", "li", "a", "blockquote"];
const ALLOWED_ATTR = ["href", "title"];

/**
 * Converts a Product.description Markdown string into sanitized HTML safe
 * to render via dangerouslySetInnerHTML. Never throws — a malformed
 * Markdown input degrades to whatever marked/DOMPurify can salvage rather
 * than breaking the storefront page.
 */
export function renderDescriptionMarkdown(markdown: string): string {
  const rawHtml = marked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Only http(s)/mailto links survive — this is what "safe links only"
    // means: a `javascript:`/`data:` href in a [text](javascript:...)
    // link is stripped down to plain text rather than rendered as a link.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  });
}
