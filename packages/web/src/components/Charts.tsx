/**
 * Small SVG chart kit: line, column and scatter charts that size to their
 * container, with a hover layer (crosshair + one tooltip for every series on
 * lines; per-mark tooltips on columns and dots) and a legend whenever there's
 * more than one series.
 *
 * Colours: the validated categorical palette, dark steps (checked against the
 * card surface #0f1829 — all adjacent pairs pass CVD and contrast), assigned
 * in fixed order. Text never wears a series colour.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export const SERIES = ['#3987e5', '#d95926', '#199e70'] as const;
const GRID = '#1c2a44';
const AXIS_TEXT = '#8a9bb4';
const SURFACE = '#0f1829';

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth || 600);
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Clean ticks covering [lo, hi]. */
function ticks(lo: number, hi: number, n = 5): number[] {
  if (hi === lo) hi = lo + 1;
  const raw = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  // From the step at or below the minimum to the step at or above the maximum, so nothing is clipped.
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step - 1e-9) * step;
  for (let v = start; v <= end + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

function Legend({ items, kind }: { items: Array<{ name: string; color: string }>; kind: 'line' | 'rect' | 'dot' }) {
  if (items.length < 2) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ice-300">
      {items.map((s) => (
        <span key={s.name} className="inline-flex items-center gap-1.5">
          {kind === 'line' ? (
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} />
          ) : kind === 'rect' ? (
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
          ) : (
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
          )}
          {s.name}
        </span>
      ))}
    </div>
  );
}

function Tooltip({ x, y, w, children }: { x: number; y: number; w: number; children: ReactNode }) {
  const left = x > w - 190 ? x - 12 : x + 12;
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-32 rounded-md border border-rink-600 bg-rink-950/95 px-2.5 py-1.5 text-xs shadow-lg shadow-black/40"
      style={{ left, top: Math.max(0, y - 10), transform: x > w - 190 ? 'translateX(-100%)' : undefined }}
    >
      {children}
    </div>
  );
}

export interface LineSeries {
  name: string;
  /** One value per x position (null = no data). */
  values: Array<number | null>;
  color?: string;
  /** Dashed reference line (e.g. a league average). */
  reference?: boolean;
}

/** Line chart over a shared x axis, with a crosshair tooltip listing every series. */
export function LineChart({
  x,
  series,
  height = 220,
  fmt = (v) => String(Math.round(v * 10) / 10),
  xLabel,
  yLabel,
  zeroBased = false,
  endLabels = true,
}: {
  x: Array<string | number>;
  series: LineSeries[];
  height?: number;
  fmt?: (v: number) => string;
  xLabel?: string;
  yLabel?: string;
  zeroBased?: boolean;
  endLabels?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const colored = series.map((s, i) => ({ ...s, color: s.color ?? SERIES[i % SERIES.length] }));
  const all = colored.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const labelRoom = endLabels && series.length <= 4 ? 64 : 12;
  const m = { l: 40, r: labelRoom, t: 10, b: xLabel ? 34 : 22 };
  const lo = zeroBased ? Math.min(0, ...all) : Math.min(...all);
  const hi = Math.max(...all);
  const ys = ticks(lo, hi, 4);
  const y0 = ys[0];
  const y1 = ys[ys.length - 1];
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;
  const px = (i: number) => m.l + (x.length <= 1 ? iw / 2 : (i / (x.length - 1)) * iw);
  const py = (v: number) => m.t + ih - ((v - y0) / (y1 - y0 || 1)) * ih;
  const xTicks = useMemo(() => {
    const n = Math.min(x.length, Math.max(2, Math.floor(iw / 70)));
    return Array.from(new Set(Array.from({ length: n }, (_, k) => Math.round((k / Math.max(1, n - 1)) * (x.length - 1)))));
  }, [x.length, iw]);
  if (!all.length) return <p className="py-8 text-center text-sm text-ice-500">No data yet.</p>;
  const path = (vals: Array<number | null>) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${px(i).toFixed(1)},${py(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const rel = (e.clientX - r.left) / r.width;
    setHover(Math.max(0, Math.min(x.length - 1, Math.round(rel * (x.length - 1)))));
  };
  // End labels, only when they don't collide.
  const ends = colored
    .map((s) => {
      let i = s.values.length - 1;
      while (i >= 0 && s.values[i] === null) i--;
      return i >= 0 ? { s, i, y: py(s.values[i]!) } : null;
    })
    .filter((e): e is NonNullable<typeof e> => !!e)
    .sort((a, b) => a.y - b.y);
  const collide = ends.some((e, k) => k > 0 && e.y - ends[k - 1].y < 13);
  return (
    <div ref={ref} className="relative w-full">
      <Legend items={colored} kind="line" />
      <svg width={width} height={height} role="img" aria-label={`${series.map((s) => s.name).join(', ')}${yLabel ? ` (${yLabel})` : ''}`}>
        {ys.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={width - m.r} y1={py(v)} y2={py(v)} stroke={GRID} strokeWidth={1} />
            <text x={m.l - 6} y={py(v) + 3.5} textAnchor="end" fontSize={10} fill={AXIS_TEXT} className="tabular-nums">
              {fmt(v)}
            </text>
          </g>
        ))}
        {xTicks.map((i) => (
          <text key={i} x={px(i)} y={height - m.b + 14} textAnchor="middle" fontSize={10} fill={AXIS_TEXT}>
            {x[i]}
          </text>
        ))}
        {xLabel && (
          <text x={m.l + iw / 2} y={height - 4} textAnchor="middle" fontSize={10} fill={AXIS_TEXT}>
            {xLabel}
          </text>
        )}
        {colored.map((s) => (
          <path
            key={s.name}
            d={path(s.values)}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={s.reference ? 0.75 : 1}
          />
        ))}
        {endLabels &&
          !collide &&
          series.length > 1 &&
          series.length <= 4 &&
          ends.map((e) => (
            <g key={e.s.name}>
              <circle cx={px(e.i)} cy={e.y} r={4} fill={e.s.color} stroke={SURFACE} strokeWidth={2} />
              <text x={px(e.i) + 8} y={e.y + 3.5} fontSize={10} fill="#b4c2d6">
                {fmt(e.s.values[e.i]!)}
              </text>
            </g>
          ))}
        {hover !== null && (
          <g>
            <line x1={px(hover)} x2={px(hover)} y1={m.t} y2={m.t + ih} stroke="#66788f" strokeWidth={1} />
            {colored.map((s) =>
              s.values[hover] !== null && s.values[hover] !== undefined ? (
                <circle key={s.name} cx={px(hover)} cy={py(s.values[hover]!)} r={4} fill={s.color} stroke={SURFACE} strokeWidth={2} />
              ) : null,
            )}
          </g>
        )}
        <rect
          x={m.l}
          y={m.t}
          width={iw}
          height={ih}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          tabIndex={0}
          onFocus={() => setHover(x.length - 1)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? x.length - 1) - 1));
            if (e.key === 'ArrowRight') setHover((h) => Math.min(x.length - 1, (h ?? 0) + 1));
          }}
        />
      </svg>
      {hover !== null && (
        <Tooltip x={px(hover)} y={m.t + 20} w={width}>
          <p className="mb-1 text-ice-400">
            {xLabel ? `${xLabel} ` : ''}
            {x[hover]}
          </p>
          {colored.map((s) => (
            <p key={s.name} className="flex items-center gap-2">
              <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} />
              <span className="font-semibold text-white tabular-nums">{s.values[hover] === null ? '—' : fmt(s.values[hover]!)}</span>
              <span className="text-ice-400">{s.name}</span>
            </p>
          ))}
        </Tooltip>
      )}
    </div>
  );
}

/** Columns from one baseline, value tooltips on hover; the highlighted column can take a second colour. */
export function ColumnChart({
  data,
  height = 200,
  fmt = (v) => String(v),
  valueName = 'Value',
  highlight,
  highlightName,
}: {
  data: Array<{ label: string; value: number; sub?: string }>;
  height?: number;
  fmt?: (v: number) => string;
  valueName?: string;
  /** Index of a column to draw in the second colour (e.g. your team). */
  highlight?: number;
  highlightName?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { l: 40, r: 8, t: 14, b: 24 };
  const vals = data.map((d) => d.value);
  const ys = ticks(Math.min(0, ...vals), Math.max(0, ...vals), 4);
  const y0 = ys[0];
  const y1 = ys[ys.length - 1];
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;
  const band = iw / Math.max(1, data.length);
  const bw = Math.min(24, Math.max(3, band - 2));
  const py = (v: number) => m.t + ih - ((v - y0) / (y1 - y0 || 1)) * ih;
  const every = Math.max(1, Math.ceil(data.length / Math.floor(iw / 34)));
  if (!data.length) return <p className="py-8 text-center text-sm text-ice-500">No data yet.</p>;
  const items = highlight !== undefined ? [{ name: valueName, color: SERIES[0] }, { name: highlightName ?? 'Highlighted', color: SERIES[1] }] : [];
  return (
    <div ref={ref} className="relative w-full">
      <Legend items={items} kind="rect" />
      <svg width={width} height={height} role="img" aria-label={valueName}>
        {ys.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={width - m.r} y1={py(v)} y2={py(v)} stroke={GRID} strokeWidth={1} />
            <text x={m.l - 6} y={py(v) + 3.5} textAnchor="end" fontSize={10} fill={AXIS_TEXT} className="tabular-nums">
              {fmt(v)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = m.l + band * i + band / 2;
          const top = py(Math.max(0, d.value));
          const bottom = py(Math.min(0, d.value));
          const h = Math.max(1, bottom - top);
          const r = Math.min(4, h, bw / 2);
          const up = d.value >= 0;
          // Rounded at the data end, square at the baseline.
          const x0 = cx - bw / 2;
          const path = up
            ? `M${x0},${bottom}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + bw - r}Q${x0 + bw},${top} ${x0 + bw},${top + r}V${bottom}Z`
            : `M${x0},${top}V${bottom - r}Q${x0},${bottom} ${x0 + r},${bottom}H${x0 + bw - r}Q${x0 + bw},${bottom} ${x0 + bw},${bottom - r}V${top}Z`;
          const color = i === highlight ? SERIES[1] : SERIES[0];
          return (
            <g key={i}>
              <path d={path} fill={color} opacity={hover === null || hover === i ? 1 : 0.55} />
              {i % every === 0 && (
                <text x={cx} y={height - m.b + 14} textAnchor="middle" fontSize={10} fill={AXIS_TEXT}>
                  {d.label}
                </text>
              )}
              <rect
                x={m.l + band * i}
                y={m.t}
                width={band}
                height={ih}
                fill="transparent"
                tabIndex={0}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            </g>
          );
        })}
        {y0 < 0 && <line x1={m.l} x2={width - m.r} y1={py(0)} y2={py(0)} stroke="#3d5078" strokeWidth={1} />}
      </svg>
      {hover !== null && (
        <Tooltip x={m.l + band * hover + band / 2} y={py(Math.max(0, data[hover].value))} w={width}>
          <p className="font-semibold text-white tabular-nums">{fmt(data[hover].value)}</p>
          <p className="text-ice-400">
            {data[hover].label}
            {data[hover].sub ? ` · ${data[hover].sub}` : ''}
          </p>
        </Tooltip>
      )}
    </div>
  );
}

export interface ScatterPoint {
  x: number;
  y: number;
  label: string;
  /** Index into the series list (default 0). */
  s?: number;
  detail?: string;
  href?: string;
}

/** Scatter plot with every point labelled (short labels) and a nearest-point hover. */
export function ScatterChart({
  points,
  series,
  height = 320,
  xLabel,
  yLabel,
  fmtX = (v) => v.toFixed(2),
  fmtY = (v) => v.toFixed(2),
  invertY = false,
  quadrantNote,
}: {
  points: ScatterPoint[];
  series: string[];
  height?: number;
  xLabel: string;
  yLabel: string;
  fmtX?: (v: number) => string;
  fmtY?: (v: number) => string;
  /** Draw the y axis with smaller values at the top (e.g. goals against: better is up). */
  invertY?: boolean;
  quadrantNote?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => setHover(null), [points]);
  const m = { l: 44, r: 16, t: 12, b: 36 };
  const xs = ticks(Math.min(...points.map((p) => p.x)), Math.max(...points.map((p) => p.x)), 5);
  const ysT = ticks(Math.min(...points.map((p) => p.y)), Math.max(...points.map((p) => p.y)), 5);
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;
  const px = (v: number) => m.l + ((v - xs[0]) / (xs[xs.length - 1] - xs[0] || 1)) * iw;
  const pyRaw = (v: number) => ((v - ysT[0]) / (ysT[ysT.length - 1] - ysT[0] || 1)) * ih;
  const py = (v: number) => (invertY ? m.t + pyRaw(v) : m.t + ih - pyRaw(v));
  if (!points.length) return <p className="py-8 text-center text-sm text-ice-500">No data yet.</p>;
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const mx = e.clientX - r.left + m.l;
    const my = e.clientY - r.top + m.t;
    let best = -1;
    let bd = Infinity;
    points.forEach((p, i) => {
      const d = (px(p.x) - mx) ** 2 + (py(p.y) - my) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    setHover(bd < 40 * 40 ? best : null);
  };
  const order = points.map((p, i) => ({ p, i })).sort((a, b) => (a.p.s ?? 0) - (b.p.s ?? 0));
  return (
    <div ref={ref} className="relative w-full">
      <Legend items={series.map((name, i) => ({ name, color: SERIES[i] }))} kind="dot" />
      <svg width={width} height={height} role="img" aria-label={`${yLabel} against ${xLabel}`}>
        {xs.map((v) => (
          <g key={`x${v}`}>
            <line x1={px(v)} x2={px(v)} y1={m.t} y2={m.t + ih} stroke={GRID} strokeWidth={1} />
            <text x={px(v)} y={m.t + ih + 14} textAnchor="middle" fontSize={10} fill={AXIS_TEXT}>
              {fmtX(v)}
            </text>
          </g>
        ))}
        {ysT.map((v) => (
          <g key={`y${v}`}>
            <line x1={m.l} x2={m.l + iw} y1={py(v)} y2={py(v)} stroke={GRID} strokeWidth={1} />
            <text x={m.l - 6} y={py(v) + 3.5} textAnchor="end" fontSize={10} fill={AXIS_TEXT}>
              {fmtY(v)}
            </text>
          </g>
        ))}
        <text x={m.l + iw / 2} y={height - 4} textAnchor="middle" fontSize={10} fill={AXIS_TEXT}>
          {xLabel}
        </text>
        <text x={12} y={m.t + ih / 2} textAnchor="middle" fontSize={10} fill={AXIS_TEXT} transform={`rotate(-90 12 ${m.t + ih / 2})`}>
          {yLabel}
        </text>
        {quadrantNote && (
          <text x={m.l + iw - 4} y={m.t + 12} textAnchor="end" fontSize={10} fill="#66788f">
            {quadrantNote}
          </text>
        )}
        {order.map(({ p, i }) => (
          <g key={i}>
            <circle cx={px(p.x)} cy={py(p.y)} r={hover === i ? 6 : 4.5} fill={SERIES[p.s ?? 0]} stroke={SURFACE} strokeWidth={2} />
            <text x={px(p.x) + 7} y={py(p.y) + 3.5} fontSize={9.5} fill={(p.s ?? 0) > 0 ? '#e6edf6' : '#8a9bb4'} fontWeight={(p.s ?? 0) > 0 ? 600 : 400}>
              {p.label}
            </text>
          </g>
        ))}
        <rect x={m.l} y={m.t} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {hover !== null && (
        <Tooltip x={px(points[hover].x)} y={py(points[hover].y)} w={width}>
          <p className="mb-0.5 font-semibold text-white">{points[hover].label}</p>
          <p className="text-ice-300">
            <span className="font-semibold text-white tabular-nums">{fmtX(points[hover].x)}</span> {xLabel}
          </p>
          <p className="text-ice-300">
            <span className="font-semibold text-white tabular-nums">{fmtY(points[hover].y)}</span> {yLabel}
          </p>
          {points[hover].detail && <p className="mt-0.5 text-ice-400">{points[hover].detail}</p>}
        </Tooltip>
      )}
    </div>
  );
}
