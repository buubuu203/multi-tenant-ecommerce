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

renderer.link = ({ href, title, tokens }) => {
  const safeHref = /^(?:https?:|mailto:)/i.test(href) ? href : '';
  const text = renderer.parser!.parseInline(tokens);
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
