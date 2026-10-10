/*
 * Copyright 2009-2026 C3 AI (www.c3.ai). All Rights Reserved.
 * Confidential and Proprietary C3 Materials.
 * This material, including without limitation any software, is the confidential trade secret and proprietary
 * information of C3 and its licensors. Reproduction, use and/or distribution of this material in any form is
 * strictly prohibited except as set forth in a written license agreement with C3 and/or its authorized distributors.
 * This material may be covered by one or more patents or pending patent applications.
 */

import { c3Action } from '@/c3Action';
import type { AgentReply, BuildingPhotoRec, MapPin } from '@/Interfaces';

/**
 * Backend calls that are new to the audience-first rebuild (the Block I/O agent and building
 * photos). Kept separate from the original {@link energyApi} so the optimizer surface stays
 * untouched.
 */

/** Ask the Block I/O agent. `near` is optional (the student "where are you?" pin). */
export async function askAgent(
  question: string,
  role: 'student' | 'facilities',
  day: string,
  hour: number,
  near?: MapPin | null,
): Promise<AgentReply> {
  return (await c3Action('BlockIoAgent', 'ask', [
    question,
    role,
    day,
    hour,
    near ?? null,
  ])) as AgentReply;
}

/** Role-specific suggested questions shown as chips above the agent input. */
export async function fetchAgentSuggestions(role: 'student' | 'facilities'): Promise<string[]> {
  return ((await c3Action('BlockIoAgent', 'suggestions', [role])) as string[]) ?? [];
}

/** Every building/room photo record, for the 3-tier photo resolver. */
export async function fetchBuildingPhotos(): Promise<BuildingPhotoRec[]> {
  const res = await c3Action('BuildingPhoto', 'fetch', { include: 'this', limit: -1 });
  return (res?.objs ?? []) as BuildingPhotoRec[];
}

/** The three weekday/hour helpers the agent and pickers share. */
const DAY_CODES = ['M', 'T', 'W', 'R', 'F'] as const;

/**
 * The current class-schedule day + hour, falling back to Monday 10am whenever we are outside class
 * hours (before 7am, after 10pm, or on a weekend) — exactly what the student view defaults to.
 */
export function currentDayHour(now: Date = new Date()): { day: string; hour: number } {
  const dow = now.getDay(); // 0 Sun .. 6 Sat
  const hour = now.getHours();
  const isWeekday = dow >= 1 && dow <= 5;
  const inClassHours = hour >= 7 && hour < 22;
  if (isWeekday && inClassHours) {
    return { day: DAY_CODES[dow - 1], hour };
  }
  return { day: 'M', hour: 10 };
}
