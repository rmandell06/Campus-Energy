/*
 * Copyright 2009-2025 C3 AI (www.c3.ai). All Rights Reserved.
 * Confidential and Proprietary C3 Materials.
 * This material, including without limitation any software, is the confidential trade secret and proprietary
 * information of C3 and its licensors. Reproduction, use and/or distribution of this material in any form is
 * strictly prohibited except as set forth in a written license agreement with C3 and/or its authorized distributors.
 * This material may be covered by one or more patents or pending patent applications.
 */

import { ReactElement } from 'react';

export interface User {
  id: string;
  name: string;
  email: string;
  lastName: string;
  firstName: string;
}

export interface UserGroup {
  id: string;
  name: string;
  description: string;
}

export interface SnackbarMessage {
  message: ReactElement;
  key: number;
  severity?: 'success' | 'info' | 'warning' | 'error';
  error?: boolean;
}

/** Sample / API document row (examples + fetchDocuments). */
export interface Document {
  documentName: string;
  program: string;
  owner: string;
  checklistApplied: string;
  attachments: number;
  uploadedBy: string;
  uploadedAt: string;
}

export interface ProgramDocument {
  documentName: string;
  owner: string;
  status: string;
  uploadedAt: string;
}

/** Program row with optional nested documents (examples + fetchPrograms). */
export interface Program {
  id: string;
  program: string;
  totalDocuments: number;
  passed: number;
  failed: number;
  pending: number;
  documents?: ProgramDocument[];
}

export interface DocumentTemplate {
  id: string;
  name: string;
  description: string;
  estimatedTime: string;
}

/* ============================ Campus Energy Optimizer ============================ */

export interface BuildingRef {
  id: string;
  sectionsPerWeek?: number;
  isSpecialtyVenue?: boolean;
}

export interface RoomRef {
  id: string;
  building?: BuildingRef;
}

export interface BuildingRec {
  id: string;
  sectionsPerWeek: number;
  isSpecialtyVenue: boolean;
  grossSqFt?: number;
  hvacKwhPerHour?: number;
  /** Footprint-centroid coordinates; absent for schedule buildings with no map footprint. */
  lat?: number | null;
  lon?: number | null;
}

export interface BuildingHourRec {
  id: string;
  building: BuildingRef;
  day: string;
  hour: number;
  sectionsCurrent: number;
  sectionsOptimized: number;
}

/** One energy-neutral study spot from Room.findStudySpots — an empty room in an already-on building. */
export interface StudySpot {
  roomId: string;
  roomName: string;
  building: string;
  buildingSections: number;
  roomTypes: string[];
  freeHours: number;
  freeUntilLabel: string;
}

export interface MoveRecommendation {
  id: string;
  fromRoom: RoomRef;
  toRoom: RoomRef;
  buildingHoursFreed: number;
  status: 'proposed' | 'accepted' | 'rejected';
  courseLabel: string;
  sectionLabel: string;
  typeCode: string;
  days: string;
  timeLabel: string;
}

export interface OptimizationRunRec {
  id: string;
  timestamp?: string;
  paramsJson?: string;
  emptyHoursBefore: number;
  emptyHoursAfter: number;
  movesCount: number;
}

export interface WeekdayStat {
  day: string;
  label: string;
  current: number;
  optimized: number;
}

export interface SavingsResult {
  freedHoursPerWeek: number;
  mwhLow: number;
  mwhMid: number;
  mwhHigh: number;
  dollarsLow: number;
  dollarsMid: number;
  dollarsHigh: number;
  co2TonsLow: number;
  co2TonsMid: number;
  co2TonsHigh: number;
}

export interface OverviewStats {
  emptyBefore: number;
  emptyAfter: number;
  freedHoursPerWeek: number;
  movesCount: number;
  acceptedCount: number;
  runId?: string | null;
  byWeekday: WeekdayStat[];
  savings: SavingsResult;
}

export interface SavingsAssumptionsRec {
  id: string;
  kwhPerFreedHourLow: number;
  kwhPerFreedHourMid: number;
  kwhPerFreedHourHigh: number;
  electricityPriceLow: number;
  electricityPriceMid: number;
  electricityPriceHigh: number;
  emissionFactorLow: number;
  emissionFactorMid: number;
  emissionFactorHigh: number;
  weeksPerSemester: number;
  semestersPerYear: number;
}

export interface OptimizerParams {
  hourStart: number;
  hourEnd: number;
  maxOccupancyToEvacuate: number;
  days: string[];
  excludeBuildings: string[];
}

/* ============================ Agent tools & scenarios ============================ */
/*
 * These mirror the C3 value types returned by AgentTools / BlockIoAgent / OptimizationRun one
 * field at a time. Every number the UI renders arrives through one of these shapes — nothing on
 * the agent or scenario paths is computed in the browser, so a figure on screen can always be
 * traced back to a tool result.
 */

/**
 * A resolved place on the map: a geocoded address, a built-in landmark, or a building centroid.
 * Mirrors the backend {@code MapPin} value type returned by {@code AgentTools.locate}.
 */
export interface MapPin {
  label: string;
  lat: number;
  lon: number;
  /** `landmark` | `building` | `geocoder` | `browser` — where the coordinates came from. */
  source: string;
  /** True for study spots we treat as "usually packed" (an assumption, not live occupancy). */
  usuallyPacked?: boolean;
  note?: string | null;
}

/** An open room in a building that is already heated and lit this hour. */
export interface FreeRoom {
  roomId: string;
  roomName: string;
  building: string;
  roomType?: string | null;
  buildingSections: number;
  freeUntilMin: number;
  freeUntilLabel: string;
  minutesFree: number;
  /** Walking minutes from the user's pin, or -1 when no location is known. */
  walkMinutes: number;
  lat?: number | null;
  lon?: number | null;
}

/** One class meeting in a room, for the Room Detail mini timeline. */
export interface RoomSectionSlot {
  sectionId?: string | null;
  courseLabel?: string | null;
  sectionLabel?: string | null;
  typeCode?: string | null;
  startMin: number;
  endMin: number;
  timeLabel?: string | null;
  /** True when an approved swap has moved this class out of the room. */
  movedAway?: boolean;
}

export interface RoomDetailInfo {
  roomId: string;
  roomName: string;
  building: string;
  roomType?: string | null;
  typesHosted?: string[] | null;
  day?: string | null;
  hour?: number;
  freeNow?: boolean;
  freeUntilLabel?: string | null;
  minutesFree?: number;
  walkMinutes?: number;
  sectionsToday?: RoomSectionSlot[] | null;
  buildingSections?: number;
  lat?: number | null;
  lon?: number | null;
}

/** A merged run of zero-class hours in one building on one day. */
export interface SetbackWindow {
  building: string;
  day: string;
  dayLabel?: string | null;
  startHour: number;
  endHour: number;
  hours: number;
  /** Pre-formatted sentence, e.g. "Fri 3pm-10pm: no classes, safe to set back". */
  label: string;
  /** True when Block I/O's swaps are what emptied these hours. */
  newlyFreed?: boolean;
}

export interface BuildingStatusInfo {
  building: string;
  day: string;
  hour: number;
  sectionsNow: number;
  sectionsWithBlockIo: number;
  /** `running` | `poweredDown` | `idle`. */
  status: string;
  statusSentence: string;
  sectionsInSession?: RoomSectionSlot[] | null;
  setbackWindows?: SetbackWindow[] | null;
  sectionsPerWeek?: number;
  lat?: number | null;
  lon?: number | null;
}

export interface SectionMatch {
  id: string;
  courseLabel: string;
  sectionLabel?: string | null;
  typeCode?: string | null;
  days?: string | null;
  timeLabel?: string | null;
  startMin?: number;
  endMin?: number;
  building?: string | null;
  roomId?: string | null;
  roomName?: string | null;
  movable?: boolean;
}

export interface BuildingImpact {
  building: string;
  hoursFreed: number;
  sectionsRemoved: number;
  canPowerDownEarlier: boolean;
  windows?: SetbackWindow[] | null;
  sentence: string;
  lat?: number | null;
  lon?: number | null;
}

/** Result of simulating a cancellation on a scenario copy — the saved plan is untouched. */
export interface CancelImpact {
  /** `oneDay` | `restOfTerm`. */
  scope: string;
  scopeLabel?: string | null;
  sectionIds?: string[] | null;
  sections?: SectionMatch[] | null;
  hoursFreed: number;
  buildings?: BuildingImpact[] | null;
  extraSwaps: number;
  kwh: number;
  dollars: number;
  co2Tons: number;
  summary: string;
  /** True when the money/CO2 figures are per year rather than for the single day. */
  annualized?: boolean;
}

export interface CloseImpact {
  building: string;
  days?: string[] | null;
  hourStart: number;
  hourEnd: number;
  sectionsAffected: number;
  sectionsRelocated: number;
  sectionsUnplaceable: number;
  destinations?: string[] | null;
  hoursFreed: number;
  netHoursFreed: number;
  dollars: number;
  co2Tons: number;
  summary: string;
}

/** One row of the setback schedule: every safe-to-set-back window for a building. */
export interface BuildingSetback {
  building: string;
  windows?: SetbackWindow[] | null;
  hoursPerWeek: number;
  kwhPerWeek: number;
  dollarsPerYear: number;
  co2TonsPerYear: number;
  /** Of `hoursPerWeek`, how many exist only because of Block I/O's swaps. */
  newlyFreedHoursPerWeek: number;
  lat?: number | null;
  lon?: number | null;
}

/** Headline figures for one optimizer scenario, driving the KPI row and the result sentence. */
export interface ScenarioResult {
  name: string;
  label: string;
  buildingsPoweredDown: number;
  totalBuildings: number;
  freedHoursPerWeek: number;
  movesCount: number;
  wastefulCurrent: number;
  wastefulOptimized: number;
  dollarsLow: number;
  dollarsMid: number;
  dollarsHigh: number;
  co2TonsMid: number;
  mwhMid: number;
  sentence: string;
  runId?: string | null;
}

/** A photo for a building or a specific room, with its attribution. */
export interface BuildingPhotoRec {
  id: string;
  building: string;
  /** `room` | `building` — never label a building exterior as a room. */
  kind: string;
  roomId?: string | null;
  imageUrl: string;
  title?: string | null;
  credit?: string | null;
  license?: string | null;
  sourceUrl?: string | null;
  sourceName?: string | null;
}

/* ============================ Block I/O Agent ============================ */

/**
 * One instruction from the agent to the map. The agent answers in prose *and* in map moves, so
 * these are applied by whichever page hosts the agent panel (see MapControlProvider).
 */
export interface MapAction {
  /** `flyTo` | `highlight` | `setTime` | `setScenario` | `dropPin` | `drawWalk` | `clear`. */
  kind: string;
  building?: string | null;
  buildings?: string[] | null;
  day?: string | null;
  hour?: number;
  lat?: number;
  lon?: number;
  label?: string | null;
  scenario?: string | null;
  color?: string | null;
  toBuilding?: string | null;
  walkMinutes?: number;
}

/** A result card in the agent panel — a room, a building, or a figure. */
export interface AgentCard {
  /** `room` | `building` | `metric` | `section` | `note`. */
  kind: string;
  title: string;
  subtitle?: string | null;
  lines?: string[] | null;
  roomId?: string | null;
  building?: string | null;
  metricLabel?: string | null;
  metricValue?: string | null;
  walkMinutes?: number;
  freeUntilLabel?: string | null;
  minutesFree?: number;
  lat?: number | null;
  lon?: number | null;
  /** True when the card rests on an assumption (e.g. "usually packed") rather than live data. */
  isAssumption?: boolean;
}

export interface AgentReply {
  answer: string;
  /** Short tool-step lines shown while the agent works. */
  steps?: string[] | null;
  cards?: AgentCard[] | null;
  actions?: MapAction[] | null;
  followUps?: string[] | null;
  /** Present when the result can be committed; label for the "Apply to plan" button. */
  applyLabel?: string | null;
  applyScenario?: string | null;
  applySectionIds?: string[] | null;
  /** True when the agent could not find what was asked for — render as a plain miss, not an error. */
  notFound?: boolean;
  intent?: string | null;
}
