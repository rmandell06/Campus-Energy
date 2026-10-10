/**
 * Shared model that turns the week's BuildingHour rows into the structures the
 * Overview hero map, the Campus Map page, and the derived headline metrics all
 * read from. Every figure here is computed from live `BuildingHour` rows
 * (fetched via energyApi) — nothing is hard-coded.
 */
import type { BuildingHourRec, MoveRecommendation } from '@/Interfaces';

export interface Cell {
  cur: number;
  opt: number;
}

export interface CampusWeek {
  /** building name → day → hour → occupancy cell */
  byBuilding: Map<string, Map<string, Map<number, Cell>>>;
  /** building names sorted by weekly section volume (busiest first) */
  buildingNames: string[];
  sectionsPerWeek: Map<string, number>;
  totalBuildings: number;
  /** largest single building-hour occupancy, for intensity scaling */
  maxPerHour: number;
}

export function buildWeek(rows: BuildingHourRec[]): CampusWeek {
  const byBuilding = new Map<string, Map<string, Map<number, Cell>>>();
  const spw = new Map<string, number>();
  let maxPerHour = 1;

  for (const r of rows) {
    const name = r.building?.id;
    if (!name) continue;
    let days = byBuilding.get(name);
    if (!days) {
      days = new Map();
      byBuilding.set(name, days);
    }
    let hours = days.get(r.day);
    if (!hours) {
      hours = new Map();
      days.set(r.day, hours);
    }
    const cur = r.sectionsCurrent ?? 0;
    const opt = r.sectionsOptimized ?? 0;
    hours.set(r.hour, { cur, opt });
    spw.set(name, r.building?.sectionsPerWeek ?? spw.get(name) ?? 0);
    maxPerHour = Math.max(maxPerHour, cur, opt);
  }

  const buildingNames = Array.from(spw.keys()).sort(
    (a, b) => (spw.get(b) ?? 0) - (spw.get(a) ?? 0) || a.localeCompare(b),
  );

  return {
    byBuilding,
    buildingNames,
    sectionsPerWeek: spw,
    totalBuildings: buildingNames.length,
    maxPerHour,
  };
}

export type Scenario = 'current' | 'optimized';

export interface BuildingState {
  /** sections running in the selected day + hour, in the active scenario */
  sections: number;
  /** sections in the current (baseline) schedule for that hour */
  sectionsCurrent: number;
  /** true when the optimizer empties this building-hour (optimized scenario) */
  freed: boolean;
}

/** State keyed by building name for one (day, hour, scenario) slice. */
export function stateForHour(
  week: CampusWeek,
  day: string,
  hour: number,
  scenario: Scenario,
): Record<string, BuildingState> {
  const out: Record<string, BuildingState> = {};
  for (const name of week.buildingNames) {
    const cell = week.byBuilding.get(name)?.get(day)?.get(hour) ?? { cur: 0, opt: 0 };
    const sections = scenario === 'current' ? cell.cur : cell.opt;
    out[name] = {
      sections,
      sectionsCurrent: cell.cur,
      freed: scenario === 'optimized' && cell.cur > 0 && cell.opt === 0,
    };
  }
  return out;
}

export interface HourCounts {
  running: number;
  dark: number;
  freed: number;
}

export function hourCounts(state: Record<string, BuildingState>): HourCounts {
  let running = 0;
  let dark = 0;
  let freed = 0;
  for (const s of Object.values(state)) {
    if (s.sections > 0) running += 1;
    else dark += 1;
    if (s.freed) freed += 1;
  }
  return { running, dark, freed };
}

export interface WeekMetrics {
  /** buildings that gain ≥1 freed building-hour per week */
  buildingsWithFreedHours: number;
  totalBuildings: number;
  /** building-hours where a building runs for only 1–2 sections (current) */
  wastefulCurrent: number;
  /** …and the same count after optimization */
  wastefulOptimized: number;
}

export function weekMetrics(week: CampusWeek): WeekMetrics {
  let buildingsWithFreedHours = 0;
  let wastefulCurrent = 0;
  let wastefulOptimized = 0;

  for (const name of week.buildingNames) {
    let freedThisBuilding = false;
    const days = week.byBuilding.get(name);
    if (!days) continue;
    for (const hours of days.values()) {
      for (const cell of hours.values()) {
        if (cell.cur === 1 || cell.cur === 2) wastefulCurrent += 1;
        if (cell.opt === 1 || cell.opt === 2) wastefulOptimized += 1;
        if (cell.cur > 0 && cell.opt === 0) freedThisBuilding = true;
      }
    }
    if (freedThisBuilding) buildingsWithFreedHours += 1;
  }

  return {
    buildingsWithFreedHours,
    totalBuildings: week.totalBuildings,
    wastefulCurrent,
    wastefulOptimized,
  };
}

/** Schedule buildings that have no matching footprint in the geojson. */
export function buildingsNotOnMap(buildingNames: string[], matched: Set<string>): string[] {
  return buildingNames.filter((n) => !matched.has(n)).sort((a, b) => a.localeCompare(b));
}

/* ===================== Move arcs (deck.gl energy flow) ===================== */

export type Centroids = Record<string, [number, number]>;

/** The days a move runs, as a set of single-char day codes (M T W R F). */
export function parseDays(days: string | null | undefined): Set<string> {
  const set = new Set<string>();
  for (const ch of (days ?? '').toUpperCase()) {
    if ('MTWRF'.includes(ch)) set.add(ch);
  }
  return set;
}

/** Convert a "12:00 PM" style clock token to a 0–23 hour, or null if unparseable. */
function to24(token: string): number | null {
  const m = token.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (/PM/i.test(m[3])) h += 12;
  return h;
}

/** Inclusive [startHour, endHour] a move's time label spans, or null. */
export function parseHourSpan(timeLabel: string | null | undefined): [number, number] | null {
  if (!timeLabel) return null;
  const [a, b] = timeLabel.split('-');
  const start = to24(a ?? '');
  if (start == null) return null;
  const endRaw = b ? to24(b) : null;
  // A class ending at :00 does not occupy that final hour slot; otherwise it does.
  let end = start;
  if (endRaw != null && b) {
    const minutes = Number((b.match(/:(\d{2})/) ?? [])[1] ?? '0');
    end = minutes > 0 ? endRaw : Math.max(start, endRaw - 1);
  }
  return [start, Math.max(start, end)];
}

/** True when a move's class is in session on the given weekday + hour. */
export function moveActiveAt(m: MoveRecommendation, day: string, hour: number): boolean {
  if (!parseDays(m.days).has(day)) return false;
  const span = parseHourSpan(m.timeLabel);
  if (!span) return false;
  return hour >= span[0] && hour <= span[1];
}

export interface MoveArc {
  id: string;
  source: [number, number];
  target: [number, number];
  fromBuilding: string;
  toBuilding: string;
  courseLabel: string;
  sectionLabel: string;
  /** sections sharing this from→to corridor this hour (drives arc width) */
  corridor: number;
}

/**
 * Build the deck.gl arcs for every non-rejected move in session at (day, hour).
 * Source/target come from `building_centroids.json`; moves whose endpoints have
 * no centroid are dropped. `corridor` counts sections sharing a from→to pair so
 * busy corridors render thicker.
 */
export function buildMoveArcs(
  moves: MoveRecommendation[],
  centroids: Centroids,
  day: string,
  hour: number,
): MoveArc[] {
  return arcsForMoves(
    moves.filter((m) => m.status !== 'rejected' && moveActiveAt(m, day, hour)),
    centroids,
  );
}

/**
 * Build arcs for exactly the given set of moves (no day/hour gating) — used by
 * the Moves page mini-map, where arcs mirror the filtered table rows. `corridor`
 * still counts sections sharing a from→to pair so busy corridors render thicker.
 */
export function arcsForMoves(moves: MoveRecommendation[], centroids: Centroids): MoveArc[] {
  const corridorCount = new Map<string, number>();
  for (const m of moves) {
    const key = `${m.fromRoom?.building?.id}→${m.toRoom?.building?.id}`;
    corridorCount.set(key, (corridorCount.get(key) ?? 0) + 1);
  }
  const arcs: MoveArc[] = [];
  for (const m of moves) {
    const from = m.fromRoom?.building?.id;
    const to = m.toRoom?.building?.id;
    if (!from || !to) continue;
    const s = centroids[from];
    const t = centroids[to];
    if (!s || !t) continue;
    arcs.push({
      id: m.id,
      source: s,
      target: t,
      fromBuilding: from,
      toBuilding: to,
      courseLabel: m.courseLabel,
      sectionLabel: m.sectionLabel,
      corridor: corridorCount.get(`${from}→${to}`) ?? 1,
    });
  }
  return arcs;
}

/** Buildings powered down (freed) at the given day+hour, with their centroids. */
export function poweredDownAt(
  week: CampusWeek,
  centroids: Centroids,
  day: string,
  hour: number,
): { name: string; position: [number, number] }[] {
  const out: { name: string; position: [number, number] }[] = [];
  const state = stateForHour(week, day, hour, 'optimized');
  for (const [name, s] of Object.entries(state)) {
    if (s.freed && centroids[name]) out.push({ name, position: centroids[name] });
  }
  return out;
}

/** Core campus center the camera frames around (quad / main-quad area). */
const CAMPUS_CORE: [number, number] = [-88.2272, 40.1075];
/** Radius (km) around {@link CAMPUS_CORE} that counts as "core campus". */
const CORE_RADIUS_KM = 1.3;

/** Approximate great-circle distance in km between two [lng, lat] points. */
function distKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Lng/lat bounds for the initial camera fit. The tracked buildings include
 * far-flung outliers (South Farms, Vet Med, the research park, off-campus
 * sites); fitting over all of them leaves the dense core a tiny cluster in the
 * middle of the canvas. So we frame only the centroids within
 * {@link CORE_RADIUS_KM} of {@link CAMPUS_CORE} — outliers stay reachable by
 * panning. Falls back to all points if the core filter leaves fewer than two.
 */
export function centroidBounds(
  centroids: Centroids,
): [[number, number], [number, number]] | null {
  const all = Object.values(centroids);
  if (!all.length) return null;
  const core = all.filter((p) => distKm(p, CAMPUS_CORE) <= CORE_RADIUS_KM);
  const pts = core.length >= 2 ? core : all;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of pts) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}
