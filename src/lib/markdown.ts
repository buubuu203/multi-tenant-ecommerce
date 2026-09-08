import { marked } from 'marked';

// Product descriptions are stored as Markdown and rendered through marked
// with raw HTML disabled. The renderer only emits the supported Markdown
// elements and validates links before they reach dangerouslySetInnerHTML.
const renderer = new marked.Renderer();
renderer.html = () => '';
renderer.image = ({ text }) => escapeHtml(text);

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  );
}

// A plain `function`, not an arrow function, is required here: marked's
// use() does not adopt this renderer object directly — it copies each
// method onto its OWN internal renderer instance and invokes it via
// `fn.apply(internalRenderer, args)` (see node_modules/marked's `use()`).
// An arrow function ignores that `this` binding entirely and would keep
// closing over this module's `renderer` const, whose `.parser` is never
// populated by marked (only the internal renderer's `.parser` is set,
// inside Parser.parse()/parseInline()) — that mismatch is exactly what
// previously crashed on any Markdown link with "Cannot read properties of
// undefined (reading 'parseInline')". Using a plain function + `this.parser`
// matches marked's own built-in link() implementation exactly.
renderer.link = function ({ href, title, tokens }) {
  const safeHref = /^(?:https?:|mailto:)/i.test(href) ? href : '';
  const text = this.parser.parseInline(tokens);
  if (!safeHref) return text;

  const escapedTitle = title ? ` title="${escapeHtml(title)}"` : '';
  return `<a href="${escapeHtml(safeHref)}"${escapedTitle}>${text}</a>`;
};

marked.use({ renderer, gfm: true, breaks: true });

/**
 * Converts Markdown into a small, server-rendered HTML subset.
 *
 * Raw HTML, scripts, images, and unsafe links are never emitted. Malformed
 * Markdown is allowed to degrade to the output marked can safely produce.
 */
export function renderDescriptionMarkdown(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string;
}
