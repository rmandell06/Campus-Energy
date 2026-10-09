import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lightbulb, Clock, Building2, DoorOpen, Leaf, MapPin, X } from 'lucide-react';

import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalSubtitle,
  ModalBody,
  ModalFooter,
  ModalFooterActions,
  ModalClose,
} from '@/components/ui/modal';
import {
  MetricCard,
  MetricCardHeader,
  MetricCardLabel,
  MetricCardValue,
  MetricCardCaption,
} from '@/components/ui/metric-card';
import { useErrorBoundary } from '@/components/ErrorBoundary/ErrorBoundary';
import CampusMap3D from '@/components/CampusMap3D/CampusMap3D';
import { useCampusGeojson } from '@/hooks/useCampusGeojson';
import { centroidBounds } from '@/shared/campusModel';
import { fetchStudySpots } from '@/shared/energyApi';
import { WEEKDAYS, HOURS, hourLabelLong, fmtInt } from '@/shared/format';
import type { StudySpot } from '@/Interfaces';

type Scenario = 'optimized' | 'current';

const MAX_RENDERED = 60;

export default function StudySpots() {
  const navigate = useNavigate();
  const { reportError } = useErrorBoundary();
  const geo = useCampusGeojson();

  const [day, setDay] = useState('M');
  const [hour, setHour] = useState(12);
  const [scenario, setScenario] = useState<Scenario>('optimized');
  const [spots, setSpots] = useState<StudySpot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Map ↔ list linkage.
  const [selectedBuilding, setSelectedBuilding] = useState<string | null>(null);
  const [hoverBuilding, setHoverBuilding] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<[number, number] | null>(null);
  // Building clicked on the map → open-rooms popup.
  const [popupBuilding, setPopupBuilding] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedBuilding(null);
    fetchStudySpots(day, hour, scenario)
      .then((res) => {
        if (!cancelled) setSpots(res);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load study spots.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [day, hour, scenario]);

  const summary = useMemo(() => {
    const buildings = new Set(spots.map((s) => s.building));
    const quietest = spots.length
      ? spots.reduce((m, s) => Math.min(m, s.buildingSections), Infinity)
      : 0;
    return {
      spotCount: spots.length,
      buildingCount: buildings.size,
      quietest: Number.isFinite(quietest) ? quietest : 0,
    };
  }, [spots]);

  // Free-room count per building + the busiest, for the ice-blue map ramp.
  const { freeByBuilding, maxFree, spotsByBuilding } = useMemo(() => {
    const by = new Map<string, StudySpot[]>();
    const counts: Record<string, number> = {};
    for (const s of spots) {
      const list = by.get(s.building) ?? [];
      list.push(s);
      by.set(s.building, list);
    }
    let mx = 1;
    for (const [b, list] of by) {
      counts[b] = list.length;
      mx = Math.max(mx, list.length);
    }
    return { freeByBuilding: counts, maxFree: mx, spotsByBuilding: by };
  }, [spots]);

  const bounds = useMemo(() => centroidBounds(geo.centroids), [geo.centroids]);

  // Map labels: buildings with the most open rooms, priority-ordered.
  const mapLabels = useMemo(
    () =>
      Object.keys(freeByBuilding)
        .filter((n) => geo.centroids[n])
        .sort((a, b) => freeByBuilding[b] - freeByBuilding[a])
        .slice(0, 15)
        .map((n) => ({ name: n, position: geo.centroids[n] })),
    [freeByBuilding, geo.centroids],
  );

  const focusOnMap = (building: string) => {
    setSelectedBuilding(building);
    const c = geo.centroids[building];
    if (c) setFlyTo([c[0], c[1]]);
  };

  // Clicking a building on the map opens a popup of its open rooms.
  const openPopup = (building: string) => {
    setPopupBuilding(building);
    const c = geo.centroids[building];
    if (c) setFlyTo([c[0], c[1]]);
  };

  const popupSpots = popupBuilding ? spotsByBuilding.get(popupBuilding) ?? [] : [];

  const visible = useMemo(() => {
    const list = selectedBuilding
      ? spots.filter((s) => s.building === selectedBuilding)
      : spots;
    return list.slice(0, MAX_RENDERED);
  }, [spots, selectedBuilding]);

  const dayLabel = WEEKDAYS.find((w) => w.day === day)?.label ?? day;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Study spots"
        description="Open, class-free rooms you can use right now — only in buildings that are already lit and heated/cooled this hour, so studying here adds no extra energy and never wakes a building the optimizer left dark."
      />

      <div className="flex flex-col gap-4 p-4 md:p-6">
        {/* Energy-neutral explainer */}
        <div className="flex items-start gap-3 rounded-md border border-[var(--c3-style-basic-border-success)] bg-[var(--c3-style-basic-bg-success)] px-4 py-3">
          <Leaf className="mt-0.5 size-5 shrink-0 text-[var(--c3-style-basic-fg-success)]" aria-hidden />
          <p className="text-sm text-[var(--c3-style-basic-fg-success)]">
            Every spot below sits in a building that is <strong>already running</strong> this hour.
            Using an empty room there is <strong>energy-neutral</strong> — the lights and HVAC are on
            regardless. Rooms in buildings the optimizer powers down are deliberately excluded.
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-4">
            {/* Day */}
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

            {/* Hour */}
            <div className="flex flex-col gap-1">
              <label htmlFor="study-hour" className="text-xs font-medium text-muted-foreground">
                Hour
              </label>
              <select
                id="study-hour"
                value={hour}
                onChange={(e) => setHour(Number(e.target.value))}
                className="rounded-md border border-border bg-[var(--c3-style-basic-bg-page)] px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/35"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hourLabelLong(h)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Scenario */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">&quot;Already on&quot; based on</span>
            <div className="flex items-center gap-2">
              <Button
                variant={scenario === 'optimized' ? 'solid' : 'outline'}
                appearance={scenario === 'optimized' ? 'success' : 'secondary'}
                size="sm"
                onClick={() => setScenario('optimized')}
              >
                Optimized plan
              </Button>
              <Button
                variant={scenario === 'current' ? 'solid' : 'outline'}
                appearance={scenario === 'current' ? 'accent' : 'secondary'}
                size="sm"
                onClick={() => setScenario('current')}
              >
                Current schedule
              </Button>
            </div>
          </div>
        </div>

        {/* Shared 3D campus map — study mode (ice-blue by free-room count) */}
        {geo.error ? null : (
          <Card variant="elevated">
            <CardContent className="relative p-0">
              <div className="relative h-[clamp(380px,52vh,620px)] w-full overflow-hidden rounded-[var(--c3-style-border-radius-8)]">
                {geo.loading || !geo.data ? (
                  <div className="flex h-full items-center justify-center">
                    <Spinner />
                  </div>
                ) : (
                  <>
                    <CampusMap3D
                      geojson={geo.data}
                      mode="study"
                      stateByBuilding={{}}
                      maxSections={1}
                      studyByBuilding={freeByBuilding}
                      maxFree={maxFree}
                      labels={mapLabels}
                      focusLabel={hoverBuilding ?? popupBuilding ?? selectedBuilding}
                      bounds={bounds}
                      flyTo={flyTo}
                      onHover={(name) => setHoverBuilding(name)}
                      onSelect={openPopup}
                    />

                    {/* corner brackets */}
                    <span className="hud-corner hud-corner--tl" aria-hidden />
                    <span className="hud-corner hud-corner--tr" aria-hidden />
                    <span className="hud-corner hud-corner--bl" aria-hidden />
                    <span className="hud-corner hud-corner--br" aria-hidden />

                    {/* legend */}
                    <div className="pointer-events-none absolute right-4 top-4 space-y-1.5 rounded-[var(--c3-style-border-radius-4)] border border-[var(--mono-hairline)] bg-[rgba(10,10,11,0.72)] px-3 py-2 text-[11px]">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-16 rounded-sm"
                          style={{
                            background:
                              'linear-gradient(90deg, #1b394d 0%, #3f93d6 55%, #6ec1ff 100%)',
                          }}
                        />
                        <span className="text-[var(--mono-ink-2)]">more open rooms →</span>
                      </div>
                      <div className="text-[var(--mono-ink-faint)]">
                        only buildings already energy-on this hour
                      </div>
                    </div>

                    {/* pinned readout */}
                    <div className="pointer-events-none absolute bottom-4 left-4 max-w-[260px] text-[11px] leading-tight">
                      {hoverBuilding || selectedBuilding ? (
                        <>
                          <div className="mono truncate text-[var(--mono-ink)]">
                            {hoverBuilding ?? selectedBuilding}
                          </div>
                          <div className="mono text-[var(--powered-down)]">
                            {fmtInt(freeByBuilding[(hoverBuilding ?? selectedBuilding) as string] ?? 0)}{' '}
                            open room
                            {(freeByBuilding[(hoverBuilding ?? selectedBuilding) as string] ?? 0) === 1
                              ? ''
                              : 's'}
                          </div>
                        </>
                      ) : (
                        <div className="mono text-[var(--mono-ink-faint)]">
                          Click a building to see its open rooms
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary tiles */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <MetricCard variant="outlined">
            <MetricCardHeader>
              <MetricCardLabel>Open study spots</MetricCardLabel>
            </MetricCardHeader>
            <MetricCardValue>{fmtInt(summary.spotCount)}</MetricCardValue>
            <MetricCardCaption>
              {dayLabel} · {hourLabelLong(hour)}
            </MetricCardCaption>
          </MetricCard>
          <MetricCard variant="outlined">
            <MetricCardHeader>
              <MetricCardLabel>Across buildings</MetricCardLabel>
            </MetricCardHeader>
            <MetricCardValue>{fmtInt(summary.buildingCount)}</MetricCardValue>
            <MetricCardCaption>all already energy-on</MetricCardCaption>
          </MetricCard>
          <MetricCard variant="outlined" className="col-span-2 md:col-span-1">
            <MetricCardHeader>
              <MetricCardLabel>Quietest building</MetricCardLabel>
            </MetricCardHeader>
            <MetricCardValue>
              {summary.quietest} {summary.quietest === 1 ? 'class' : 'classes'}
            </MetricCardValue>
            <MetricCardCaption>fewest classes while still occupied</MetricCardCaption>
          </MetricCard>
        </div>

        {/* Selected-building filter chip */}
        {selectedBuilding ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Showing open rooms in</span>
            <span className="font-medium text-foreground">{selectedBuilding}</span>
            <span className="text-xs text-muted-foreground">
              ({fmtInt(spotsByBuilding.get(selectedBuilding)?.length ?? 0)})
            </span>
            <button
              type="button"
              onClick={() => setSelectedBuilding(null)}
              className="io-chip ml-1"
            >
              <X className="size-3" />
              Clear
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-md bg-[var(--c3-style-basic-bg-danger)] px-4 py-3 text-sm text-[var(--c3-style-basic-fg-danger)]">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner />
          </div>
        ) : spots.length === 0 ? (
          <Card variant="elevated">
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <Lightbulb className="size-6 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium text-foreground">
                No energy-neutral study spots for {dayLabel} at {hourLabelLong(hour)}.
              </p>
              <p className="max-w-md text-xs text-muted-foreground">
                Either no buildings are occupied this hour, or every occupied building is fully
                booked. Try another hour or weekday.
              </p>
            </CardContent>
          </Card>
        ) : visible.length === 0 ? (
          <Card variant="elevated">
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <Lightbulb className="size-6 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium text-foreground">
                No open rooms in {selectedBuilding} at {hourLabelLong(hour)}.
              </p>
              <button
                type="button"
                onClick={() => setSelectedBuilding(null)}
                className="io-chip"
              >
                Show all buildings
              </button>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((s) => {
                try {
                  const active =
                    (hoverBuilding ?? selectedBuilding) === s.building;
                  return (
                    <Card
                      key={s.roomId}
                      variant="elevated"
                      className={
                        'transition-shadow ' +
                        (active
                          ? 'ring-1 ring-[var(--powered-down)] shadow-[var(--c3-style-shadow-default-lg)]'
                          : '')
                      }
                      onMouseEnter={() => setHoverBuilding(s.building)}
                      onMouseLeave={() => setHoverBuilding(null)}
                    >
                      <CardContent className="flex flex-col gap-3 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <DoorOpen
                              className="size-4 shrink-0 text-[var(--c3-style-basic-fg-success)]"
                              aria-hidden
                            />
                            <span className="text-sm font-semibold text-foreground">
                              Room {s.roomName}
                            </span>
                          </div>
                          <Badge
                            variant="soft"
                            appearance={s.buildingSections <= 2 ? 'success' : 'warning'}
                            size="sm"
                          >
                            {s.buildingSections} {s.buildingSections === 1 ? 'class' : 'classes'} in
                            bldg
                          </Badge>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => navigate(`/heatmap/${encodeURIComponent(s.building)}`)}
                            className="flex min-w-0 items-center gap-1.5 text-left text-xs text-muted-foreground hover:text-[var(--c3-style-basic-fg-accent)] hover:underline"
                            title={`Open ${s.building} detail`}
                          >
                            <Building2 className="size-3.5 shrink-0" aria-hidden />
                            <span className="truncate">{s.building}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => focusOnMap(s.building)}
                            className="io-chip shrink-0"
                            title={`Focus ${s.building} on the map`}
                          >
                            <MapPin className="size-3" />
                            Map
                          </button>
                        </div>

                        <div className="flex items-center gap-1.5 text-xs text-foreground">
                          <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          <span>
                            {s.freeUntilLabel}
                            <span className="text-muted-foreground">
                              {' '}
                              · {s.freeHours}h open
                            </span>
                          </span>
                        </div>

                        {s.roomTypes.length ? (
                          <div className="flex flex-wrap gap-1">
                            {s.roomTypes.slice(0, 4).map((t) => (
                              <Badge key={t} variant="outline" appearance="secondary" size="sm">
                                {t}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>
                  );
                } catch (err) {
                  reportError(err);
                  return null;
                }
              })}
            </div>

            {!selectedBuilding && spots.length > MAX_RENDERED ? (
              <p className="text-xs text-muted-foreground">
                Showing the top {MAX_RENDERED} of {fmtInt(spots.length)} spots (quietest buildings
                first). Pick a busier hour or click a building on the map to narrow the list.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {fmtInt(visible.length)} spot{visible.length === 1 ? '' : 's'}
                {selectedBuilding ? ` in ${selectedBuilding}` : ' · ranked by quietest occupied building'}.
              </p>
            )}
          </>
        )}
      </div>

      {/* Open-rooms popup — opens when a building is clicked on the map */}
      <Modal
        open={!!popupBuilding}
        onOpenChange={(o) => {
          if (!o) setPopupBuilding(null);
        }}
      >
        <ModalContent contentWidth="full" footerMode="fixed" width={460}>
          <ModalHeader>
            <ModalTitle>{popupBuilding}</ModalTitle>
            <ModalSubtitle>
              {popupSpots.length
                ? `${fmtInt(popupSpots.length)} open room${popupSpots.length === 1 ? '' : 's'} · ${dayLabel} ${hourLabelLong(hour)}`
                : `No open rooms · ${dayLabel} ${hourLabelLong(hour)}`}
            </ModalSubtitle>
          </ModalHeader>
          <ModalBody className="max-h-[52vh] overflow-auto px-6 py-2">
            {popupSpots.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Lightbulb className="size-6 text-muted-foreground" aria-hidden />
                <p className="text-sm text-foreground">
                  No class-free rooms in {popupBuilding} at {hourLabelLong(hour)}.
                </p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  This building is energy-on but fully booked this hour. Try another hour.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-2 py-1">
                {popupSpots.map((s) => (
                  <li
                    key={s.roomId}
                    className="rounded-[var(--c3-style-border-radius-6)] border border-[var(--c3-style-basic-border-border)] p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <DoorOpen
                          className="size-4 shrink-0 text-[var(--c3-style-basic-fg-success)]"
                          aria-hidden
                        />
                        <span className="text-sm font-semibold text-foreground">
                          Room {s.roomName}
                        </span>
                      </div>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="size-3.5 shrink-0" aria-hidden />
                        {s.freeUntilLabel} · {s.freeHours}h
                      </span>
                    </div>
                    {s.roomTypes.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {s.roomTypes.slice(0, 5).map((t) => (
                          <Badge key={t} variant="outline" appearance="secondary" size="sm">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </ModalBody>
          <ModalFooter>
            <ModalFooterActions>
              {popupBuilding ? (
                <Button
                  variant="outline"
                  appearance="secondary"
                  onClick={() => {
                    const b = popupBuilding;
                    setPopupBuilding(null);
                    navigate(`/heatmap/${encodeURIComponent(b)}`);
                  }}
                >
                  <Building2 className="size-4" />
                  Building detail
                </Button>
              ) : null}
              <ModalClose asChild>
                <Button variant="solid" appearance="accent">
                  Close
                </Button>
              </ModalClose>
            </ModalFooterActions>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
