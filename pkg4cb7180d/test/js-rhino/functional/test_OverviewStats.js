/**
 * Functional tests for OptimizationRun#overviewStats — the headline statistics
 * that drive the Overview / landing page (Feature 4). These are read-only
 * assertions over the current optimizer state and its accepted moves; they do
 * not mutate any data.
 *
 * Invariants under test:
 *   - optimizing never reduces the number of empty building-hours
 *     (emptyAfter >= emptyBefore);
 *   - freedHoursPerWeek is exactly the gain (emptyAfter - emptyBefore);
 *   - the per-weekday breakdown is Mon..Fri and reconciles to the weekly totals;
 *   - the embedded savings are consistent with SavingsAssumptions#compute.
 */
const filename = 'test_OverviewStats';

describe(filename, function () {
  beforeAll(function () {
    this.ctx = TestApi.createContext(filename);
    this.stats = OptimizationRun.overviewStats();
    this.expectedSavings = SavingsAssumptions.getOrCreate().compute(this.stats.freedHoursPerWeek);
  });

  afterAll(function () {
    TestApi.teardown(this.ctx);
  });

  describe('OptimizationRun', function () {
    describe('#overviewStats headline counts', function () {
      it('never leaves fewer empty building-hours than the baseline', function () {
        expect(this.stats.emptyAfter).toBeGreaterThanOrEqual(this.stats.emptyBefore);
      });

      it('reports freedHoursPerWeek as exactly the empty-hour gain', function () {
        expect(this.stats.freedHoursPerWeek).toEqual(this.stats.emptyAfter - this.stats.emptyBefore);
      });

      it('never reports more accepted moves than total moves', function () {
        expect(this.stats.acceptedCount).toBeLessThanOrEqual(this.stats.movesCount);
      });
    });

    describe('#overviewStats per-weekday breakdown', function () {
      it('covers the five instructional weekdays Mon-Fri in order', function () {
        var labels = [];
        this.stats.byWeekday.each((w) => {
          labels.push(w.label);
        });
        expect(labels.join(',')).toEqual('Mon,Tue,Wed,Thu,Fri');
      });

      it('never shows fewer empty hours after optimizing on any weekday', function () {
        this.stats.byWeekday.each((w) => {
          expect(w.optimized)
            .withContext('Weekday ' + w.label)
            .toBeGreaterThanOrEqual(w.current);
        });
      });

      it('reconciles the baseline weekday counts to the weekly emptyBefore total', function () {
        var sumCurrent = 0;
        this.stats.byWeekday.each((w) => {
          sumCurrent = sumCurrent + w.current;
        });
        expect(sumCurrent).toEqual(this.stats.emptyBefore);
      });

      it('reconciles the optimized weekday counts to the weekly emptyAfter total', function () {
        var sumOptimized = 0;
        this.stats.byWeekday.each((w) => {
          sumOptimized = sumOptimized + w.optimized;
        });
        expect(sumOptimized).toEqual(this.stats.emptyAfter);
      });
    });

    describe('#overviewStats embedded savings', function () {
      it('computes savings for the freed-hours figure it reports', function () {
        expect(this.stats.savings.freedHoursPerWeek).toEqual(this.stats.freedHoursPerWeek);
      });

      it('matches SavingsAssumptions#compute for mid-scenario dollars', function () {
        expect(this.stats.savings.dollarsMid).toEqual(this.expectedSavings.dollarsMid);
      });

      it('matches SavingsAssumptions#compute for mid-scenario tCO2', function () {
        expect(this.stats.savings.co2TonsMid).toEqual(this.expectedSavings.co2TonsMid);
      });
    });
  });
});
