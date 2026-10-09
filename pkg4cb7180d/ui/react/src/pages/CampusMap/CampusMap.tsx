import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { FeatureCollection } from 'geojson';
import { PageHeader } from '@/components/ui/page-header';
import { Spinner } from '@/components/ui/spinner';
import CampusMapPanel from '@/components/CampusMap3D/CampusMapPanel';
import { useCampusGeojson } from '@/hooks/useCampusGeojson';
import { fetchAllBuildingHours } from '@/shared/energyApi';
import { buildWeek, CampusWeek } from '@/shared/campusModel';

/**
 * Dedicated full-bleed 3D campus map page. Same interactive panel as the
 * Overview hero, given the full viewport height to explore: scrub the hour,
 * flip Current/Optimized, hover for occupancy, click a building for its weekly
 * heat strip and the classes relocated out of it.
 */
export default function CampusMap() {
  const geo = useCampusGeojson();
  const [searchParams] = useSearchParams();
  const [week, setWeek] = useState<CampusWeek | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Deep-link params from the AI Assistant's "Show on map" buttons.
  const focusBuilding = searchParams.get('building');
  const focusDay = searchParams.get('day');
  const focusHourRaw = searchParams.get('hour');
  const focusHourNum = focusHourRaw != null ? Number(focusHourRaw) : NaN;
  const focusHour = Number.isFinite(focusHourNum) ? focusHourNum : null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchAllBuildingHours();
      setWeek(buildWeek(rows));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load schedule occupancy.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const ready = useMemo(() => Boolean(week && geo.data), [week, geo.data]);
  const err = error ?? geo.error;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Campus Map"
        description="Real OpenStreetMap footprints of the UIUC campus, extruded in 3D and lit by the live class schedule."
      />
      {/* Full content-width map at the desktop shell breakpoint (≥900px): drop
          the horizontal padding so the 3D stage spans edge-to-edge. */}
      <div className="px-4 py-4 md:px-0 md:py-6">
        {err ? (
          <div className="rounded-[var(--c3-style-border-radius-6)] bg-[var(--c3-style-basic-bg-danger)] px-4 py-3 text-sm text-[var(--c3-style-basic-fg-danger)]">
            {err}
          </div>
        ) : !ready || loading || geo.loading ? (
          <div className="flex h-[60vh] items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <CampusMapPanel
            week={week as CampusWeek}
            geojson={geo.data as FeatureCollection}
            matched={geo.matched}
            centroids={geo.centroids}
            heightClass="h-[70vh] min-h-[380px] md:h-[calc(100vh-16rem)] md:min-h-[460px]"
            initialDay={focusDay ?? undefined}
            initialHour={focusHour ?? undefined}
            focusBuilding={focusBuilding}
          />
        )}
      </div>
    </div>
  );
}
