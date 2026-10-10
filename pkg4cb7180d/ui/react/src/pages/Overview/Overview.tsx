import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Play, X, Info } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PageHeader } from '@/components/ui/page-header';
import { PageLoader } from '@/components/ui/page-loader';
import RunOptimizerDialog from '@/components/RunOptimizerDialog/RunOptimizerDialog';
import CampusMapPanel from '@/components/CampusMap3D/CampusMapPanel';
import { useCampusGeojson } from '@/hooks/useCampusGeojson';
import { useCountUp } from '@/hooks/useCountUp';
import { fetchOverviewStats, fetchAllBuildingHours } from '@/shared/energyApi';
import { useAssumptions } from '@/contexts/AssumptionsProvider';
import { buildWeek, weekMetrics, CampusWeek } from '@/shared/campusModel';
import { COLOR_RUNNING, COLOR_SAVED, fmtInt, fmtMoney, fmtNum, fmtRange } from '@/shared/format';
import type { OverviewStats } from '@/Interfaces';

const SUBTITLE =
  'Real UIUC Fall 2026 schedule · 7,010 sections · 106 buildings · 790 rooms';

interface KpiInfo {
  title: string;
  body: string;
}

/** Small uppercase eyebrow + large tight headline number tile (clickable). */
function KpiTile({
  label,
  value,
  sub,
  accent,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: 'energy' | 'saved';
  onClick?: () => void;
}) {
  const color =
    accent === 'saved'
      ? 'var(--powered-down)'
      : accent === 'energy'
        ? 'var(--energy-on)'
        : 'var(--mono-ink)';
  return (
    <button
      type="button"
      onClick={onClick}
      className="panel group flex flex-col gap-2 rounded-[var(--c3-style-border-radius-6)] p-5 text-left transition-colors hover:border-[var(--mono-hairline-strong)]"
    >
      <span className="eyebrow flex items-center gap-1 text-[var(--mono-ink-faint)]">
        {label}
        <Info className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
      </span>
      <span className="font-display tabnums text-3xl leading-none sm:text-4xl" style={{ color }}>
        {value}
      </span>
      {sub ? <span className="text-xs text-[var(--mono-ink-2)]">{sub}</span> : null}
    </button>
  );
}

/** Right-hand drawer explaining how a KPI is computed from BuildingHour rows. */
function HowComputedDrawer({ info, onClose }: { info: KpiInfo; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div className="relative flex w-full max-w-sm flex-col border-l border-[var(--mono-hairline-strong)] bg-[var(--c3-style-basic-bg-primary)] shadow-[var(--c3-style-shadow-default-lg)]">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--mono-hairline)] px-5 py-4">
          <div>
            <div className="eyebrow text-[var(--mono-ink-faint)]">How this is computed</div>
            <div className="font-display text-base text-[var(--mono-ink)]">{info.title}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-[var(--c3-style-border-radius-4)] p-1 text-[var(--mono-ink-2)] hover:bg-[var(--c3-style-basic-bg-accent)] hover:text-[var(--mono-ink)]"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto px-5 py-4">
          <p className="text-sm leading-relaxed text-[var(--mono-ink-2)]">{info.body}</p>
        </div>
      </div>
    </div>
  );
}

interface WeekdayDatum {
  label: string;
  current: number;
  optimized: number;
}

/** Secondary: hours with HVAC off per weekday (current vs optimized). */
function WeekdayComparison({ data }: { data: WeekdayDatum[] }) {
  return (
    <div className="panel rounded-[var(--c3-style-border-radius-6)] p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-base text-[var(--mono-ink)]">
          Hours with HVAC off by weekday
        </h3>
        <span className="text-xs text-[var(--mono-ink-2)]">
          Higher = more buildings fully dark for HVAC setback
        </span>
      </div>
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }} barGap={6}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--mono-hairline)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              fontSize={12}
              stroke="var(--mono-ink-2)"
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              fontSize={12}
              width={44}
              stroke="var(--mono-ink-2)"
            />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              formatter={(value: number, name: string) => [
                fmtInt(value),
                name === 'current' ? 'Current' : 'Optimized',
              ]}
              contentStyle={{
                fontSize: 12,
                borderRadius: 8,
                background: 'var(--c3-style-basic-bg-primary)',
                border: '1px solid var(--mono-hairline-strong)',
                color: 'var(--mono-ink)',
              }}
            />
            <Bar dataKey="current" name="current" radius={[3, 3, 0, 0]} maxBarSize={38}>
              {data.map((d) => (
                <Cell key={`c-${d.label}`} fill={COLOR_RUNNING} />
              ))}
            </Bar>
            <Bar dataKey="optimized" name="optimized" radius={[3, 3, 0, 0]} maxBarSize={38}>
              {data.map((d) => (
                <Cell key={`o-${d.label}`} fill={COLOR_SAVED} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function Overview() {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [week, setWeek] = useState<CampusWeek | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playNonce, setPlayNonce] = useState(0);
  const [countKey, setCountKey] = useState(0);
  const [info, setInfo] = useState<KpiInfo | null>(null);
  const geo = useCampusGeojson();
  // Dollars / CO₂ / ranges read from the shared assumptions store so they move live with the sliders
  // on the Setback page, rather than the snapshot the backend baked into overviewStats.
  const { savings } = useAssumptions();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, rows] = await Promise.all([fetchOverviewStats(), fetchAllBuildingHours()]);
      setStats(s);
      setWeek(buildWeek(rows));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load overview statistics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const metrics = useMemo(() => (week ? weekMetrics(week) : null), [week]);
  const sav = savings;

  // Count-up the headline figures. `countKey` lets "Play the day" replay them.
  const dollars = useCountUp(sav?.dollarsMid ?? 0, 1200, countKey);
  const freedBuildings = useCountUp(metrics?.buildingsWithFreedHours ?? 0, 1000, countKey);
  const wastefulOpt = useCountUp(metrics?.wastefulOptimized ?? 0, 1000, countKey);
  const co2 = useCountUp(sav?.co2TonsMid ?? 0, 1000, countKey);

  const weekdayData: WeekdayDatum[] =
    stats?.byWeekday.map((w) => ({
      label: w.label,
      current: w.current,
      optimized: w.optimized,
    })) ?? [];

  const roomChanges = stats
    ? stats.acceptedCount > 0
      ? stats.acceptedCount
      : stats.movesCount
    : 0;
  const err = error ?? geo.error;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Overview"
        description={SUBTITLE}
        actions={<RunOptimizerDialog onComplete={load} />}
      />

      <div className="flex flex-col gap-6 p-4 md:p-6">
        {err ? (
          <div className="rounded-[var(--c3-style-border-radius-6)] bg-[var(--c3-style-basic-bg-danger)] px-4 py-3 text-sm text-[var(--c3-style-basic-fg-danger)]">
            {err}
          </div>
        ) : null}

        {/* Hero: 3D campus map + Play-the-day */}
        {geo.loading || !week || !geo.data ? (
          <PageLoader
            className="h-[60vh] min-h-[420px] rounded-[var(--c3-style-border-radius-8)] border border-[var(--mono-hairline)]"
            message="Loading campus map…"
            hint="Fetching building footprints and the week's schedule."
          />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg text-[var(--mono-ink)]">A day on campus</h2>
                <p className="text-xs text-[var(--mono-ink-2)]">
                  Watch the schedule light up 7am→10pm, then flip to the optimized plan.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPlayNonce((n) => n + 1)}
                className="inline-flex items-center gap-2 rounded-full bg-[var(--c3-style-basic-bg-accent-inverse)] px-4 py-2 text-sm font-medium text-[var(--c3-style-basic-fg-accent-inverse)] transition-opacity hover:opacity-90"
              >
                <Play className="size-4" />
                Play the day
              </button>
            </div>
            <CampusMapPanel
              week={week}
              geojson={geo.data}
              matched={geo.matched}
              centroids={geo.centroids}
              heightClass="h-[60vh] min-h-[420px]"
              playNonce={playNonce}
              onCinematicEnd={() => setCountKey((k) => k + 1)}
            />
          </div>
        )}

        {loading || !stats || !sav || !metrics ? (
          <PageLoader
            className="h-40"
            message="Loading key metrics…"
            hint="Computing freed building-hours and annual savings."
          />
        ) : (
          <>
            {/* (a) Hero: dollars saved per year */}
            <button
              type="button"
              onClick={() =>
                setInfo({
                  title: 'Energy cost saved per year',
                  body:
                    'For every building-hour the optimizer leaves fully empty, the classroom-zone HVAC can be set back. We multiply the count of freed building-hours per week by a mid-point kWh-per-freed-hour assumption and the campus blended $/kWh rate, then annualize across the semester. The range reflects the low/high energy-intensity assumptions on the Assumptions page.',
                })
              }
              className="panel group flex flex-col gap-2 rounded-[var(--c3-style-border-radius-8)] p-6 text-left transition-colors hover:border-[var(--mono-hairline-strong)]"
            >
              <span className="eyebrow flex items-center gap-1 text-[var(--mono-ink-faint)]">
                Saved per year
                <Info className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
              </span>
              <span className="font-display tabnums text-5xl leading-none text-[var(--mono-ink)] sm:text-6xl">
                {fmtMoney(dollars)}
              </span>
              <span className="text-sm text-[var(--mono-ink-2)]">
                {fmtRange(sav.dollarsLow, sav.dollarsHigh, fmtMoney)} estimated range · classroom-zone
                HVAC setback over every freed building-hour, annualized
              </span>
            </button>

            {/* (b)(c)(d) */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <KpiTile
                label="Buildings that power down early"
                value={fmtInt(freedBuildings)}
                sub={`out of ${fmtInt(metrics.totalBuildings)} buildings gain ≥1 freed hour/week`}
                accent="saved"
                onClick={() =>
                  setInfo({
                    title: 'Buildings that power down early',
                    body:
                      'A building "powers down early" in any week where the optimizer empties at least one building-hour that was occupied in the current schedule (current sections > 0, optimized sections = 0). We scan every BuildingHour row and count the distinct buildings that gain one or more such freed hours.',
                  })
                }
              />
              <KpiTile
                label="Wasteful hours eliminated / week"
                value={
                  <span>
                    {fmtInt(metrics.wastefulCurrent)}
                    <span className="mx-2 text-[var(--mono-ink-faint)]">→</span>
                    <span style={{ color: 'var(--powered-down)' }}>{fmtInt(wastefulOpt)}</span>
                  </span>
                }
                sub={`${fmtInt(
                  metrics.wastefulCurrent - metrics.wastefulOptimized,
                )} fewer building-hours running just 1–2 classes`}
                onClick={() =>
                  setInfo({
                    title: 'Wasteful hours eliminated per week',
                    body:
                      'A "wasteful" building-hour is one where a whole building is kept conditioned for only 1 or 2 running sections. We count those building-hours in the current schedule and again in the optimized schedule; the drop is how many near-empty hours the room moves eliminate each week.',
                  })
                }
              />
              <KpiTile
                label="Tons of CO₂ avoided / year"
                value={fmtNum(co2, 0)}
                sub={`${fmtRange(sav.co2TonsLow, sav.co2TonsHigh, (n) => fmtNum(n, 0))} metric tons range`}
                accent="saved"
                onClick={() =>
                  setInfo({
                    title: 'Tons of CO₂ avoided per year',
                    body:
                      'The annual energy saved from HVAC setback is converted to avoided emissions using the grid carbon-intensity assumption (kg CO₂ per kWh) from the Assumptions page, then expressed in metric tons. The range tracks the low/high energy and carbon-intensity assumptions.',
                  })
                }
              />
            </div>

            {/* room-change line */}
            <p className="text-sm text-[var(--mono-ink-2)]">
              <span className="font-medium text-[var(--mono-ink)]">
                {fmtInt(roomChanges)} classes change rooms.
              </span>{' '}
              0 class times change.
            </p>

            {/* Secondary chart */}
            <WeekdayComparison data={weekdayData} />
          </>
        )}
      </div>

      {info ? <HowComputedDrawer info={info} onClose={() => setInfo(null)} /> : null}
    </div>
  );
}
