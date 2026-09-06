import type { CSSProperties, ReactNode } from 'react';
import type { ResolvedBranding } from '@/app/_storefront/resolve-branding';

type ThemeStyle = CSSProperties & Record<`--${string}`, string>;

export function tenantThemeStyle(branding: ResolvedBranding): ThemeStyle {
  const style: ThemeStyle = {};
  const tokens = branding.designTokens;
  if (!tokens) return style;

  for (const section of Object.values(tokens)) {
    for (const [name, value] of Object.entries(section)) {
      style[name as `--${string}`] = value;
    }
  }

  const colors = tokens.colors;
  const spacing = tokens.spacing;
  const typography = tokens.typography;
  const radius = tokens.radius;
  if (colors['--color-bed']) style['--background'] = colors['--color-bed'];
  if (colors['--color-ink']) style['--foreground'] = colors['--color-ink'];
  if (colors['--color-surface']) style['--surface'] = colors['--color-surface'];
  if (colors['--color-bed-alt']) style['--surface-muted'] = colors['--color-bed-alt'];
  if (colors['--color-layer']) style['--border'] = colors['--color-layer'];
  if (colors['--color-ink-soft']) style['--muted-foreground'] = colors['--color-ink-soft'];
  if (radius['--radius-sm']) style['--radius-sm'] = radius['--radius-sm'];
  if (radius['--radius-md']) style['--radius-md'] = radius['--radius-md'];
  if (radius['--radius-lg']) style['--radius-lg'] = radius['--radius-lg'];
  if (typography['--font-body']) style.fontFamily = typography['--font-body'];
  if (spacing['--space-4']) style['--space-4'] = spacing['--space-4'];
  return style;
}

export function TenantTheme({
  branding,
  children,
  className,
}: {
  branding: ResolvedBranding;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div data-tenant-theme className={className} style={tenantThemeStyle(branding)}>
      {children}
    </div>
  );
}
