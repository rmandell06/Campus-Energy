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
