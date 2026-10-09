import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useIsMobile } from '@/hooks/useIsMobile';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fetchBuildingHoursForBuilding, fetchMovesFromBuilding } from '@/shared/energyApi';
import {
  HOURS,
  WEEKDAYS,
  hourLabel,
  occupancyColor,
  occupancyTextColor,
  fmtInt,
} from '@/shared/format';
import type { BuildingHourRec, MoveRecommendation } from '@/Interfaces';

type Scenario = 'current' | 'optimized';
type Grid = Record<string, Record<number, { current: number; optimized: number }>>;

export default function BuildingDetail() {
  const { buildingId: raw } = useParams<{ buildingId: string }>();
  const buildingId = raw ? decodeURIComponent(raw) : '';
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [grid, setGrid] = useState<Grid>({});
  const [moves, setMoves] = useState<MoveRecommendation[]>([]);
  const [scenario, setScenario] = useState<Scenario>('current');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!buildingId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchBuildingHoursForBuilding(buildingId),
      fetchMovesFromBuilding(buildingId),
    ])
      .then(([hours, mv]: [BuildingHourRec[], MoveRecommendation[]]) => {
        if (cancelled) return;
        const g: Grid = {};
        for (const r of hours) {
          (g[r.day] ??= {})[r.hour] = {
            current: r.sectionsCurrent ?? 0,
            optimized: r.sectionsOptimized ?? 0,
          };
        }
        setGrid(g);
        setMoves(mv);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load building.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [buildingId]);

  const { maxOcc, emptyCurrent, emptyOptimized } = useMemo(() => {
    let m = 1;
    let ec = 0;
    let eo = 0;
    for (const { day } of WEEKDAYS) {
      for (const h of HOURS) {
        const cell = grid[day]?.[h];
        const cur = cell?.current ?? 0;
        const opt = cell?.optimized ?? 0;
        m = Math.max(m, cur, opt);
        if (cur === 0) ec += 1;
        if (opt === 0) eo += 1;
      }
    }
    return { maxOcc: m, emptyCurrent: ec, emptyOptimized: eo };
  }, [grid]);

  const freed = emptyOptimized - emptyCurrent;

  return (
    <div className="flex flex-col">
      <PageHeader
        title={buildingId}
        description="Weekly occupancy grid (days × hours). Empty cells are candidates for HVAC setback."
        actions={
          <Button variant="outline" appearance="secondary" onClick={() => navigate('/heatmap')}>
            <ArrowLeft className="size-4" />
            Back to heatmap
          </Button>
        }
      />

      <div className="flex flex-col gap-4 p-4 md:p-6">
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
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="soft" appearance="info">
                {fmtInt(emptyCurrent)} empty building-hours now
              </Badge>
              <Badge variant="soft" appearance="success">
                {fmtInt(emptyOptimized)} after optimization
              </Badge>
              {freed > 0 ? (
                <Badge variant="solid" appearance="success">
                  +{fmtInt(freed)} freed
                </Badge>
              ) : null}
              <div className="ml-auto flex items-center gap-2">
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
            </div>

            <Card variant="elevated">
              <CardContent className="overflow-auto pt-5">
                <table className="w-full border-separate border-spacing-0 text-xs">
                  <thead>
                    <tr>
                      <th className="px-2 py-2 text-left font-medium text-muted-foreground">Day</th>
                      {HOURS.map((h) => (
                        <th key={h} className="px-1 py-2 text-center font-medium text-muted-foreground">
                          {hourLabel(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {WEEKDAYS.map(({ day, label }) => (
                      <tr key={day}>
                        <th scope="row" className="px-2 py-1 text-left font-normal text-foreground">
                          {label}
                        </th>
                        {HOURS.map((h) => {
                          const cell = grid[day]?.[h];
                          const count = cell ? cell[scenario] : 0;
                          return (
                            <td key={h} className="p-[1px]">
                              <div
                                className="flex h-6 min-w-[22px] items-center justify-center rounded-sm tabular-nums md:h-7 md:min-w-[30px]"
                                style={{
                                  backgroundColor: occupancyColor(count, maxOcc),
                                  color: occupancyTextColor(count, maxOcc),
                                }}
                                title={`${label} · ${hourLabel(h)} · ${fmtInt(count)} sections`}
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
              </CardContent>
            </Card>

            <Card variant="elevated">
              <CardContent className="pt-5">
                <h3 className="mb-3 text-base font-semibold text-foreground">
                  Sections relocated out of this building ({fmtInt(moves.length)})
                </h3>
                {moves.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No sections were moved out of this building in the latest run.
                  </p>
                ) : isMobile ? (
                  <div className="flex flex-col gap-2">
                    {moves.map((m) => (
                      <div
                        key={m.id}
                        className="rounded-md border border-[var(--c3-style-basic-border-border)] p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate font-medium text-foreground">
                            {m.courseLabel} · {m.sectionLabel}
                          </p>
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            +{fmtInt(m.buildingHoursFreed)} hrs
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {m.days} · {m.timeLabel}
                        </p>
                        <p className="mt-1 flex items-center gap-1 text-xs text-foreground">
                          <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="truncate">to {m.toRoom?.id}</span>
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Course</TableHead>
                        <TableHead>Section</TableHead>
                        <TableHead>Days</TableHead>
                        <TableHead>Time</TableHead>
                        <TableHead>To room</TableHead>
                        <TableHead className="text-right">Hours freed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {moves.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell className="font-medium">{m.courseLabel}</TableCell>
                          <TableCell>{m.sectionLabel}</TableCell>
                          <TableCell>{m.days}</TableCell>
                          <TableCell>{m.timeLabel}</TableCell>
                          <TableCell>{m.toRoom?.id}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtInt(m.buildingHoursFreed)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
