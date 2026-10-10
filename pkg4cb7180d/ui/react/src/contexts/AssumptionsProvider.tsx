/*
 * Copyright 2009-2026 C3 AI (www.c3.ai). All Rights Reserved.
 * Confidential and Proprietary C3 Materials.
 * This material, including without limitation any software, is the confidential trade secret and proprietary
 * information of C3 and its licensors. Reproduction, use and/or distribution of this material in any form is
 * strictly prohibited except as set forth in a written license agreement with C3 and/or its authorized distributors.
 * This material may be covered by one or more patents or pending patent applications.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { fetchAssumptions, saveAssumptions, fetchOverviewStats } from '@/shared/energyApi';
import { computeSavings } from '@/shared/savings';
import type { SavingsAssumptionsRec, SavingsResult } from '@/Interfaces';

/**
 * The savings assumptions that drive every money / energy / CO₂ figure in the app, held in a single
 * app-wide store so a slider on the Setback page updates the Overview KPIs, the Landing stats and the
 * Room-swaps summary the instant it moves — no page reload, no backend round-trip.
 *
 * The annualization window is fixed by policy: 15 instructional weeks over 2 semesters. Only the three
 * energy-intensity triples (energy per freed building-hour, electricity price, grid emission factor)
 * are editable, each as a low / mid / high band where the big headline number always equals mid.
 */

/** Weeks of instruction per semester — fixed, not user-editable. */
export const WEEKS_PER_SEMESTER = 15;
/** Semesters per year — fixed, not user-editable. */
export const SEMESTERS_PER_YEAR = 2;

/** The default assumption band restored by "Reset to defaults". */
export const DEFAULT_ASSUMPTIONS: SavingsAssumptionsRec = {
  id: 'default',
  kwhPerFreedHourLow: 50,
  kwhPerFreedHourMid: 100,
  kwhPerFreedHourHigh: 150,
  electricityPriceLow: 0.08,
  electricityPriceMid: 0.1,
  electricityPriceHigh: 0.12,
  emissionFactorLow: 0.35,
  emissionFactorMid: 0.4,
  emissionFactorHigh: 0.45,
  weeksPerSemester: WEEKS_PER_SEMESTER,
  semestersPerYear: SEMESTERS_PER_YEAR,
};

/** The nine editable numeric fields, grouped into low/mid/high triples by {@link ASSUMPTION_ROWS}. */
export type AssumptionKey =
  | 'kwhPerFreedHourLow'
  | 'kwhPerFreedHourMid'
  | 'kwhPerFreedHourHigh'
  | 'electricityPriceLow'
  | 'electricityPriceMid'
  | 'electricityPriceHigh'
  | 'emissionFactorLow'
  | 'emissionFactorMid'
  | 'emissionFactorHigh';

/** Describes one assumption as a low/mid/high band plus the slider bounds that constrain it. */
export interface AssumptionRow {
  id: 'energy' | 'price' | 'emission';
  label: string;
  unit: string;
  /** [low, mid, high] field keys, in that order. */
  keys: [AssumptionKey, AssumptionKey, AssumptionKey];
  step: number;
  min: number;
  max: number;
  /** Decimal places to display (and to round to). */
  digits: number;
}

export const ASSUMPTION_ROWS: AssumptionRow[] = [
  {
    id: 'energy',
    label: 'Energy per freed building-hour',
    unit: 'kWh',
    keys: ['kwhPerFreedHourLow', 'kwhPerFreedHourMid', 'kwhPerFreedHourHigh'],
    step: 1,
    min: 25,
    max: 300,
    digits: 0,
  },
  {
    id: 'price',
    label: 'Electricity price',
    unit: '$/kWh',
    keys: ['electricityPriceLow', 'electricityPriceMid', 'electricityPriceHigh'],
    step: 0.005,
    min: 0.05,
    max: 0.25,
    digits: 3,
  },
  {
    id: 'emission',
    label: 'Emission factor',
    unit: 'kg CO₂/kWh',
    keys: ['emissionFactorLow', 'emissionFactorMid', 'emissionFactorHigh'],
    step: 0.01,
    min: 0.2,
    max: 0.8,
    digits: 2,
  },
];

/** Map a single field key back to the row it belongs to and its slot (0=low, 1=mid, 2=high). */
function locate(key: AssumptionKey): { row: AssumptionRow; slot: 0 | 1 | 2 } | null {
  for (const row of ASSUMPTION_ROWS) {
    const slot = row.keys.indexOf(key);
    if (slot >= 0) return { row, slot: slot as 0 | 1 | 2 };
  }
  return null;
}

/**
 * Apply a new value to one slot of a low≤mid≤high triple, pushing the other two slots as needed so
 * the ordering is never violated. Dragging mid above high drags high up with it; dragging high below
 * low collapses the whole band to that value, and so on. Every value is clamped to [min, max] first.
 */
function clampTriple(
  current: SavingsAssumptionsRec,
  row: AssumptionRow,
  slot: 0 | 1 | 2,
  rawValue: number,
): SavingsAssumptionsRec {
  const [lowKey, midKey, highKey] = row.keys;
  const bound = (n: number) => Math.min(row.max, Math.max(row.min, n));
  let low = current[lowKey];
  let mid = current[midKey];
  let high = current[highKey];
  const v = bound(Number.isFinite(rawValue) ? rawValue : 0);

  if (slot === 0) {
    low = v;
    if (mid < low) mid = low;
    if (high < mid) high = mid;
  } else if (slot === 1) {
    mid = v;
    if (low > mid) low = mid;
    if (high < mid) high = mid;
  } else {
    high = v;
    if (mid > high) mid = high;
    if (low > mid) low = mid;
  }

  return { ...current, [lowKey]: low, [midKey]: mid, [highKey]: high };
}

/** Keep only the editable energy-intensity fields from a loaded record; the window stays fixed. */
function normalize(rec: Partial<SavingsAssumptionsRec> | null | undefined): SavingsAssumptionsRec {
  return {
    ...DEFAULT_ASSUMPTIONS,
    ...(rec ?? {}),
    id: 'default',
    weeksPerSemester: WEEKS_PER_SEMESTER,
    semestersPerYear: SEMESTERS_PER_YEAR,
  };
}

interface AssumptionsContextValue {
  /** The live assumption band — every edit is reflected here synchronously. */
  assumptions: SavingsAssumptionsRec;
  /** Freed building-hours per week from the latest run; the baseline savings annualize this. */
  freedHoursPerWeek: number;
  /** Low/mid/high savings for `freedHoursPerWeek`, recomputed on every edit. */
  savings: SavingsResult;
  loading: boolean;
  error: string | null;
  saving: boolean;
  /** True once a Save has succeeded and nothing has changed since. */
  saved: boolean;
  /** True when the live band differs from what is persisted. */
  dirty: boolean;
  /** Set one field, clamping its low/mid/high triple so low ≤ mid ≤ high always holds. */
  setValue: (key: AssumptionKey, value: number) => void;
  /** Restore the default band. */
  reset: () => void;
  /** Persist the live band for the whole app. */
  save: () => Promise<void>;
  /** Compute savings for an arbitrary freed-hours figure using the live band (e.g. accepted moves). */
  computeFor: (freedHoursPerWeek: number) => SavingsResult;
}

const AssumptionsContext = createContext<AssumptionsContextValue | null>(null);

/**
 * Loads the persisted assumptions and the baseline freed-hours once, then holds the editable band in
 * memory so every consumer renders the same live figures. Mount it high in the tree (around the app
 * shell) so the Landing page, both role consoles and the Setback editor all share one source.
 */
export function AssumptionsProvider({ children }: { children: React.ReactNode }) {
  const [assumptions, setAssumptions] = useState<SavingsAssumptionsRec>(DEFAULT_ASSUMPTIONS);
  const [freedHoursPerWeek, setFreedHoursPerWeek] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // The last-persisted band, used to derive `dirty`.
  const persistedRef = useRef<SavingsAssumptionsRec>(DEFAULT_ASSUMPTIONS);
  const [persisted, setPersisted] = useState<SavingsAssumptionsRec>(DEFAULT_ASSUMPTIONS);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchAssumptions(), fetchOverviewStats()])
      .then(([a, stats]) => {
        if (cancelled) return;
        const norm = normalize(a);
        setAssumptions(norm);
        persistedRef.current = norm;
        setPersisted(norm);
        setFreedHoursPerWeek(stats.freedHoursPerWeek ?? 0);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load assumptions.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setValue = useCallback((key: AssumptionKey, value: number) => {
    const found = locate(key);
    if (!found) return;
    setSaved(false);
    setAssumptions((cur) => clampTriple(cur, found.row, found.slot, value));
  }, []);

  const reset = useCallback(() => {
    setSaved(false);
    setAssumptions(DEFAULT_ASSUMPTIONS);
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await saveAssumptions(assumptions);
      persistedRef.current = assumptions;
      setPersisted(assumptions);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save assumptions.');
    } finally {
      setSaving(false);
    }
  }, [assumptions]);

  const savings = useMemo(
    () => computeSavings(assumptions, freedHoursPerWeek),
    [assumptions, freedHoursPerWeek],
  );

  const computeFor = useCallback(
    (hours: number) => computeSavings(assumptions, hours),
    [assumptions],
  );

  const dirty = useMemo(
    () => ASSUMPTION_ROWS.some((row) => row.keys.some((k) => assumptions[k] !== persisted[k])),
    [assumptions, persisted],
  );

  const value = useMemo<AssumptionsContextValue>(
    () => ({
      assumptions,
      freedHoursPerWeek,
      savings,
      loading,
      error,
      saving,
      saved,
      dirty,
      setValue,
      reset,
      save,
      computeFor,
    }),
    [
      assumptions,
      freedHoursPerWeek,
      savings,
      loading,
      error,
      saving,
      saved,
      dirty,
      setValue,
      reset,
      save,
      computeFor,
    ],
  );

  return <AssumptionsContext.Provider value={value}>{children}</AssumptionsContext.Provider>;
}

/** Access the shared assumptions store. Throws if used outside {@link AssumptionsProvider}. */
export function useAssumptions(): AssumptionsContextValue {
  const ctx = useContext(AssumptionsContext);
  if (!ctx) throw new Error('useAssumptions must be used inside an AssumptionsProvider');
  return ctx;
}
