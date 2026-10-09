import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, X, Search, Zap } from 'lucide-react';
import type { FeatureCollection } from 'geojson';
import CampusMap3D, { MapBuildingState, ArcHoverInfo } from './CampusMap3D';
import {
  CampusWeek,
  Scenario,
  Centroids,
  stateForHour,
  hourCounts,
  buildingsNotOnMap,
  buildMoveArcs,
  poweredDownAt,
  centroidBounds,
} from '@/shared/campusModel';
import { WEEKDAYS, hourLabel, hourLabelLong, occupancyColor, fmtInt } from '@/shared/format';
import { fetchMoves, fetchMovesFromBuilding, fetchAssumptions } from '@/shared/energyApi';
import type { MoveRecommendation, SavingsAssumptionsRec } from '@/Interfaces';

const MAP_HOURS: number[] = Array.from({ length: 16 }, (_, i) => i + 7); // 7am..10pm

interface Props {
  week: CampusWeek;
  geojson: FeatureCollection;
  matched: Set<string>;
  centroids: Centroids;
  /** Tailwind height class for the map stage, e.g. "h-[60vh]". */
  heightClass?: string;
  /** Optional deep-link focus (Assistant "show on map"). */
  initialDay?: string;
  initialHour?: number;
  focusBuilding?: string | null;
  /** Change to run a cinematic "play the day" (7am→10pm, then flip Optimized). */
  playNonce?: number;
  onCinematicEnd?: () => void;
}

interface Tip {
  x: number;
  y: number;
  name: string;
  state?: MapBuildingState;
}

export default function CampusMapPanel({
  week,
  geojson,
  matched,
  centroids,
  heightClass = 'h-[60vh]',
  initialDay,
  initialHour,
  focusBuilding,
  playNonce,
  onCinematicEnd,
}: Props) {
  const [day, setDay] = useState(initialDay ?? 'M');
  const [hour, setHour] = useState(initialHour ?? 10);
  const [scenario, setScenario] = useState<Scenario>('optimized');
  const [playing, setPlaying] = useState(false);
  const [cinematic, setCinematic] = useState(false);
  const [showFlows, setShowFlows] = useState(true);
  const [tip, setTip] = useState<Tip | null>(null);
  const [arcTip, setArcTip] = useState<ArcHoverInfo | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [selMoves, setSelMoves] = useState<MoveRecommendation[]>([]);
  const [assumptions, setAssumptions] = useState<SavingsAssumptionsRec | null>(null);
  const [moves, setMoves] = useState<MoveRecommendation[]>([]);
  const [query, setQuery] = useState('');
  const [flyTo, setFlyTo] = useState<[number, number] | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchAssumptions()
      .then(setAssumptions)
      .catch(() => setAssumptions(null));
    fetchMoves()
      .then(setMoves)
      .catch(() => setMoves([]));
  }, []);

  // Deep-link: fly to a requested building + open its drawer once data is ready.
  useEffect(() => {
    if (focusBuilding && centroids[focusBuilding]) {
      setFlyTo(centroids[focusBuilding]);
      setSelected(focusBuilding);
      fetchMovesFromBuilding(focusBuilding)
        .then(setSelMoves)
        .catch(() => setSelMoves([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusBuilding]);

  // Cinematic "Play the day": restart from 7am in the current schedule, then let
  // the interval below flip to Optimized once it reaches the end of the window.
  useEffect(() => {
    if (!playNonce) return;
    setScenario('current');
    setHour(MAP_HOURS[0]);
    setCinematic(true);
    setPlaying(true);
  }, [playNonce]);

  // Playback: advance the hour on a timer. A plain play loops; a cinematic run
  // stops at 10pm, flips to the Optimized scenario, and fires onCinematicEnd.
  useEffect(() => {
    if (!playing) return;
    const last = MAP_HOURS[MAP_HOURS.length - 1];
    const id = window.setInterval(() => {
      setHour((h) => {
        if (h >= last) {
          if (cinematic) {
            setPlaying(false);
            setCinematic(false);
            setScenario('optimized');
            onCinematicEnd?.();
            return last;
          }
          return MAP_HOURS[0];
        }
        return h + 1;
      });
    }, 900);
    return () => window.clearInterval(id);
  }, [playing, cinematic, onCinematicEnd]);

  const stateByBuilding = useMemo(
    () => stateForHour(week, day, hour, scenario),
    [week, day, hour, scenario],
  );

  const counts = useMemo(() => hourCounts(stateByBuilding), [stateByBuilding]);
  const optimizedSlice = useMemo(
    () => stateForHour(week, day, hour, 'optimized'),
    [week, day, hour],
  );
  const freedNow = useMemo(() => hourCounts(optimizedSlice).freed, [optimizedSlice]);
  const kwPerFreed = assumptions?.kwhPerFreedHourMid ?? 0;
  const setbackKw = Math.round(freedNow * kwPerFreed);

  // Energy-flow overlay — arcs + pulses only in the Optimized scenario.
  const arcs = useMemo(
    () => (scenario === 'optimized' ? buildMoveArcs(moves, centroids, day, hour) : []),
    [scenario, moves, centroids, day, hour],
  );
  const pulses = useMemo(
    () => (scenario === 'optimized' ? poweredDownAt(week, centroids, day, hour) : []),
    [scenario, week, centroids, day, hour],
  );

  const bounds = useMemo(() => centroidBounds(centroids), [centroids]);
  const labels = useMemo(
    () =>
      week.buildingNames
        .filter((n) => centroids[n])
        .sort((a, b) => (week.sectionsPerWeek.get(b) ?? 0) - (week.sectionsPerWeek.get(a) ?? 0))
        .slice(0, 15)
        .map((n) => ({ name: n, position: centroids[n] })),
    [week.buildingNames, week.sectionsPerWeek, centroids],
  );

  const notOnMap = useMemo(
    () => buildingsNotOnMap(week.buildingNames, matched),
    [week.buildingNames, matched],
  );

  const searchMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return week.buildingNames
      .filter((n) => centroids[n] && n.toLowerCase().includes(q))
      .slice(0, 6);
  }, [query, week.buildingNames, centroids]);

  const handleHover = useCallback((name: string | null, state?: MapBuildingState) => {
    if (!name) {
      setTip(null);
      return;
    }
    setTip((prev) => ({ x: prev?.x ?? 0, y: prev?.y ?? 0, name, state }));
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setTip((prev) => (prev ? { ...prev, x, y } : prev));
  }, []);

  const handleSelect = useCallback((name: string) => {
    setSelected(name);
    fetchMovesFromBuilding(name)
      .then(setSelMoves)
      .catch(() => setSelMoves([]));
  }, []);

  const flyToBuilding = (name: string) => {
    const c = centroids[name];
    if (c) setFlyTo([c[0], c[1]]);
    setQuery('');
  };

  const dayLabel = WEEKDAYS.find((w) => w.day === day)?.label ?? day;

  return (
    <div className="panel relative overflow-hidden rounded-[var(--c3-style-border-radius-8)]">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-[var(--mono-hairline)] px-4 py-3">
        <div className="flex items-center gap-1" role="group" aria-label="Weekday">
          {WEEKDAYS.map((w) => (
            <button
              key={w.day}
              type="button"
              onClick={() => setDay(w.day)}
              className={`rounded-[var(--c3-style-border-radius-4)] px-2.5 py-1 text-xs font-medium transition-colors ${
                day === w.day
                  ? 'bg-[var(--c3-style-basic-bg-accent)] text-[var(--c3-style-basic-fg-primary)]'
                  : 'text-[var(--mono-ink-2)] hover:text-[var(--mono-ink)]'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>

        <div className="flex min-w-[220px] flex-1 items-center gap-3">
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? 'Pause' : 'Play'}
            className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[var(--mono-hairline-strong)] text-[var(--mono-ink)] hover:bg-[var(--c3-style-basic-bg-accent)]"
          >
            {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </button>
          <label htmlFor="map-hour" className="sr-only">
            Hour of day
          </label>
          <input
            id="map-hour"
            type="range"
            className="io-range flex-1"
            min={MAP_HOURS[0]}
            max={MAP_HOURS[MAP_HOURS.length - 1]}
            step={1}
            value={hour}
            onChange={(e) => setHour(Number(e.target.value))}
          />
          <span className="mono w-14 shrink-0 text-right text-xs text-[var(--mono-ink)]">
            {hourLabelLong(hour)}
          </span>
        </div>

        {/* Search / fly-to */}
        <div className="relative w-full sm:w-52">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--mono-ink-2)]" />
          <label htmlFor="map-search" className="sr-only">
            Search buildings
          </label>
          <input
            id="map-search"
            className="map-search-input"
            placeholder="Search buildings…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && searchMatches[0]) flyToBuilding(searchMatches[0]);
            }}
          />
          {searchMatches.length > 0 ? (
            <div className="absolute left-0 right-0 top-9 z-30 overflow-hidden rounded-[var(--c3-style-border-radius-4)] border border-[var(--mono-hairline-strong)] bg-[var(--c3-style-basic-bg-overlay)] shadow-[var(--c3-style-shadow-default-lg)]">
              {searchMatches.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => flyToBuilding(n)}
                  className="block w-full truncate px-3 py-1.5 text-left text-xs text-[var(--mono-ink)] hover:bg-[var(--c3-style-basic-bg-hover)]"
                >
                  {n}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {/* Flows toggle */}
          <button
            type="button"
            className="io-chip"
            data-active={showFlows && scenario === 'optimized'}
            onClick={() => setShowFlows((f) => !f)}
            title="Energy-flow arcs (Optimized mode)"
          >
            <Zap className="size-3" />
            Flows
          </button>

          <div className="flex items-center gap-1" role="group" aria-label="Scenario">
            {(['current', 'optimized'] as Scenario[]).map((sc) => (
              <button
                key={sc}
                type="button"
                onClick={() => setScenario(sc)}
                className={`rounded-[var(--c3-style-border-radius-4)] border px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  scenario === sc
                    ? sc === 'optimized'
                      ? 'border-[var(--powered-down)] text-[var(--powered-down)]'
                      : 'border-[var(--energy-on)] text-[var(--energy-on)]'
                    : 'border-transparent text-[var(--mono-ink-2)] hover:text-[var(--mono-ink)]'
                }`}
              >
                {sc}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Map stage */}
      <div
        ref={stageRef}
        className={`relative w-full ${heightClass}`}
        onMouseMove={handleMouseMove}
      >
        <CampusMap3D
          geojson={geojson}
          stateByBuilding={stateByBuilding}
          maxSections={week.maxPerHour}
          arcs={arcs}
          pulses={pulses}
          showFlows={showFlows}
          labels={labels}
          focusLabel={tip?.name ?? selected}
          bounds={bounds}
          flyTo={flyTo}
          onHover={handleHover}
          onSelect={handleSelect}
          onArcHover={setArcTip}
        />

        {/* corner brackets */}
        <span className="hud-corner hud-corner--tl" aria-hidden />
        <span className="hud-corner hud-corner--tr" aria-hidden />
        <span className="hud-corner hud-corner--bl" aria-hidden />
        <span className="hud-corner hud-corner--br" aria-hidden />

        {/* top-left mission-control readout */}
        <div className="pointer-events-none absolute left-4 top-4 space-y-1 text-[11px] leading-tight">
          <div className="mono text-[var(--mono-ink)]">
            {dayLabel.toUpperCase()} · {hourLabel(hour).toUpperCase()}
          </div>
          <div className="mono text-[var(--energy-on)]">{fmtInt(counts.running)} running</div>
          <div className="mono text-[var(--mono-ink-2)]">{fmtInt(counts.dark)} dark</div>
          <div className="mono text-[var(--powered-down)]">{fmtInt(setbackKw)} kW setback now</div>
        </div>

        {/* bottom-left legend */}
        <div className="pointer-events-none absolute bottom-4 left-4 space-y-1 text-[11px]">
          <LegendRow color="var(--energy-on)" label="Energy on (brighter = busier)" />
          <LegendRow color="var(--powered-down)" label="Powered down by optimizer" />
          <LegendRow color="#3a3a42" label="Scheduled, empty this hour" />
          <LegendRow color="#1c1c20" label="Other campus building" />
        </div>

        {/* hover tooltip (building) */}
        {tip ? (
          <div
            className="pointer-events-none absolute z-10 max-w-[220px] rounded-[var(--c3-style-border-radius-4)] border border-[var(--mono-hairline-strong)] bg-[rgba(10,10,11,0.92)] px-3 py-2 text-xs shadow-[var(--c3-style-shadow-default-lg)]"
            style={{ left: Math.min(tip.x + 14, 9999), top: tip.y + 14 }}
          >
            <div className="font-medium text-[var(--mono-ink)]">{tip.name}</div>
            <div className="mono mt-1 text-[var(--mono-ink-2)]">
              {fmtInt(tip.state?.sections ?? 0)} sections · {hourLabelLong(hour)}
            </div>
            <div className="mono text-[var(--mono-ink-2)]">
              {tip.state?.freed
                ? 'powered down'
                : (tip.state?.sections ?? 0) > 0
                  ? 'running'
                  : 'dark'}
            </div>
          </div>
        ) : null}

        {/* hover tooltip (arc / energy flow) */}
        {arcTip ? (
          <div
            className="pointer-events-none absolute z-10 max-w-[240px] rounded-[var(--c3-style-border-radius-4)] border border-[var(--powered-down)] bg-[rgba(10,10,11,0.94)] px-3 py-2 text-xs shadow-[var(--c3-style-shadow-default-lg)]"
            style={{ left: Math.min(arcTip.x + 14, 9999), top: arcTip.y + 14 }}
          >
            <div className="eyebrow text-[var(--mono-ink-faint)]">Course section</div>
            <div className="font-medium text-[var(--mono-ink)]">{arcTip.courseLabel}</div>
            <div className="mono mt-1 flex items-center gap-1 text-[var(--mono-ink-2)]">
              <span className="text-[var(--energy-on)]">{arcTip.from}</span>
              <span>→</span>
              <span className="text-[var(--powered-down)]">{arcTip.to}</span>
            </div>
          </div>
        ) : null}
      </div>

      {/* not-on-map note */}
      {notOnMap.length > 0 ? (
        <div className="border-t border-[var(--mono-hairline)] px-4 py-2 text-[11px] text-[var(--mono-ink-2)]">
          <span className="eyebrow mr-2 text-[var(--mono-ink-faint)]">Not on map</span>
          {notOnMap.length} scheduled {notOnMap.length === 1 ? 'building has' : 'buildings have'} no
          footprint: {notOnMap.slice(0, 6).join(', ')}
          {notOnMap.length > 6 ? ` +${notOnMap.length - 6} more` : ''}
        </div>
      ) : null}

      {/* detail drawer */}
      {selected ? (
        <BuildingDrawer
          week={week}
          name={selected}
          moves={selMoves}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[var(--mono-ink-2)]">
      <span className="inline-block size-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </div>
  );
}

function BuildingDrawer({
  week,
  name,
  moves,
  onClose,
}: {
  week: CampusWeek;
  name: string;
  moves: MoveRecommendation[];
  onClose: () => void;
}) {
  const days = week.byBuilding.get(name);
  const max = week.maxPerHour;

  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-full max-w-sm flex-col border-l border-[var(--mono-hairline-strong)] bg-[var(--c3-style-basic-bg-primary)] shadow-[var(--c3-style-shadow-default-lg)]">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--mono-hairline)] px-4 py-3">
        <div>
          <div className="eyebrow text-[var(--mono-ink-faint)]">Building</div>
          <div className="font-display text-base text-[var(--mono-ink)]">{name}</div>
          <div className="mono mt-0.5 text-xs text-[var(--mono-ink-2)]">
            {fmtInt(week.sectionsPerWeek.get(name) ?? 0)} sections / week
          </div>
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

      <div className="flex-1 overflow-auto px-4 py-4">
        <div className="eyebrow mb-2 text-[var(--mono-ink-faint)]">Weekly occupancy</div>
        <div className="space-y-1">
          {WEEKDAYS.map((w) => {
            const hours = days?.get(w.day);
            return (
              <div key={w.day} className="flex items-center gap-2">
                <span className="mono w-8 shrink-0 text-[11px] text-[var(--mono-ink-2)]">
                  {w.label}
                </span>
                <div className="flex gap-0.5">
                  {MAP_HOURS.map((h) => {
                    const cell = hours?.get(h) ?? { cur: 0, opt: 0 };
                    const freed = cell.cur > 0 && cell.opt === 0;
                    return (
                      <span
                        key={h}
                        title={`${hourLabel(h)} · ${cell.cur} sections`}
                        className="size-3 rounded-[2px]"
                        style={{
                          background: occupancyColor(cell.cur, max),
                          outline: freed ? '1px solid var(--powered-down)' : undefined,
                          outlineOffset: freed ? '-1px' : undefined,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="eyebrow mb-2 mt-5 text-[var(--mono-ink-faint)]">
          Classes relocated out ({moves.length})
        </div>
        {moves.length === 0 ? (
          <p className="text-xs text-[var(--mono-ink-2)]">No moves affect this building.</p>
        ) : (
          <ul className="space-y-2">
            {moves.slice(0, 20).map((m) => (
              <li
                key={m.id}
                className="rounded-[var(--c3-style-border-radius-4)] border border-[var(--mono-hairline)] px-3 py-2 text-xs"
              >
                <div className="font-medium text-[var(--mono-ink)]">{m.courseLabel}</div>
                <div className="mono mt-1 flex flex-wrap items-center gap-1 text-[var(--mono-ink-2)]">
                  <span className="rounded-sm bg-[var(--c3-style-basic-bg-accent)] px-1.5 py-0.5">
                    {m.fromRoom?.building?.id ?? '—'}
                  </span>
                  <span>→</span>
                  <span className="rounded-sm bg-[var(--c3-style-basic-bg-accent)] px-1.5 py-0.5">
                    {m.toRoom?.building?.id ?? '—'}
                  </span>
                  <span className="ml-auto">
                    {m.days} {m.timeLabel}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
