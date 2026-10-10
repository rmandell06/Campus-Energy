import { useEffect, useMemo, useState } from 'react';
import type { FeatureCollection } from 'geojson';

/**
 * Loads the static campus map assets once and keeps them cached for the lifetime
 * of the tab:
 *   • `campus_buildings_v2.geojson` — 2,115 real OSM footprints (94 matched to
 *     schedule buildings via the `schedule_building` prop).
 *   • `building_centroids.json` — schedule-building name → [lng, lat], used for
 *     the deck.gl move arcs, pulsing rings and the HTML building labels.
 *
 * Both ship in `public/` and are referenced through `import.meta.env.BASE_URL`
 * so they resolve under the C3 uiservice path in dev and the relative `./` base
 * in a production build.
 */
export type Centroids = Record<string, [number, number]>;

export interface CampusGeojson {
  data: FeatureCollection | null;
  matched: Set<string>;
  centroids: Centroids;
  loading: boolean;
  error: string | null;
}

let geoCache: FeatureCollection | null = null;
let centroidCache: Centroids | null = null;

export function useCampusGeojson(): CampusGeojson {
  const [data, setData] = useState<FeatureCollection | null>(geoCache);
  const [centroids, setCentroids] = useState<Centroids>(centroidCache ?? {});
  const [loading, setLoading] = useState(!geoCache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (geoCache && centroidCache) return;
    let cancelled = false;
    const base = import.meta.env.BASE_URL;
    Promise.all([
      fetch(`${base}campus_buildings_v2.geojson`).then((r) => {
        if (!r.ok) throw new Error(`Failed to load campus map data (${r.status})`);
        return r.json() as Promise<FeatureCollection>;
      }),
      fetch(`${base}building_centroids.json`).then((r) => {
        if (!r.ok) throw new Error(`Failed to load building centroids (${r.status})`);
        return r.json() as Promise<Centroids>;
      }),
    ])
      .then(([geo, cen]) => {
        if (cancelled) return;
        geoCache = geo;
        centroidCache = cen;
        setData(geo);
        setCentroids(cen);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load campus map data.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const matched = useMemo(() => {
    const set = new Set<string>();
    if (data) {
      for (const f of data.features) {
        const name = (f.properties as { schedule_building?: string | null } | null)
          ?.schedule_building;
        if (name) set.add(name);
      }
    }
    return set;
  }, [data]);

  return { data, matched, centroids, loading, error };
}
