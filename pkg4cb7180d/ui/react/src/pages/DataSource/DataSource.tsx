import React, { useEffect, useState } from 'react';
import { Database, FileSpreadsheet, Boxes, Activity, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { PageLoader } from '@/components/ui/page-loader';
import { fetchDataCounts, type DataCounts } from '@/shared/energyApi';
import { fmtInt } from '@/shared/format';
import './pipeline.css';

type CountKey = keyof DataCounts;

const COUNT_TILES: { key: CountKey; label: string; sub: string }[] = [
  { key: 'buildings', label: 'Buildings', sub: 'loaded in C3' },
  { key: 'rooms', label: 'Rooms', sub: 'loaded in C3' },
  { key: 'sections', label: 'Sections', sub: 'Fall 2026 term' },
  { key: 'buildingHours', label: 'Building-hour cells', sub: 'occupancy grid' },
];

interface PipelineStep {
  title: string;
  detail: string;
  icon: React.ReactNode;
  /** live count chip attached to this stage, if any */
  countKey?: CountKey;
  countLabel?: string;
}

const PIPELINE: PipelineStep[] = [
  {
    title: 'UIUC Course Explorer',
    detail:
      'The official Course Explorer publishes the Fall 2026 term schedule — subjects, CRNs, meeting days, times, and assigned rooms.',
    icon: <FileSpreadsheet className="size-4" />,
  },
  {
    title: 'Extract & normalize',
    detail:
      'A scheduled job pulls the term feed, normalizes meeting days (MTWRF), parses start/end minutes, and flags movable lecture/discussion/lab sections vs. fixed specialty venues.',
    icon: <Activity className="size-4" />,
    countKey: 'sections',
    countLabel: 'sections parsed',
  },
  {
    title: 'Load into C3 types',
    detail:
      'Rows map into Building, Room, and Section entity types via the C3 data pipeline — the same types every screen and the optimizer read from.',
    icon: <Boxes className="size-4" />,
    countKey: 'buildings',
    countLabel: 'buildings',
  },
  {
    title: 'Recompute occupancy',
    detail:
      'BuildingHour.sectionsCurrent is recomputed from the loaded sections so the baseline occupancy grid always matches the live schedule.',
    icon: <Database className="size-4" />,
    countKey: 'buildingHours',
    countLabel: 'building-hour cells',
  },
];

export default function DataSource() {
  const [counts, setCounts] = useState<DataCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // How many pipeline stages have "revealed" — drives the staged glide-in and
  // lets the flowing connectors appear in sequence (source → … → occupancy).
  const [shown, setShown] = useState(0);

  useEffect(() => {
    fetchDataCounts()
      .then(setCounts)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load counts.'))
      .finally(() => setLoading(false));
  }, []);

  // Reveal the pipeline stages one after another once the counts land.
  useEffect(() => {
    if (loading) return;
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      setShown(PIPELINE.length);
      return;
    }
    let n = 0;
    const id = window.setInterval(() => {
      n += 1;
      setShown(n);
      if (n >= PIPELINE.length) window.clearInterval(id);
    }, 280);
    return () => window.clearInterval(id);
  }, [loading]);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Data source"
        description="Where the schedule comes from and how it is kept current. Every figure in this app traces back to these live records."
      />

      <div className="flex flex-col gap-6 p-4 md:p-6">
        {error ? (
          <div className="rounded-[var(--c3-style-border-radius-6)] bg-[var(--c3-style-basic-bg-danger)] px-4 py-3 text-sm text-[var(--c3-style-basic-fg-danger)]">
            {error}
          </div>
        ) : null}

        {/* Live record counts */}
        {loading ? (
          <PageLoader className="h-32" message="Loading data source…" />
        ) : counts ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {COUNT_TILES.map((t) => (
              <div
                key={t.key}
                className="panel flex flex-col gap-2 rounded-[var(--c3-style-border-radius-6)] p-5"
              >
                <span className="eyebrow text-[var(--mono-ink-faint)]">{t.label}</span>
                <span className="font-display tabnums text-3xl leading-none text-[var(--mono-ink)] sm:text-4xl">
                  {fmtInt(counts[t.key])}
                </span>
                <span className="text-xs text-[var(--mono-ink-2)]">{t.sub}</span>
              </div>
            ))}
          </div>
        ) : null}

        {/* Pipeline diagram */}
        <div className="panel rounded-[var(--c3-style-border-radius-8)] p-5">
          <div className="mb-4 flex items-baseline justify-between gap-2">
            <h3 className="font-display text-base text-[var(--mono-ink)]">Refresh pipeline</h3>
            <span className="eyebrow text-[var(--mono-ink-faint)]">source → C3 types</span>
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
            {PIPELINE.map((step, i) => (
              <React.Fragment key={step.title}>
                <div
                  className="ds-stage flex flex-1 flex-col gap-2 rounded-[var(--c3-style-border-radius-6)] border border-[var(--mono-hairline)] bg-[var(--c3-style-basic-bg-secondary)] p-4"
                  data-shown={i < shown}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[var(--mono-hairline-strong)] text-[var(--mono-ink-2)]">
                      {step.icon}
                    </span>
                    <span className="mono text-[11px] text-[var(--mono-ink-faint)]">
                      STEP {i + 1}
                    </span>
                    {i === PIPELINE.length - 1 ? (
                      <CheckCircle2 className="ml-auto size-4 text-[var(--powered-down)]" />
                    ) : null}
                  </div>
                  <div className="font-medium text-[var(--mono-ink)]">{step.title}</div>
                  <p className="text-xs leading-relaxed text-[var(--mono-ink-2)]">{step.detail}</p>
                  {step.countKey && counts ? (
                    <div className="mt-auto flex items-baseline gap-1.5 pt-1">
                      <span className="font-display tabnums text-lg leading-none text-[var(--mono-ink)]">
                        {fmtInt(counts[step.countKey])}
                      </span>
                      <span className="text-[11px] text-[var(--mono-ink-faint)]">
                        {step.countLabel}
                      </span>
                    </div>
                  ) : null}
                </div>
                {i < PIPELINE.length - 1 ? (
                  <div className="flex shrink-0 items-center justify-center lg:px-1" aria-hidden>
                    {/* desktop: horizontal flowing connector; mobile: vertical */}
                    <div className="ds-connector hidden h-[2px] w-10 rounded bg-[var(--mono-hairline)] lg:block" />
                    <div className="ds-connector ds-connector-y h-6 w-[2px] rounded bg-[var(--mono-hairline)] lg:hidden" />
                  </div>
                ) : null}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Provenance notes */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="panel rounded-[var(--c3-style-border-radius-6)] p-5">
            <div className="mb-2 flex items-center gap-2">
              <FileSpreadsheet className="size-4 text-[var(--mono-ink-2)]" />
              <h3 className="font-display text-base text-[var(--mono-ink)]">Current snapshot</h3>
            </div>
            <p className="text-sm leading-relaxed text-[var(--mono-ink-2)]">
              This deployment was loaded from a one-time snapshot of the Fall 2026 Course Explorer
              export (buildings, rooms, sections, and the derived building-hour occupancy grid),
              mapped directly into C3 entity types. No synthetic or hand-entered schedule data is
              used.
            </p>
          </div>
          <div className="panel rounded-[var(--c3-style-border-radius-6)] p-5">
            <div className="mb-2 flex items-center gap-2">
              <Database className="size-4 text-[var(--mono-ink-2)]" />
              <h3 className="font-display text-base text-[var(--mono-ink)]">Going live</h3>
            </div>
            <p className="text-sm leading-relaxed text-[var(--mono-ink-2)]">
              To refresh each term, point a C3 data integration source at the Course Explorer term
              feed and schedule the extract-and-load job above. The optimizer, heatmap, and savings
              model all read from the same types, so they update automatically once new records
              land — no screen changes required.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
