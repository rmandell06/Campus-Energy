import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Save, RotateCcw } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  MetricCard,
  MetricCardHeader,
  MetricCardLabel,
  MetricCardValue,
  MetricCardCaption,
} from '@/components/ui/metric-card';
import { fetchAssumptions, saveAssumptions, fetchOverviewStats } from '@/shared/energyApi';
import { computeSavings } from '@/shared/savings';
import { fmtInt, fmtMoney, fmtNum } from '@/shared/format';
import type { SavingsAssumptionsRec } from '@/Interfaces';

type NumKey =
  | 'kwhPerFreedHourLow'
  | 'kwhPerFreedHourMid'
  | 'kwhPerFreedHourHigh'
  | 'electricityPriceLow'
  | 'electricityPriceMid'
  | 'electricityPriceHigh'
  | 'emissionFactorLow'
  | 'emissionFactorMid'
  | 'emissionFactorHigh'
  | 'weeksPerSemester'
  | 'semestersPerYear';

const DEFAULTS: SavingsAssumptionsRec = {
  id: 'default',
  kwhPerFreedHourLow: 50,
  kwhPerFreedHourMid: 100,
  kwhPerFreedHourHigh: 150,
  electricityPriceLow: 0.08,
  electricityPriceMid: 0.1,
  electricityPriceHigh: 0.12,
  emissionFactorLow: 0.35,
  emissionFactorMid: 0.4,
  emissionFactorHigh: 0.45,
  weeksPerSemester: 15,
  semestersPerYear: 2,
};

interface ScenarioRow {
  label: string;
  unit: string;
  keys: [NumKey, NumKey, NumKey];
  step: number;
  min: number;
  max: number;
}

const SCENARIO_ROWS: ScenarioRow[] = [
  {
    label: 'Energy per freed building-hour',
    unit: 'kWh',
    keys: ['kwhPerFreedHourLow', 'kwhPerFreedHourMid', 'kwhPerFreedHourHigh'],
    step: 1,
    min: 0,
    max: 300,
  },
  {
    label: 'Electricity price',
    unit: '$/kWh',
    keys: ['electricityPriceLow', 'electricityPriceMid', 'electricityPriceHigh'],
    step: 0.005,
    min: 0,
    max: 0.3,
  },
  {
    label: 'Emission factor',
    unit: 'kg CO₂/kWh',
    keys: ['emissionFactorLow', 'emissionFactorMid', 'emissionFactorHigh'],
    step: 0.01,
    min: 0,
    max: 0.8,
  },
];

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
  const [draft, setDraft] = useState<SavingsAssumptionsRec>(DEFAULTS);
  const [freedHours, setFreedHours] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchAssumptions(), fetchOverviewStats()])
      .then(([a, stats]) => {
        if (cancelled) return;
        setDraft({ ...DEFAULTS, ...a, id: 'default' });
        setFreedHours(stats.freedHoursPerWeek);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load assumptions.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (key: NumKey, value: string) => {
    const n = Number(value);
    setSaved(false);
    setDraft((d) => ({ ...d, [key]: Number.isFinite(n) ? n : 0 }));
  };

  const savings = useMemo(() => computeSavings(draft, freedHours), [draft, freedHours]);

  // Glide the headline numbers as sliders move.
  const mwhMid = useTween(savings.mwhMid);
  const dollarsMid = useTween(savings.dollarsMid);
  const co2Mid = useTween(savings.co2TonsMid);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveAssumptions(draft);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save assumptions.');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setDraft(DEFAULTS);
    setSaved(false);
  };

  const fmtCell = (key: NumKey, step: number) =>
    step < 1 ? draft[key].toFixed(step < 0.01 ? 3 : 2) : String(draft[key]);

  const cell = (key: NumKey, step: number, min: number, max: number) => (
    <div className="flex items-center justify-end gap-3">
      <input
        type="range"
        step={step}
        min={min}
        max={max}
        value={draft[key]}
        onChange={(e) => set(key, e.target.value)}
        className="io-range w-24 sm:w-28"
        aria-label={key}
      />
      <span className="mono tabnums w-14 shrink-0 text-right text-sm text-[var(--mono-ink)]">
        {fmtCell(key, step)}
      </span>
    </div>
  );

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Savings assumptions"
        description="Every number on the dashboard traces back to these assumptions. Edit a cell and the estimates update live; Save to persist for the whole app."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" appearance="secondary" onClick={reset}>
              <RotateCcw className="size-4" />
              Reset to defaults
            </Button>
            <Button variant="solid" appearance="accent" onClick={save} disabled={saving}>
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
          <div className="flex h-64 items-center justify-center">
            <Spinner />
          </div>
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
              Based on {fmtInt(freedHours)} building-hours freed per week (from accepted moves).
            </p>

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

            {/* Scenario table */}
            <Card variant="elevated">
              <CardContent className="pt-5">
                <h3 className="mb-4 text-base font-semibold text-foreground">
                  Low / mid / high scenarios
                </h3>
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
                    {SCENARIO_ROWS.map((row) => (
                      <tr key={row.label} className="border-b border-[var(--c3-style-basic-border-border)]">
                        <td className="py-3 text-foreground">{row.label}</td>
                        <td className="py-3 text-right">{cell(row.keys[0], row.step, row.min, row.max)}</td>
                        <td className="py-3 text-right">{cell(row.keys[1], row.step, row.min, row.max)}</td>
                        <td className="py-3 text-right">{cell(row.keys[2], row.step, row.min, row.max)}</td>
                        <td className="py-3 pl-3 text-muted-foreground">{row.unit}</td>
                      </tr>
                    ))}
                    <tr className="border-b border-[var(--c3-style-basic-border-border)]">
                      <td className="py-3 text-foreground">Weeks per semester</td>
                      <td className="py-3 text-right" colSpan={3}>
                        <div className="flex justify-end pr-0">{cell('weeksPerSemester', 1, 1, 20)}</div>
                      </td>
                      <td className="py-3 pl-3 text-muted-foreground">weeks</td>
                    </tr>
                    <tr>
                      <td className="py-3 text-foreground">Semesters per year</td>
                      <td className="py-3 text-right" colSpan={3}>
                        <div className="flex justify-end pr-0">{cell('semestersPerYear', 1, 1, 4)}</div>
                      </td>
                      <td className="py-3 pl-3 text-muted-foreground">semesters</td>
                    </tr>
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <div className="rounded-md border border-[var(--c3-style-basic-border-border)] bg-[var(--c3-style-basic-bg-secondary)] px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              <strong className="text-foreground">Assumption note:</strong> Savings assume
              classroom-zone HVAC setback over each freed building-hour — i.e. a freed hour lets
              the classroom zone drop to a setback temperature rather than fully shutting the
              building. Per freed building-hour: energy = kWh assumption; cost = kWh × price;
              CO₂ = kWh × emission factor. Annualized as freed-hours/week × weeks/semester ×
              semesters/year.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
