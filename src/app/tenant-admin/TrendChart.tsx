'use client';

import { useState } from 'react';
import type { TrendPoint } from '@/lib/analytics/order-trend';
import { formatVnd } from './format';
import { adminPanelTitleClassName } from './styles';

/**
 * Daily orders and order value, drawn as bars plus a line.
 *
 * Hand-rolled SVG rather than a charting library: this is one chart, and
 * a dependency would ship a general-purpose renderer to every admin page
 * to draw forty rectangles.
 *
 * ACCESSIBILITY. The SVG is decorative (`aria-hidden`) and the real
 * content is a table in the same component, behind a disclosure. A line
 * on a chart is not readable by a screen reader, and summarising it in
 * an aria-label would be a claim about shape rather than the numbers.
 * The table carries the actual values, and the hover readout below is a
 * convenience for pointer users rather than the only way to a figure.
 *
 * The hover target is a full-height invisible band per day, not the mark
 * itself: a 2px line and a short bar are almost impossible to hit, and a
 * day with zero orders has no mark to hover at all.
 *
 * Every label names a value the chart reaches, and the viewBox leaves
 * room for the outermost labels so nothing is clipped.
 */

const WIDTH = 720;
const HEIGHT = 180;
const PAD_LEFT = 8;
const PAD_RIGHT = 8;
const PAD_TOP = 14;
const PAD_BOTTOM = 22;

function shortDate(iso: string): string {
  // "2026-10-19" -> "19/10". The year is already in the range caption.
  const [, month, day] = iso.split('-');
  return `${day}/${month}`;
}

export function TrendChart({
  series,
  title,
  caption,
}: {
  series: TrendPoint[];
  title: string;
  caption: string;
}) {
  // Declared before the empty-series early return: a hook must run in
  // the same order on every render.
  const [active, setActive] = useState<number | null>(null);

  if (series.length === 0) {
    return (
      <section aria-labelledby="trend" className="flex flex-col gap-2">
        <h3 id="trend" className={adminPanelTitleClassName}>
          {title}
        </h3>
        <p className="text-sm text-muted-foreground">No orders in this range yet.</p>
      </section>
    );
  }

  const maxOrders = Math.max(1, ...series.map((point) => point.orders));
  const maxValue = Math.max(1, ...series.map((point) => point.orderValue));
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const step = plotWidth / series.length;
  const barWidth = Math.max(1, Math.min(18, step * 0.62));

  const valuePoints = series
    .map((point, index) => {
      const x = PAD_LEFT + step * index + step / 2;
      const y = PAD_TOP + plotHeight - (point.orderValue / maxValue) * plotHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  // Enough labels to orient, never so many they collide.
  const labelEvery = Math.max(1, Math.ceil(series.length / 7));
  const totalOrders = series.reduce((sum, point) => sum + point.orders, 0);
  const totalValue = series.reduce((sum, point) => sum + point.orderValue, 0);

  return (
    <section aria-labelledby="trend" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 id="trend" className={adminPanelTitleClassName}>
          {title}
        </h3>
        <p className="text-xs text-muted-foreground">{caption}</p>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
        <span>
          <span className="font-semibold tabular-nums">{totalOrders}</span>{' '}
          <span className="text-muted-foreground">orders</span>
        </span>
        <span>
          <span className="font-semibold tabular-nums">{formatVnd(totalValue)}</span>{' '}
          <span className="text-muted-foreground">order value</span>
        </span>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-44 w-full min-w-[480px]"
          role="presentation"
          aria-hidden="true"
          onMouseLeave={() => setActive(null)}
        >
          {/* Baseline, so the bars sit on something. */}
          <line
            x1={PAD_LEFT}
            y1={PAD_TOP + plotHeight}
            x2={WIDTH - PAD_RIGHT}
            y2={PAD_TOP + plotHeight}
            stroke="currentColor"
            strokeOpacity="0.18"
          />
          {series.map((point, index) => {
            const height = (point.orders / maxOrders) * plotHeight;
            const x = PAD_LEFT + step * index + (step - barWidth) / 2;
            return (
              <rect
                key={point.date}
                x={x.toFixed(1)}
                y={(PAD_TOP + plotHeight - height).toFixed(1)}
                width={barWidth.toFixed(1)}
                height={Math.max(0, height).toFixed(1)}
                rx="1.5"
                fill="currentColor"
                fillOpacity="0.22"
              />
            );
          })}
          <polyline
            points={valuePoints}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* The hovered day, marked on both series so the readout
              below is unambiguous about which column it describes. */}
          {active !== null && (
            <g>
              <line
                x1={(PAD_LEFT + step * active + step / 2).toFixed(1)}
                y1={PAD_TOP}
                x2={(PAD_LEFT + step * active + step / 2).toFixed(1)}
                y2={PAD_TOP + plotHeight}
                stroke="currentColor"
                strokeOpacity="0.35"
                strokeDasharray="3 3"
              />
              <circle
                cx={(PAD_LEFT + step * active + step / 2).toFixed(1)}
                cy={(
                  PAD_TOP +
                  plotHeight -
                  (series[active].orderValue / maxValue) * plotHeight
                ).toFixed(1)}
                r="3.5"
                fill="currentColor"
              />
            </g>
          )}
          {/* Invisible full-height hit bands, one per day. */}
          {series.map((point, index) => (
            <rect
              key={`hit-${point.date}`}
              x={(PAD_LEFT + step * index).toFixed(1)}
              y={PAD_TOP}
              width={step.toFixed(1)}
              height={plotHeight}
              fill="transparent"
              onMouseEnter={() => setActive(index)}
            />
          ))}
          {series.map((point, index) =>
            index % labelEvery === 0 || index === series.length - 1 ? (
              <text
                key={`label-${point.date}`}
                x={(PAD_LEFT + step * index + step / 2).toFixed(1)}
                y={HEIGHT - 6}
                textAnchor="middle"
                fontSize="10"
                fill="currentColor"
                fillOpacity="0.6"
              >
                {shortDate(point.date)}
              </text>
            ) : null,
          )}
        </svg>
      </div>

      {/* A fixed-height slot, so the block below does not jump as the
          pointer moves across the chart. */}
      <p className="min-h-5 text-xs" aria-live="off">
        {active !== null ? (
          <span className="font-medium">
            {series[active].date} · {series[active].orders}{' '}
            {series[active].orders === 1 ? 'order' : 'orders'} ·{' '}
            {formatVnd(series[active].orderValue)}
          </span>
        ) : (
          <span className="text-muted-foreground">Hover a day to read its figures.</span>
        )}
      </p>

      <p className="text-xs text-muted-foreground">
        Bars are orders placed. The line is order value, scaled to its own peak of{' '}
        {formatVnd(maxValue)} — the two axes are not comparable to each other.
      </p>

      {/* The numbers, for anyone who cannot read the drawing. */}
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Show these figures as a table
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="border-b border-border text-left">
                <th scope="col" className="py-1.5 font-medium">
                  Day
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  Orders
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  Order value
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {series.map((point) => (
                <tr key={`row-${point.date}`}>
                  <th scope="row" className="py-1.5 font-normal">
                    {point.date}
                  </th>
                  <td className="py-1.5 text-right tabular-nums">{point.orders}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatVnd(point.orderValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
