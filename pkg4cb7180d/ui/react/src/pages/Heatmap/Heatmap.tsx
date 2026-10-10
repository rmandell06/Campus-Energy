import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Grid3x3, Map as MapIcon } from 'lucide-react';
import type { FeatureCollection } from 'geojson';
import { useIsMobile } from '@/hooks/useIsMobile';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/ui/page-loader';
import Skyline3D, { type SkylineCell, type SkylineHoverInfo } from '@/components/Skyline3D/Skyline3D';
import CampusMapPanel from '@/components/CampusMap3D/CampusMapPanel';
import { useCampusGeojson } from '@/hooks/useCampusGeojson';
import { buildWeek, type CampusWeek } from '@/shared/campusModel';
import { fetchBuildingHoursForDay, fetchAllBuildingHours } from '@/shared/energyApi';
import {
  HOURS,
  WEEKDAYS,
  hourLabel,
  hourLabelLong,
  occupancyColor,
  occupancyTextColor,
  fmtInt,
} from '@/shared/format';
import type { BuildingHourRec } from '@/Interfaces';

type Scenario = 'current' | 'optimized';
type ViewMode = '2d' | '3d' | 'map';
type SortMode = 'busy' | 'empty' | 'az';

interface BuildingRow {
  id: string;
  byHour: Record<number, { current: number; optimized: number }>;
  total: number;
}

const TOP_N = 40; // buildings in the 3D skyline

export default function Heatmap() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [day, setDay] = useState('M');
  const [scenario, setScenario] = useState<Scenario>('current');
  const [view, setView] = useState<ViewMode>('3d');
  const [sort, setSort] = useState<SortMode>('busy');
  const [rows, setRows] = useState<BuildingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tip, setTip] = useState<SkylineHoverInfo | null>(null);

  // "On map" view — the shared 3D campus map, loaded lazily on first open.
  const geo = useCampusGeojson();
  const [week, setWeek] = useState<CampusWeek | null>(null);
  const [weekLoading, setWeekLoading] = useState(false);
  const [weekError, setWeekError] = useState<string | null>(null);
  // Mirror of `week` readable inside the effect without being a dependency.
  // (Depending on `weekLoading` re-ran the effect the moment it flipped to true,
  // whose cleanup cancelled the in-flight fetch → the spinner never resolved.)
  const weekRef = useRef<CampusWeek | null>(null);

  useEffect(() => {
    if (view !== 'map' || weekRef.current) return;
    let cancelled = false;
    setWeekLoading(true);
    setWeekError(null);
    fetchAllBuildingHours()
      .then((recs) => {
        if (cancelled) return;
        const w = buildWeek(recs);
        weekRef.current = w;
        setWeek(w);
      })
      .catch((e) => {
        if (!cancelled) setWeekError(e instanceof Error ? e.message : 'Failed to load campus map.');
      })
      .finally(() => {
        if (!cancelled) setWeekLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchBuildingHoursForDay(day)
      .then((recs: BuildingHourRec[]) => {
        if (cancelled) return;
        const map = new Map<string, BuildingRow>();
        for (const r of recs) {
          const bid = r.building?.id ?? 'Unknown';
          let row = map.get(bid);
          if (!row) {
            row = { id: bid, byHour: {}, total: 0 };
            map.set(bid, row);
          }
          row.byHour[r.hour] = {
            current: r.sectionsCurrent ?? 0,
            optimized: r.sectionsOptimized ?? 0,
          };
          row.total += r.sectionsCurrent ?? 0;
        }
        const list = Array.from(map.values()).sort((a, b) => b.total - a.total);
        setRows(list);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load heatmap.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [day]);

  const maxOcc = useMemo(() => {
    let m = 1;
    for (const row of rows) {
      for (const h of HOURS) {
        const cell = row.byHour[h];
        if (cell) m = Math.max(m, cell.current, cell.optimized);
      }
    }
    return m;
  }, [rows]);

  // Rows for the 2D grid stay busiest-first; the 3D skyline uses the sort control.
  const sortedRows = useMemo(() => {
    const list = [...rows];
    if (sort === 'empty') list.sort((a, b) => a.total - b.total);
    else if (sort === 'az') list.sort((a, b) => a.id.localeCompare(b.id));
    else list.sort((a, b) => b.total - a.total);
    return list;
  }, [rows, sort]);

  const skyline = useMemo(() => {
    const top = sortedRows.slice(0, TOP_N);
    const buildings = top.map((r) => r.id);
    const cells: SkylineCell[] = [];
    top.forEach((row, bi) => {
      HOURS.forEach((h, hi) => {
        const cell = row.byHour[h];
        if (!cell) return;
        const cur = cell.current;
        const opt = cell.optimized;
        const sections = scenario === 'current' ? cur : opt;
        const freed = scenario === 'optimized' && cur > 0 && opt === 0;
        if (sections <= 0 && !freed) return;
        cells.push({ building: row.id, buildingIndex: bi, hour: h, hourIndex: hi, sections, freed });
      });
    });
    return { buildings, cells };
  }, [sortedRows, scenario]);

  const dayLabel = WEEKDAYS.find((w) => w.day === day)?.label;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Occupancy heatmap"
        description="How many sections a building hosts each hour. In 3D, each tower is a building-hour on the Illini-orange energy ramp; freed hours drop to a flat ice-blue pad. Drag to orbit, scroll to zoom, click a tower for its detail."
      />

      <div className="flex flex-col gap-4 p-4 md:p-6">
        {/* Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {view !== 'map' ? (
            <div className="flex items-center gap-1 overflow-x-auto rounded-md bg-[var(--c3-style-basic-bg-secondary)] p-1">
              {WEEKDAYS.map(({ day: d, label }) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDay(d)}
                  className={
                    'rounded px-3 py-1.5 text-sm font-medium transition-colors ' +
                    (day === d
                      ? 'bg-[var(--c3-style-basic-bg-page)] text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground')
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Same campus map as the Overview — scrub the hour, flip Current/Optimized, click a
              building for its detail.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {/* 2D / 3D view toggle */}
            <div className="flex items-center gap-1 rounded-md bg-[var(--c3-style-basic-bg-secondary)] p-1">
              <button
                type="button"
                onClick={() => setView('3d')}
                aria-pressed={view === '3d'}
                className={
                  'flex items-center gap-1 rounded px-2.5 py-1.5 text-sm font-medium transition-colors ' +
                  (view === '3d'
                    ? 'bg-[var(--c3-style-basic-bg-page)] text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground')
                }
              >
                <Box className="size-3.5" /> 3D
              </button>
              <button
                type="button"
                onClick={() => setView('2d')}
                aria-pressed={view === '2d'}
                className={
                  'flex items-center gap-1 rounded px-2.5 py-1.5 text-sm font-medium transition-colors ' +
                  (view === '2d'
                    ? 'bg-[var(--c3-style-basic-bg-page)] text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground')
                }
              >
                <Grid3x3 className="size-3.5" /> 2D
              </button>
              <button
                type="button"
                onClick={() => setView('map')}
                aria-pressed={view === 'map'}
                className={
                  'flex items-center gap-1 rounded px-2.5 py-1.5 text-sm font-medium transition-colors ' +
                  (view === 'map'
                    ? 'bg-[var(--c3-style-basic-bg-page)] text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground')
                }
              >
                <MapIcon className="size-3.5" /> On map
              </button>
            </div>

            {view !== 'map' ? (
              <div className="flex items-center gap-2">
                <Button
                  variant={scenario === 'current' ? 'solid' : 'outline'}
                  appearance={scenario === 'current' ? 'accent' : 'secondary'}
                  size="sm"
                  onClick={() => setScenario('current')}
                >
                  Current
                </Button>
                <Button
                  variant={scenario === 'optimized' ? 'solid' : 'outline'}
                  appearance={scenario === 'optimized' ? 'success' : 'secondary'}
                  size="sm"
                  onClick={() => setScenario('optimized')}
                >
                  Optimized
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        {/* Sort control — only meaningful for the 3D skyline's building axis */}
        {view === '3d' ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="eyebrow text-[var(--mono-ink-faint)]">Order buildings</span>
            {([
              ['busy', 'Busiest'],
              ['empty', 'Emptiest'],
              ['az', 'A–Z'],
            ] as [SortMode, string][]).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className="io-chip"
                data-active={sort === key}
                onClick={() => setSort(key)}
              >
                {label}
              </button>
            ))}
            <span className="ml-auto text-[var(--mono-ink-2)]">
              Top {Math.min(TOP_N, skyline.buildings.length)} of {fmtInt(rows.length)}
            </span>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-md bg-[var(--c3-style-basic-bg-danger)] px-4 py-3 text-sm text-[var(--c3-style-basic-fg-danger)]">
            {error}
          </div>
        ) : null}

        {view === 'map' ? (
          weekError || geo.error ? (
            <div className="rounded-md bg-[var(--c3-style-basic-bg-danger)] px-4 py-3 text-sm text-[var(--c3-style-basic-fg-danger)]">
              {weekError ?? geo.error}
            </div>
          ) : weekLoading || geo.loading || !week || !geo.data ? (
            <PageLoader
              className="h-[clamp(420px,62vh,760px)]"
              message="Loading campus map…"
              hint="Fetching building footprints and the week's schedule."
            />
          ) : (
            <CampusMapPanel
              week={week}
              geojson={geo.data as FeatureCollection}
              matched={geo.matched}
              centroids={geo.centroids}
              heightClass="h-[clamp(420px,62vh,760px)]"
              initialDay={day}
            />
          )
        ) : loading ? (
          <PageLoader
            className="h-[clamp(420px,62vh,760px)]"
            message="Loading occupancy heatmap…"
            hint="Fetching this day's section counts for every building-hour."
          />
        ) : view === '3d' ? (
          <Card variant="elevated">
            <CardContent className="relative p-0">
              <div className="relative h-[clamp(420px,62vh,760px)] w-full overflow-hidden rounded-[var(--c3-style-border-radius-8)]">
                <Skyline3D
                  cells={skyline.cells}
                  buildings={skyline.buildings}
                  hours={HOURS}
                  maxSections={maxOcc}
                  onHover={setTip}
                  onSelect={(b) => navigate(`/heatmap/${encodeURIComponent(b)}`)}
                />
                {/* corner brackets */}
                <span className="hud-corner hud-corner--tl" aria-hidden />
                <span className="hud-corner hud-corner--tr" aria-hidden />
                <span className="hud-corner hud-corner--bl" aria-hidden />
                <span className="hud-corner hud-corner--br" aria-hidden />

                {tip ? (
                  <div
                    className="pointer-events-none absolute z-10 max-w-[220px] rounded-[var(--c3-style-border-radius-4)] border border-[var(--mono-hairline-strong)] bg-[rgba(10,10,11,0.92)] px-3 py-2 text-xs shadow-[var(--c3-style-shadow-default-lg)]"
                    style={{ left: Math.min(tip.x + 14, 9999), top: tip.y + 14 }}
                  >
                    <div className="font-medium text-[var(--mono-ink)]">{tip.cell.building}</div>
                    <div className="mono mt-1 text-[var(--mono-ink-2)]">
                      {hourLabelLong(tip.cell.hour)} ·{' '}
                      {tip.cell.freed ? (
                        <span className="text-[var(--powered-down)]">powered down</span>
                      ) : (
                        <span className="text-[var(--energy-on)]">
                          {fmtInt(tip.cell.sections)} section{tip.cell.sections === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                  </div>
                ) : null}

                {/* colour legend */}
                <div className="pointer-events-none absolute right-4 top-4 space-y-1.5 rounded-[var(--c3-style-border-radius-4)] border border-[var(--mono-hairline)] bg-[rgba(10,10,11,0.72)] px-3 py-2 text-[11px]">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-16 rounded-sm"
                      style={{
                        background: 'linear-gradient(90deg, #5a2206 0%, #ff5f05 55%, #ffb37a 100%)',
                      }}
                    />
                    <span className="text-[var(--mono-ink-2)]">more sections →</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block size-2.5 rounded-sm bg-[var(--powered-down)]" />
                    <span className="text-[var(--mono-ink-2)]">powered down (freed)</span>
                  </div>
                </div>

                {/* pinned hover readout */}
                <div className="pointer-events-none absolute bottom-4 left-4 max-w-[260px] text-[11px] leading-tight">
                  {tip ? (
                    <>
                      <div className="mono truncate text-[var(--mono-ink)]">
                        {tip.cell.building}
                      </div>
                      <div className="mono text-[var(--mono-ink-2)]">
                        {hourLabelLong(tip.cell.hour)} ·{' '}
                        {tip.cell.freed
                          ? 'powered down by optimizer'
                          : `${fmtInt(tip.cell.sections)} section${tip.cell.sections === 1 ? '' : 's'}`}
                      </div>
                    </>
                  ) : (
                    <div className="mono text-[var(--mono-ink-faint)]">
                      Hover a tower for its building &amp; hour
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card variant="elevated">
            {isMobile ? (
              <p className="px-4 pt-3 text-xs text-muted-foreground">
                Scroll sideways to see all hours · tap a building for its detail.
              </p>
            ) : null}
            <CardContent className="overflow-auto p-0">
              <div className="max-h-[58vh] overflow-auto md:max-h-[70vh]">
                <table className="w-full border-separate border-spacing-0 text-[11px] md:text-xs">
                  <thead className="sticky top-0 z-10 bg-[var(--c3-style-basic-bg-page)]">
                    <tr>
                      <th className="sticky left-0 z-20 bg-[var(--c3-style-basic-bg-page)] px-2 py-2 text-left font-medium text-muted-foreground md:px-3">
                        Building
                      </th>
                      {HOURS.map((h) => (
                        <th
                          key={h}
                          className="px-1 py-2 text-center font-medium text-muted-foreground"
                        >
                          {hourLabel(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="group">
                        <th
                          scope="row"
                          className="sticky left-0 z-10 max-w-[108px] bg-[var(--c3-style-basic-bg-page)] px-2 py-1 text-left font-normal text-foreground group-hover:bg-[var(--c3-style-basic-bg-secondary)] md:max-w-[220px] md:px-3"
                        >
                          <button
                            type="button"
                            onClick={() => navigate(`/heatmap/${encodeURIComponent(row.id)}`)}
                            className="block max-w-[96px] truncate text-left hover:text-[var(--c3-style-basic-fg-accent)] hover:underline md:max-w-[200px]"
                            title={row.id}
                          >
                            {row.id}
                          </button>
                        </th>
                        {HOURS.map((h) => {
                          const cell = row.byHour[h];
                          const count = cell ? cell[scenario] : 0;
                          return (
                            <td key={h} className="p-[1px]">
                              <div
                                className="flex h-5 min-w-[20px] items-center justify-center rounded-sm tabular-nums md:h-6 md:min-w-[26px]"
                                style={{
                                  backgroundColor: occupancyColor(count, maxOcc),
                                  color: occupancyTextColor(count, maxOcc),
                                }}
                                title={`${row.id} · ${hourLabel(h)} · ${fmtInt(count)} section${count === 1 ? '' : 's'}`}
                              >
                                {count > 0 ? count : ''}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {view !== 'map' ? (
          <p className="text-xs text-muted-foreground">
            Showing {fmtInt(rows.length)} buildings · {dayLabel} ·{' '}
            {scenario === 'current' ? 'current schedule' : 'optimized schedule'}.
          </p>
        ) : null}
      </div>
    </div>
  );
}
