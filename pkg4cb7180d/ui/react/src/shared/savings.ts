import type { SavingsAssumptionsRec, SavingsResult } from '@/Interfaces';

/**
 * Client-side mirror of the backend {@link SavingsAssumptions#compute} so screens
 * can show live low/mid/high savings as the user accepts/rejects moves or edits
 * assumptions, without a backend round-trip. The authoritative figures still come
 * from the backend; this must stay in sync with SavingsAssumptions.py.
 *
 * Per freed building-hour: energy = kWh; cost = kWh × $/kWh; CO2 = kWh × factor.
 * Annualized by freedHoursPerWeek × weeksPerSemester × semestersPerYear.
 */
export function computeSavings(
  a: SavingsAssumptionsRec,
  freedHoursPerWeek: number,
): SavingsResult {
  const annualHours = freedHoursPerWeek * a.weeksPerSemester * a.semestersPerYear;
  const round = (n: number, d = 2) => {
    const f = 10 ** d;
    return Math.round(n * f) / f;
  };
  return {
    freedHoursPerWeek,
    mwhLow: round((annualHours * a.kwhPerFreedHourLow) / 1000),
    mwhMid: round((annualHours * a.kwhPerFreedHourMid) / 1000),
    mwhHigh: round((annualHours * a.kwhPerFreedHourHigh) / 1000),
    dollarsLow: round(annualHours * a.kwhPerFreedHourLow * a.electricityPriceLow),
    dollarsMid: round(annualHours * a.kwhPerFreedHourMid * a.electricityPriceMid),
    dollarsHigh: round(annualHours * a.kwhPerFreedHourHigh * a.electricityPriceHigh),
    co2TonsLow: round((annualHours * a.kwhPerFreedHourLow * a.emissionFactorLow) / 1000),
    co2TonsMid: round((annualHours * a.kwhPerFreedHourMid * a.emissionFactorMid) / 1000),
    co2TonsHigh: round((annualHours * a.kwhPerFreedHourHigh * a.emissionFactorHigh) / 1000),
  };
}
