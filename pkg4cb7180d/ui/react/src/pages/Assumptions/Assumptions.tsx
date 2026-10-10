import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { FeatureCollection } from 'geojson';
import { Save, RotateCcw } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/ui/page-loader';
import {
  MetricCard,
  MetricCardHeader,
  MetricCardLabel,
  MetricCardValue,
  MetricCardCaption,
} from '@/components/ui/metric-card';
import CampusMap3D from '@/components/CampusMap3D/CampusMap3D';
import { useCampusGeojson } from '@/hooks/useCampusGeojson';
import { centroidBounds } from '@/shared/campusModel';
import { fetchAllBuildingHours } from '@/shared/energyApi';
import { fmtInt, fmtMoney, fmtNum } from '@/shared/format';
import {
  useAssumptions,
  ASSUMPTION_ROWS,
  WEEKS_PER_SEMESTER,
  SEMESTERS_PER_YEAR,
  type AssumptionKey,
  type AssumptionRow,
} from '@/contexts/AssumptionsProvider';

/**
 * Ease the displayed number from its previous value to `target` whenever the
 * target changes, so dragging a slider makes the headline figures glide rather
 * than snap. Honors prefers-reduced-motion by jumping straight to the value.
 */
function useTween(target: number, duration = 420): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const frameRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const from = fromRef.current;
    if (prefersReduced || from === target) {
      fromRef.current = target;
      setValue(target);
      return;
    }
    startRef.current = null;
    const tick = (now: number) => {
      if (startRef.current == null) startRef.current = now;
      const t = Math.min(1, (now - startRef.current) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (target - from) * eased);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
        setValue(target);
      }
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, [target, duration]);

  return value;
}

/** Live low→high range band with a mid marker, normalized to its own domain. */
function RangeBand({
  label,
  low,
  mid,
  high,
  fmt,
  unit,
}: {
  label: string;
  low: number;
  mid: number;
  high: number;
  fmt: (n: number) => string;
  unit: string;
}) {
  const max = Math.max(high * 1.12, 1);
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-[var(--mono-ink)]">{label}</span>
        <span className="mono tabnums text-sm text-[var(--powered-down)]">
          {fmt(mid)} {unit}
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-[var(--mono-hairline)]">
        <div
          className="absolute top-0 h-2 rounded-full bg-[var(--powered-down-soft)] transition-all duration-300"
          style={{ left: pct(low), width: `calc(${pct(high)} - ${pct(low)})` }}
        />
        <div
          className="absolute top-0 h-2 w-[2px] -translate-x-1/2 bg-[var(--powered-down)] transition-all duration-300"
          style={{ left: pct(mid) }}
        />
      </div>
      <div className="flex justify-between">
        <span className="mono text-[10px] text-[var(--mono-ink-2)]">{fmt(low)}</span>
        <span className="mono text-[10px] text-[var(--mono-ink-2)]">{fmt(high)}</span>
      </div>
    </div>
  );
}

export default function Assumptions() {
  // All figures flow from the one app-wide store, so every edit here updates the Overview KPIs, the
  // Landing stats and the Room-swaps summary at the same instant — no Save required to preview.
  const {
    assumptions,
    savings,
    freedHoursPerWeek,
    loading,
    error,
    saving,
    saved,
    setValue,
    reset,
    save,
  } = useAssumptions();

  // Map inset: freed building-hours per week per building (where savings come from).
  const geo = useCampusGeojson();
  const [freedByBuilding, setFreedByBuilding] = useState<Record<string, number>>({});
  const [maxFreed, setMaxFreed] = useState(1);

  useEffect(() => {
    let cancelled = false;
    fetchAllBuildingHours()
      .then((recs) => {
        if (cancelled) return;
        const counts: Record<string, number> = {};
        let mx = 1;
        for (const r of recs) {
          const cur = r.sectionsCurrent ?? 0;
          const opt = r.sectionsOptimized ?? 0;
          if (cur > 0 && opt === 0) {
            const b = r.building?.id;
            if (!b) continue;
            counts[b] = (counts[b] ?? 0) + 1;
            if (counts[b] > mx) mx = counts[b];
          }
        }
        setFreedByBuilding(counts);
        setMaxFreed(mx);
      })
      .catch(() => {
        // The map inset is supplementary — a load failure just hides it; the
        // headline savings above still render from their own fetch.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const bounds = useMemo(() => centroidBounds(geo.centroids), [geo.centroids]);
  const freedLabels = useMemo(
    () =>
      Object.keys(freedByBuilding)
        .filter((n) => geo.centroids[n])
        .sort((a, b) => freedByBuilding[b] - freedByBuilding[a])
        .slice(0, 12)
        .map((n) => ({ name: n, position: geo.centroids[n] })),
    [freedByBuilding, geo.centroids],
  );

  // Glide the headline numbers as sliders move.
  const mwhMid = useTween(savings.mwhMid);
  const dollarsMid = useTween(savings.dollarsMid);
  const co2Mid = useTween(savings.co2TonsMid);

  const fmtCell = (key: AssumptionKey, digits: number) =>
    digits > 0 ? assumptions[key].toFixed(digits) : String(Math.round(assumptions[key]));

  const cell = (key: AssumptionKey, row: AssumptionRow) => (
    <div className="flex items-center justify-end gap-3">
      <input
        type="range"
        step={row.step}
        min={row.min}
        max={row.max}
        value={assumptions[key]}
        onChange={(e) => setValue(key, Number(e.target.value))}
        className="io-range w-24 sm:w-28"
        aria-label={key}
      />
      <span className="mono tabnums w-14 shrink-0 text-right text-sm text-[var(--mono-ink)]">
        {fmtCell(key, row.digits)}
      </span>
    </div>
  );

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Savings assumptions"
        description="Every number across the app traces back to these assumptions. Drag a slider and the estimates update live everywhere; Save to persist for the whole app."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" appearance="secondary" onClick={reset}>
              <RotateCcw className="size-4" />
              Reset to defaults
            </Button>
            <Button variant="solid" appearance="accent" onClick={() => save()} disabled={saving}>
              <Save className="size-4" />
              {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
            </Button>
          </div>
        }
      />

      <div className="flex flex-col gap-6 p-4 md:p-6">
        {error ? (
          <div className="rounded-md bg-[var(--c3-style-basic-bg-danger)] px-4 py-3 text-sm text-[var(--c3-style-basic-fg-danger)]">
            {error}
          </div>
        ) : null}

        {loading ? (
          <PageLoader
            className="h-64"
            message="Loading savings assumptions…"
            hint="Fetching the saved parameters and freed building-hours."
          />
        ) : (
          <>
            {/* Live KPIs */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <MetricCard variant="elevated">
                <MetricCardHeader>
                  <MetricCardLabel>Energy saved / year</MetricCardLabel>
                </MetricCardHeader>
                <MetricCardValue>{fmtNum(mwhMid, 0)} MWh</MetricCardValue>
                <MetricCardCaption>
                  {fmtNum(savings.mwhLow, 0)} – {fmtNum(savings.mwhHigh, 0)} MWh
                </MetricCardCaption>
              </MetricCard>
              <MetricCard variant="elevated">
                <MetricCardHeader>
                  <MetricCardLabel>Cost saved / year</MetricCardLabel>
                </MetricCardHeader>
                <MetricCardValue>{fmtMoney(dollarsMid)}</MetricCardValue>
                <MetricCardCaption>
                  {fmtMoney(savings.dollarsLow)} – {fmtMoney(savings.dollarsHigh)}
                </MetricCardCaption>
              </MetricCard>
              <MetricCard variant="elevated">
                <MetricCardHeader>
                  <MetricCardLabel>CO₂ avoided / year</MetricCardLabel>
                </MetricCardHeader>
                <MetricCardValue>{fmtNum(co2Mid, 0)} t</MetricCardValue>
                <MetricCardCaption>
                  {fmtNum(savings.co2TonsLow, 0)} – {fmtNum(savings.co2TonsHigh, 0)} t
                </MetricCardCaption>
              </MetricCard>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">
              Based on {fmtInt(freedHoursPerWeek)} building-hours freed per week (from accepted
              moves). Annualized over {SEMESTERS_PER_YEAR} semesters of {WEEKS_PER_SEMESTER}{' '}
              instructional weeks.
            </p>

            {/* Where the savings come from — buildings the optimizer powers down,
                on the shared 3D campus map. Brighter ice = more freed hours/week. */}
            {geo.data && freedLabels.length ? (
              <Card variant="elevated">
                <CardContent className="p-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
                    <h3 className="text-base font-semibold text-foreground">
                      Where the savings come from
                    </h3>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span
                        className="h-2.5 w-16 rounded-sm"
                        style={{
                          background:
                            'linear-gradient(90deg, #1b394d 0%, #3f93d6 55%, #6ec1ff 100%)',
                        }}
                      />
                      <span>more freed hours / week →</span>
                    </div>
                  </div>
                  <div className="relative mt-3 h-[clamp(300px,40vh,460px)] overflow-hidden rounded-b-[var(--c3-style-border-radius-8)]">
                    <CampusMap3D
                      geojson={geo.data as FeatureCollection}
                      stateByBuilding={{}}
                      maxSections={1}
                      mode="study"
                      studyByBuilding={freedByBuilding}
                      maxFree={maxFreed}
                      labels={freedLabels}
                      bounds={bounds}
                    />
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {/* Live range band — low→high uncertainty, updates as you drag */}
            <Card variant="elevated">
              <CardContent className="flex flex-col gap-4 pt-5">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-base font-semibold text-foreground">Estimated range</h3>
                  <span className="text-xs text-muted-foreground">
                    bar = low→high · tick = mid · updates live
                  </span>
                </div>
                <RangeBand
                  label="Energy saved / year"
                  low={savings.mwhLow}
                  mid={savings.mwhMid}
                  high={savings.mwhHigh}
                  fmt={(n) => fmtNum(n, 0)}
                  unit="MWh"
                />
                <RangeBand
                  label="Cost saved / year"
                  low={savings.dollarsLow}
                  mid={savings.dollarsMid}
                  high={savings.dollarsHigh}
                  fmt={fmtMoney}
                  unit=""
                />
                <RangeBand
                  label="CO₂ avoided / year"
                  low={savings.co2TonsLow}
                  mid={savings.co2TonsMid}
                  high={savings.co2TonsHigh}
                  fmt={(n) => fmtNum(n, 0)}
                  unit="t"
                />
              </CardContent>
            </Card>

            {/* Scenario table — three editable energy-intensity bands */}
            <Card variant="elevated">
              <CardContent className="pt-5">
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-base font-semibold text-foreground">
                    Low / mid / high scenarios
                  </h3>
                </div>
                <p className="mb-4 text-xs text-muted-foreground">
                  Annualized over {SEMESTERS_PER_YEAR} semesters of {WEEKS_PER_SEMESTER} instructional
                  weeks. Each band is kept ordered — low ≤ mid ≤ high — as you drag.
                </p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--c3-style-basic-border-border)]">
                      <th className="pb-2 text-left font-medium text-muted-foreground">Assumption</th>
                      <th className="pb-2 text-right font-medium text-muted-foreground">Low</th>
                      <th className="pb-2 text-right font-medium text-muted-foreground">Mid</th>
                      <th className="pb-2 text-right font-medium text-muted-foreground">High</th>
                      <th className="pb-2 pl-3 text-left font-medium text-muted-foreground">Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ASSUMPTION_ROWS.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-[var(--c3-style-basic-border-border)]"
                      >
                        <td className="py-3 text-foreground">{row.label}</td>
                        <td className="py-3 text-right">{cell(row.keys[0], row)}</td>
                        <td className="py-3 text-right">{cell(row.keys[1], row)}</td>
                        <td className="py-3 text-right">{cell(row.keys[2], row)}</td>
                        <td className="py-3 pl-3 text-muted-foreground">{row.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <div className="rounded-md border border-[var(--c3-style-basic-border-border)] bg-[var(--c3-style-basic-bg-secondary)] px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              <strong className="text-foreground">Assumption note:</strong> Savings assume
              classroom-zone HVAC setback over each freed building-hour — i.e. a freed hour lets
              the classroom zone drop to a setback temperature rather than fully shutting the
              building. Per freed building-hour: energy = kWh assumption; cost = kWh × price;
              CO₂ = kWh × emission factor. Annualized as freed-hours/week × {WEEKS_PER_SEMESTER}{' '}
              weeks × {SEMESTERS_PER_YEAR} semesters.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
