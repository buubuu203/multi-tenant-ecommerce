const TOKEN_FILE_MAX_BYTES = 1024 * 1024;

export type DesignTokenConfig = {
  colors: Record<string, string>;
  typography: Record<string, string>;
  spacing: Record<string, string>;
  radius: Record<string, string>;
  shadows: Record<string, string>;
};

const EMPTY_TOKENS: DesignTokenConfig = {
  colors: {},
  typography: {},
  spacing: {},
  radius: {},
  shadows: {},
};

type TokenSection = keyof DesignTokenConfig;

const SECTION_HEADERS: Array<{ section: TokenSection; pattern: RegExp }> = [
  { section: 'colors', pattern: /^##\s+(?:\d+\.\s*)?color(?:s)?\s+tokens?\s*$/i },
  { section: 'typography', pattern: /^##\s+(?:\d+\.\s*)?typography\s+tokens?\s*$/i },
  { section: 'spacing', pattern: /^##\s+(?:\d+\.\s*)?spacing\s*(?:&|and)\s*radius\s+tokens?\s*$/i },
  { section: 'shadows', pattern: /^##\s+(?:\d+\.\s*)?shadow\s+tokens?\s*$/i },
];

const TOKEN_NAME = /^--(color|font|text|space|radius|shadow)-[a-z0-9-]+$/;
const HEX = /^#[0-9a-f]{3,8}$/i;
const DIMENSION = /^(?:-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%|vh|vw|ch|ex)|0)$/i;
const FONT_VALUE = /^[a-z0-9 .,'"-]+(?:,\s*[a-z0-9 .,'"-]+)*$/i;
const SHADOW_VALUE =
  /^(?:none|(?:-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%)?\s+){2,4}(?:rgba?\([^();]{1,80}\)|hsla?\([^();]{1,80}\)|#[0-9a-f]{3,8}|[a-z]+))$/i;
const COLOR_VALUE = new RegExp(`^(?:${HEX.source}|(?:rgba?|hsla?)\\([^();]{1,80}\\)|[a-z]+)$`, 'i');

function sectionForHeading(line: string): TokenSection | null {
  return SECTION_HEADERS.find(({ pattern }) => pattern.test(line.trim()))?.section ?? null;
}

function isSafeValue(section: TokenSection, name: string, value: string): boolean {
  if (section === 'colors') return name.startsWith('--color-') && COLOR_VALUE.test(value);
  if (section === 'typography') {
    return name.startsWith('--font-')
      ? FONT_VALUE.test(value)
      : name.startsWith('--text-') && DIMENSION.test(value.split(/\s+/)[0] ?? '');
  }
  if (section === 'spacing') {
    return (
      (name.startsWith('--space-') || name.startsWith('--radius-')) &&
      (DIMENSION.test(value) || (name === '--radius-blob' && /^[0-9%.\s/]+$/.test(value)))
    );
  }
  return name.startsWith('--shadow-') && SHADOW_VALUE.test(value);
}

function addToken(
  config: DesignTokenConfig,
  section: TokenSection,
  rawName: string,
  rawValue: string,
): void {
  const name = rawName.trim();
  let value = rawValue.trim().replace(/;$/, '').trim();
  if (section === 'typography' && name.startsWith('--text-')) {
    value = value.split(/\s+/)[0] ?? '';
  }
  if (!TOKEN_NAME.test(name) || !isSafeValue(section, name, value)) return;
  config[section][name] = value;
}

function parseSection(config: DesignTokenConfig, section: TokenSection, content: string): void {
  // CSS custom properties in fenced code blocks are the canonical source in
  // the design-token document. Table rows are also accepted for the color and
  // typography sections, but only the two whitelisted columns are read.
  for (const match of content.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}\n]+);?/gi)) {
    addToken(config, section, match[1], match[2]);
  }
  for (const line of content.split(/\r?\n/)) {
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length < 3 || !cells[1].startsWith('`--') || !cells[1].endsWith('`')) continue;
    const name = cells[1].slice(1, -1);
    const value = cells[2];
    addToken(config, section, name, value);
  }
}

export function parseDesignTokens(markdown: string): {
  config: DesignTokenConfig | null;
  error?: string;
} {
  if (new TextEncoder().encode(markdown).length > TOKEN_FILE_MAX_BYTES) {
    return { config: null, error: 'Design-token files must be 1MB or smaller.' };
  }

  const config: DesignTokenConfig = structuredClone(EMPTY_TOKENS);
  const lines = markdown.split(/\r?\n/);
  let currentSection: TokenSection | null = null;
  let sectionText = '';
  let recognizedSections = 0;

  const flush = () => {
    if (currentSection) parseSection(config, currentSection, sectionText);
    sectionText = '';
  };

  for (const line of lines) {
    const nextSection = sectionForHeading(line);
    if (nextSection) {
      flush();
      currentSection = nextSection;
      recognizedSections++;
    } else if (/^##\s+/.test(line)) {
      flush();
      currentSection = null;
    } else if (currentSection) {
      sectionText += `${line}\n`;
    }
  }
  flush();

  const tokenCount = Object.values(config).reduce(
    (count, section) => count + Object.keys(section).length,
    0,
  );
  if (recognizedSections === 0 || tokenCount === 0) {
    return {
      config: null,
      error:
        'No supported design tokens found. Include Color, Typography, Spacing & Radius, or Shadow Tokens sections.',
    };
  }
  return { config };
}

export function sanitizeDesignTokens(value: unknown): DesignTokenConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const config: DesignTokenConfig = structuredClone(EMPTY_TOKENS);
  for (const section of Object.keys(config) as TokenSection[]) {
    const entries = input[section];
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
    for (const [name, tokenValue] of Object.entries(entries)) {
      if (typeof tokenValue === 'string') addToken(config, section, name, tokenValue);
    }
  }
  return Object.values(config).some((section) => Object.keys(section).length > 0) ? config : null;
}

export const DESIGN_TOKEN_FILE_MAX_BYTES = TOKEN_FILE_MAX_BYTES;
