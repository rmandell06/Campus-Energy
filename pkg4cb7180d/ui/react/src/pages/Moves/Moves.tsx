import React, { useEffect, useMemo, useState } from 'react';
import { Check, X, Download, RotateCcw, ArrowRight, MapPin } from 'lucide-react';
import type { FeatureCollection } from 'geojson';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useCampusGeojson } from '@/hooks/useCampusGeojson';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import CampusMap3D, { ArcHoverInfo, MapBuildingState } from '@/components/CampusMap3D/CampusMap3D';
import {
  MetricCard,
  MetricCardHeader,
  MetricCardLabel,
  MetricCardValue,
  MetricCardCaption,
} from '@/components/ui/metric-card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  fetchMoves,
  fetchAssumptions,
  setMoveStatus,
  setMovesStatus,
} from '@/shared/energyApi';
import { computeSavings } from '@/shared/savings';
import { arcsForMoves, centroidBounds, parseDays } from '@/shared/campusModel';
import { fmtInt, fmtMoney, fmtNum, WEEKDAYS } from '@/shared/format';
import type { MoveRecommendation, SavingsAssumptionsRec } from '@/Interfaces';

type StatusFilter = 'all' | 'accepted' | 'rejected';

const EMPTY_STATE: Record<string, MapBuildingState> = {};

export default function Moves() {
  const isMobile = useIsMobile();
  const geo = useCampusGeojson();
  const [moves, setMoves] = useState<MoveRecommendation[]>([]);
  const [assumptions, setAssumptions] = useState<SavingsAssumptionsRec | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [dayFilter, setDayFilter] = useState<string>('all');
  const [buildingFilter, setBuildingFilter] = useState<string>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<[number, number] | null>(null);
  const [arcTip, setArcTip] = useState<ArcHoverInfo | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [mv, a] = await Promise.all([fetchMoves(), fetchAssumptions()]);
      setMoves(mv);
      setAssumptions(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load moves.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const typeCodes = useMemo(() => {
    const set = new Set<string>();
    moves.forEach((m) => m.typeCode && set.add(m.typeCode));
    return Array.from(set).sort();
  }, [moves]);

  // From-buildings ranked by number of moves, for the building filter chips.
  const topBuildings = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of moves) {
      const b = m.fromRoom?.building?.id;
      if (b) counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([b]) => b);
  }, [moves]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return moves.filter((m) => {
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      if (typeFilter !== 'all' && m.typeCode !== typeFilter) return false;
      if (dayFilter !== 'all' && !parseDays(m.days).has(dayFilter)) return false;
      if (buildingFilter !== 'all' && m.fromRoom?.building?.id !== buildingFilter) return false;
      if (q) {
        const hay = `${m.courseLabel} ${m.sectionLabel} ${m.fromRoom?.id ?? ''} ${
          m.toRoom?.id ?? ''
        }`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [moves, search, statusFilter, typeFilter, dayFilter, buildingFilter]);

  // Row selection drives the inset map: if any rows are checked, only those
  // arcs draw; otherwise the map mirrors every filtered row. Rejected moves are
  // reverted, so they never contribute a flow.
  const filteredIds = useMemo(() => filtered.map((m) => m.id), [filtered]);
  const selectedInView = useMemo(
    () => filteredIds.filter((id) => selectedIds.has(id)).length,
    [filteredIds, selectedIds],
  );
  const allSelected = filteredIds.length > 0 && selectedInView === filteredIds.length;

  const toggleRow = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (filteredIds.every((id) => next.has(id))) filteredIds.forEach((id) => next.delete(id));
      else filteredIds.forEach((id) => next.add(id));
      return next;
    });
  const clearSelection = () => setSelectedIds(new Set());

  const activeMoves = useMemo(() => {
    const base = filtered.filter((m) => m.status !== 'rejected');
    return selectedInView > 0 ? base.filter((m) => selectedIds.has(m.id)) : base;
  }, [filtered, selectedIds, selectedInView]);

  const arcs = useMemo(
    () => arcsForMoves(activeMoves, geo.centroids),
    [activeMoves, geo.centroids],
  );
  const bounds = useMemo(() => centroidBounds(geo.centroids), [geo.centroids]);

  const accepted = useMemo(() => moves.filter((m) => m.status === 'accepted'), [moves]);
  const freedHours = useMemo(
    () => accepted.reduce((sum, m) => sum + (m.buildingHoursFreed ?? 0), 0),
    [accepted],
  );
  const savings = useMemo(
    () => (assumptions ? computeSavings(assumptions, freedHours) : null),
    [assumptions, freedHours],
  );

  const flyToMove = (m: MoveRecommendation) => {
    const b = m.fromRoom?.building?.id;
    const c = b ? geo.centroids[b] : undefined;
    if (c) setFlyTo([c[0], c[1]]);
    setHoverId(m.id);
  };

  const updateStatus = async (id: string, status: 'accepted' | 'rejected') => {
    setBusyId(id);
    setMoves((prev) => prev.map((m) => (m.id === id ? { ...m, status } : m)));
    try {
      await setMoveStatus(id, status);
    } catch {
      setMoves((prev) => prev); // keep optimistic; surfaced via reload if needed
    } finally {
      setBusyId(null);
    }
  };

  const bulkSet = async (status: 'accepted' | 'rejected') => {
    const ids = filtered.map((m) => m.id);
    if (!ids.length) return;
    setMoves((prev) =>
      prev.map((m) => (ids.includes(m.id) ? { ...m, status } : m)),
    );
    await setMovesStatus(ids, status);
  };

  const exportCsv = () => {
    const header = [
      'Course',
      'Section',
      'Type',
      'Days',
      'Time',
      'FromRoom',
      'ToRoom',
      'BuildingHoursFreed',
      'Status',
    ];
    const rows = filtered.map((m) => [
      m.courseLabel,
      m.sectionLabel,
      m.typeCode,
      m.days,
      m.timeLabel,
      m.fromRoom?.id ?? '',
      m.toRoom?.id ?? '',
      String(m.buildingHoursFreed ?? 0),
      m.status,
    ]);
    const esc = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'move-recommendations.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const tableCard = (
    <Card variant="elevated">
      <CardContent className="overflow-auto p-0">
        <div className="max-h-[62vh] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-[var(--c3-style-basic-bg-page)]">
              <TableRow>
                <TableHead className="w-8">
                  <input
                    type="checkbox"
                    className="size-4 cursor-pointer align-middle"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all filtered moves"
                  />
                </TableHead>
                <TableHead>Course</TableHead>
                <TableHead>Sec</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Days</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead className="text-right">Freed</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((m) => (
                <TableRow
                  key={m.id}
                  onMouseEnter={() => setHoverId(m.id)}
                  onMouseLeave={() => setHoverId((h) => (h === m.id ? null : h))}
                  className={
                    selectedIds.has(m.id)
                      ? 'bg-[var(--c3-style-basic-bg-secondary)]'
                      : hoverId === m.id
                        ? 'bg-[var(--c3-style-basic-bg-accent)]'
                        : undefined
                  }
                >
                  <TableCell>
                    <input
                      type="checkbox"
                      className="size-4 cursor-pointer align-middle"
                      checked={selectedIds.has(m.id)}
                      onChange={() => toggleRow(m.id)}
                      aria-label={`Select move ${m.courseLabel} ${m.sectionLabel}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{m.courseLabel}</TableCell>
                  <TableCell>{m.sectionLabel}</TableCell>
                  <TableCell>{m.typeCode}</TableCell>
                  <TableCell>{m.days}</TableCell>
                  <TableCell className="whitespace-nowrap">{m.timeLabel}</TableCell>
                  <TableCell className="max-w-[160px] truncate" title={m.fromRoom?.id}>
                    {m.fromRoom?.id}
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate" title={m.toRoom?.id}>
                    {m.toRoom?.id}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtInt(m.buildingHoursFreed)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="soft"
                      appearance={
                        m.status === 'accepted'
                          ? 'success'
                          : m.status === 'rejected'
                            ? 'danger'
                            : 'secondary'
                      }
                    >
                      {m.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        appearance="secondary"
                        size="sm"
                        title="Show on map"
                        onClick={() => flyToMove(m)}
                      >
                        <MapPin className="size-4" />
                      </Button>
                      {m.status === 'accepted' ? (
                        <Button
                          variant="ghost"
                          appearance="danger"
                          size="sm"
                          disabled={busyId === m.id}
                          onClick={() => updateStatus(m.id, 'rejected')}
                        >
                          <X className="size-4" />
                          Reject
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          appearance="success"
                          size="sm"
                          disabled={busyId === m.id}
                          onClick={() => updateStatus(m.id, 'accepted')}
                        >
                          {m.status === 'rejected' ? (
                            <RotateCcw className="size-4" />
                          ) : (
                            <Check className="size-4" />
                          )}
                          Accept
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );

  const miniMap = (
    <div className="panel relative flex h-[62vh] flex-col overflow-hidden rounded-[var(--c3-style-border-radius-8)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--mono-hairline)] px-3 py-2">
        <span className="eyebrow text-[var(--mono-ink-faint)]">
          Energy flow · {fmtInt(arcs.length)} {selectedInView > 0 ? 'selected' : ''} move
          {arcs.length === 1 ? '' : 's'}
        </span>
        {selectedInView > 0 ? (
          <button type="button" className="io-chip" onClick={clearSelection}>
            <X className="size-3" />
            Clear selection
          </button>
        ) : (
          <span className="mono text-[10px] text-[var(--mono-ink-2)]">
            check rows to isolate · hover to highlight
          </span>
        )}
      </div>
      <div className="relative flex-1">
        {geo.loading || !geo.data ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <>
            <CampusMap3D
              geojson={geo.data as FeatureCollection}
              stateByBuilding={EMPTY_STATE}
              maxSections={1}
              arcs={arcs}
              highlightArcId={hoverId}
              bounds={bounds}
              flyTo={flyTo}
              autoOrbit={false}
              onArcHover={setArcTip}
            />
            {arcTip ? (
              <div
                className="pointer-events-none absolute z-10 max-w-[220px] rounded-[var(--c3-style-border-radius-4)] border border-[var(--powered-down)] bg-[rgba(10,10,11,0.94)] px-3 py-2 text-xs"
                style={{ left: Math.min(arcTip.x + 12, 9999), top: arcTip.y + 12 }}
              >
                <div className="font-medium text-[var(--mono-ink)]">{arcTip.courseLabel}</div>
                <div className="mono mt-1 flex items-center gap-1 text-[var(--mono-ink-2)]">
                  <span className="text-[var(--energy-on)]">{arcTip.from}</span>
                  <span>→</span>
                  <span className="text-[var(--powered-down)]">{arcTip.to}</span>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Move recommendations"
        description="Each row relocates one movable section to another room — same days, same times. Accept or reject moves; KPIs reflect accepted moves only."
        actions={
          <Button variant="outline" appearance="secondary" onClick={exportCsv} disabled={!filtered.length}>
            <Download className="size-4" />
            Export CSV
          </Button>
        }
      />

      <div className="flex flex-col gap-4 p-4 md:p-6">
        {error ? (
          <div className="rounded-md bg-[var(--c3-style-basic-bg-danger)] px-4 py-3 text-sm text-[var(--c3-style-basic-fg-danger)]">
            {error}
          </div>
        ) : null}

        {/* KPIs from accepted only */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard variant="elevated">
            <MetricCardHeader>
              <MetricCardLabel>Moves accepted</MetricCardLabel>
            </MetricCardHeader>
            <MetricCardValue>{fmtInt(accepted.length)}</MetricCardValue>
            <MetricCardCaption>of {fmtInt(moves.length)} proposed</MetricCardCaption>
          </MetricCard>
          <MetricCard variant="elevated">
            <MetricCardHeader>
              <MetricCardLabel>Building-hours freed / week</MetricCardLabel>
            </MetricCardHeader>
            <MetricCardValue>{fmtInt(freedHours)}</MetricCardValue>
            <MetricCardCaption>from accepted moves</MetricCardCaption>
          </MetricCard>
          <MetricCard variant="elevated">
            <MetricCardHeader>
              <MetricCardLabel>Cost saved / year</MetricCardLabel>
            </MetricCardHeader>
            <MetricCardValue>{savings ? fmtMoney(savings.dollarsMid) : '—'}</MetricCardValue>
            <MetricCardCaption>
              {savings
                ? `${fmtMoney(savings.dollarsLow)} – ${fmtMoney(savings.dollarsHigh)}`
                : 'mid estimate'}
            </MetricCardCaption>
          </MetricCard>
          <MetricCard variant="elevated">
            <MetricCardHeader>
              <MetricCardLabel>CO₂ avoided / year</MetricCardLabel>
            </MetricCardHeader>
            <MetricCardValue>{savings ? `${fmtNum(savings.co2TonsMid, 0)} t` : '—'}</MetricCardValue>
            <MetricCardCaption>metric tons, mid estimate</MetricCardCaption>
          </MetricCard>
        </div>

        {/* Filters */}
        <Card variant="elevated">
          <CardContent className="flex flex-col gap-3 pt-5">
            <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
              <Input
                placeholder="Search course, section, room…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full md:w-64"
              />
              <div className="flex items-center gap-1 rounded-md bg-[var(--c3-style-basic-bg-secondary)] p-1">
                {(['all', 'accepted', 'rejected'] as StatusFilter[]).map((sf) => (
                  <button
                    key={sf}
                    type="button"
                    onClick={() => setStatusFilter(sf)}
                    className={
                      'flex-1 rounded px-3 py-1 text-sm font-medium capitalize transition-colors md:flex-none ' +
                      (statusFilter === sf
                        ? 'bg-[var(--c3-style-basic-bg-page)] text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground')
                    }
                  >
                    {sf}
                  </button>
                ))}
              </div>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="h-9 w-full rounded-md border border-[var(--c3-style-basic-border-border)] bg-[var(--c3-style-basic-bg-page)] px-2 text-sm text-foreground md:w-auto"
                aria-label="Filter by section type"
              >
                <option value="all">All types</option>
                {typeCodes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-2 md:ml-auto">
                <span className="mr-auto text-sm text-muted-foreground md:mr-0">
                  {fmtInt(filtered.length)} shown
                </span>
                <Button variant="soft" appearance="success" size="sm" onClick={() => bulkSet('accepted')}>
                  <Check className="size-4" />
                  Accept all
                </Button>
                <Button variant="soft" appearance="danger" size="sm" onClick={() => bulkSet('rejected')}>
                  <X className="size-4" />
                  Reject all
                </Button>
              </div>
            </div>

            {/* Weekday chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="eyebrow mr-1 text-[var(--mono-ink-faint)]">Weekday</span>
              <button
                type="button"
                className="io-chip"
                data-active={dayFilter === 'all'}
                onClick={() => setDayFilter('all')}
              >
                All
              </button>
              {WEEKDAYS.map((w) => (
                <button
                  key={w.day}
                  type="button"
                  className="io-chip"
                  data-active={dayFilter === w.day}
                  onClick={() => setDayFilter(w.day)}
                >
                  {w.label}
                </button>
              ))}
            </div>

            {/* Building chips (top from-buildings by move count) */}
            {topBuildings.length ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="eyebrow mr-1 text-[var(--mono-ink-faint)]">From building</span>
                <button
                  type="button"
                  className="io-chip"
                  data-active={buildingFilter === 'all'}
                  onClick={() => setBuildingFilter('all')}
                >
                  All
                </button>
                {topBuildings.map((b) => (
                  <button
                    key={b}
                    type="button"
                    className="io-chip max-w-[180px] truncate"
                    data-active={buildingFilter === b}
                    onClick={() => setBuildingFilter((cur) => (cur === b ? 'all' : b))}
                    title={b}
                  >
                    {b}
                  </button>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner />
          </div>
        ) : isMobile ? (
          <MovesCardList moves={filtered} busyId={busyId} onUpdate={updateStatus} />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <div className="lg:col-span-3">{tableCard}</div>
            <div className="lg:col-span-2">{miniMap}</div>
          </div>
        )}
      </div>
    </div>
  );
}

const MOBILE_PAGE = 40;

function MovesCardList({
  moves,
  busyId,
  onUpdate,
}: {
  moves: MoveRecommendation[];
  busyId: string | null;
  onUpdate: (id: string, status: 'accepted' | 'rejected') => void;
}) {
  const [limit, setLimit] = useState(MOBILE_PAGE);

  useEffect(() => {
    setLimit(MOBILE_PAGE);
  }, [moves]);

  if (moves.length === 0) {
    return (
      <Card variant="elevated">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No moves match the current filters.
        </CardContent>
      </Card>
    );
  }

  const shown = moves.slice(0, limit);

  return (
    <div className="flex flex-col gap-3">
      {shown.map((m) => (
        <Card key={m.id} variant="elevated">
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">
                  {m.courseLabel} · {m.sectionLabel}
                </p>
                <p className="text-xs text-muted-foreground">
                  {m.typeCode} · {m.days} · {m.timeLabel}
                </p>
              </div>
              <Badge
                variant="soft"
                appearance={
                  m.status === 'accepted'
                    ? 'success'
                    : m.status === 'rejected'
                      ? 'danger'
                      : 'secondary'
                }
              >
                {m.status}
              </Badge>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate rounded bg-[var(--c3-style-basic-bg-secondary)] px-2 py-1 text-foreground">
                {m.fromRoom?.id ?? '—'}
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-label="moves to" />
              <span className="min-w-0 flex-1 truncate rounded bg-[var(--c3-style-basic-bg-success)] px-2 py-1 text-[var(--c3-style-basic-fg-success)]">
                {m.toRoom?.id ?? '—'}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                Frees{' '}
                <span className="font-semibold tabular-nums text-foreground">
                  {fmtInt(m.buildingHoursFreed)}
                </span>{' '}
                bldg-hrs/wk
              </span>
              {m.status === 'accepted' ? (
                <Button
                  variant="soft"
                  appearance="danger"
                  size="sm"
                  disabled={busyId === m.id}
                  onClick={() => onUpdate(m.id, 'rejected')}
                >
                  <X className="size-4" />
                  Reject
                </Button>
              ) : (
                <Button
                  variant="soft"
                  appearance="success"
                  size="sm"
                  disabled={busyId === m.id}
                  onClick={() => onUpdate(m.id, 'accepted')}
                >
                  {m.status === 'rejected' ? (
                    <RotateCcw className="size-4" />
                  ) : (
                    <Check className="size-4" />
                  )}
                  Accept
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}

      {moves.length > limit ? (
        <Button
          variant="outline"
          appearance="secondary"
          onClick={() => setLimit((n) => n + MOBILE_PAGE)}
        >
          Show {Math.min(MOBILE_PAGE, moves.length - limit)} more ({fmtInt(moves.length - limit)}{' '}
          remaining)
        </Button>
      ) : null}
    </div>
  );
}
