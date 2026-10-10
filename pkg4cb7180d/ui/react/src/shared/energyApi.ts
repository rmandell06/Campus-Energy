import { c3Action } from '@/c3Action';
import type {
  OverviewStats,
  OptimizationRunRec,
  MoveRecommendation,
  BuildingHourRec,
  BuildingRec,
  SavingsAssumptionsRec,
  OptimizerParams,
  StudySpot,
} from '@/Interfaces';

/** Headline Overview statistics derived from the latest run + accepted moves. */
export async function fetchOverviewStats(): Promise<OverviewStats> {
  return (await c3Action('OptimizationRun', 'overviewStats', [])) as OverviewStats;
}

/** Run the consolidation optimizer with the given parameters; returns the persisted run. */
export async function runOptimizer(p: OptimizerParams): Promise<OptimizationRunRec> {
  return (await c3Action('OptimizationRun', 'runOptimization', [
    p.hourStart,
    p.hourEnd,
    p.maxOccupancyToEvacuate,
    p.days && p.days.length ? p.days : null,
    p.excludeBuildings && p.excludeBuildings.length ? p.excludeBuildings : null,
  ])) as OptimizationRunRec;
}

/** The most recent optimization run (or null if the optimizer has never run). */
export async function fetchLatestRun(): Promise<OptimizationRunRec | null> {
  return (await c3Action('OptimizationRun', 'latest', [])) as OptimizationRunRec | null;
}

/** All move recommendations with their from/to rooms + buildings for the Moves table. */
export async function fetchMoves(): Promise<MoveRecommendation[]> {
  const res = await c3Action('MoveRecommendation', 'fetch', {
    include:
      'this, fromRoom.id, fromRoom.building.id, toRoom.id, toRoom.building.id, section.id',
    limit: -1,
    order: 'descending(buildingHoursFreed)',
  });
  return (res?.objs ?? []) as MoveRecommendation[];
}

/** Set the status (accepted/rejected/proposed) of a single move. */
export async function setMoveStatus(id: string, status: string): Promise<void> {
  await c3Action('MoveRecommendation', 'merge', [{ id, status }]);
}

/** Bulk set the status of many moves at once. */
export async function setMovesStatus(ids: string[], status: string): Promise<void> {
  await c3Action(
    'MoveRecommendation',
    'mergeBatch',
    [ids.map((id) => ({ id, status }))],
  );
}

/** Every building-hour occupancy row for the whole week (all 5 weekdays). */
export async function fetchAllBuildingHours(): Promise<BuildingHourRec[]> {
  const res = await c3Action('BuildingHour', 'fetch', {
    include: 'this, building.id, building.sectionsPerWeek, building.isSpecialtyVenue',
    limit: -1,
  });
  return (res?.objs ?? []) as BuildingHourRec[];
}

/** Building-hour occupancy rows for one weekday (baseline + optimized). */
export async function fetchBuildingHoursForDay(day: string): Promise<BuildingHourRec[]> {
  const res = await c3Action('BuildingHour', 'fetch', {
    include: 'this, building.id, building.sectionsPerWeek, building.isSpecialtyVenue',
    filter: `day == '${day}'`,
    limit: -1,
  });
  return (res?.objs ?? []) as BuildingHourRec[];
}

/** All building-hour rows for a single building (its weekly occupancy grid). */
export async function fetchBuildingHoursForBuilding(
  buildingId: string,
): Promise<BuildingHourRec[]> {
  const res = await c3Action('BuildingHour', 'fetch', {
    include: 'this, building.id',
    filter: `building.id == '${buildingId.replace(/'/g, "\\'")}'`,
    limit: -1,
  });
  return (res?.objs ?? []) as BuildingHourRec[];
}

/** All buildings, ordered by weekly activity (busiest first). */
export async function fetchBuildings(): Promise<BuildingRec[]> {
  const res = await c3Action('Building', 'fetch', {
    include: 'this',
    limit: -1,
    order: 'descending(sectionsPerWeek)',
  });
  return (res?.objs ?? []) as BuildingRec[];
}

/** Moves whose source room is in the given building (classes relocated out of it). */
export async function fetchMovesFromBuilding(
  buildingId: string,
): Promise<MoveRecommendation[]> {
  const res = await c3Action('MoveRecommendation', 'fetch', {
    include: 'this, fromRoom.id, fromRoom.building.id, toRoom.id, toRoom.building.id',
    filter: `fromRoom.building.id == '${buildingId.replace(/'/g, "\\'")}'`,
    limit: -1,
  });
  return (res?.objs ?? []) as MoveRecommendation[];
}

/** The singleton savings assumptions (created with defaults if absent). */
export async function fetchAssumptions(): Promise<SavingsAssumptionsRec> {
  return (await c3Action('SavingsAssumptions', 'getOrCreate', [])) as SavingsAssumptionsRec;
}

/** Persist edited savings assumptions (merge by id 'default'). */
export async function saveAssumptions(a: SavingsAssumptionsRec): Promise<void> {
  await c3Action('SavingsAssumptions', 'merge', [{ ...a, id: 'default' }]);
}

/**
 * Energy-neutral study spots for a weekday + hour block: empty rooms in buildings that are already
 * occupied (lit/conditioned) that block. `scenario` picks which occupancy defines "already on"
 * ('optimized' = the recommended post-consolidation plan, 'current' = the real schedule).
 */
export async function fetchStudySpots(
  day: string,
  hour: number,
  scenario: 'optimized' | 'current',
): Promise<StudySpot[]> {
  return ((await c3Action('Room', 'findStudySpots', [day, hour, scenario])) ?? []) as StudySpot[];
}

/** Ask the grounded AI assistant a question about the schedule and optimization. */
export async function askAssistant(question: string): Promise<string> {
  return (await c3Action('EnergyAssistant', 'ask', [question])) as string;
}

/** Record counts for the data-provenance panel. */
export interface DataCounts {
  buildings: number;
  rooms: number;
  sections: number;
  buildingHours: number;
}

/** Live record counts straight from the C3 database, to prove data provenance. */
export async function fetchDataCounts(): Promise<DataCounts> {
  const [buildings, rooms, sections, buildingHours] = await Promise.all([
    c3Action('Building', 'fetchCount', [{}]),
    c3Action('Room', 'fetchCount', [{}]),
    c3Action('Section', 'fetchCount', [{}]),
    c3Action('BuildingHour', 'fetchCount', [{}]),
  ]);
  return {
    buildings: Number(buildings) || 0,
    rooms: Number(rooms) || 0,
    sections: Number(sections) || 0,
    buildingHours: Number(buildingHours) || 0,
  };
}
