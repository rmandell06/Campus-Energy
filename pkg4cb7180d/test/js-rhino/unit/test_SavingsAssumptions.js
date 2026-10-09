/**
 * Unit tests for SavingsAssumptions — the editable low/mid/high assumption set
 * that converts freed building-hours into annualized energy (MWh), cost ($) and
 * avoided emissions (metric tons CO2). This is Feature 3 ("Savings estimate") of
 * the Campus Energy Optimizer.
 *
 * The arithmetic is exercised against an in-memory (un-persisted) instance with
 * known assumptions so the expected values are derived from the documented
 * formula rather than from live config:
 *
 *   annualHours = freedHoursPerWeek * weeksPerSemester * semestersPerYear
 *   MWh         = annualHours * kwhPerFreedHour / 1000
 *   dollars     = annualHours * kwhPerFreedHour * electricityPrice
 *   tCO2        = annualHours * kwhPerFreedHour * emissionFactor / 1000
 */
const filename = 'test_SavingsAssumptions';

describe(filename, function () {
  beforeAll(function () {
    this.ctx = TestApi.createContext(filename);
  });

  afterAll(function () {
    TestApi.teardown(this.ctx);
  });

  describe('SavingsAssumptions', function () {
    describe('#compute', function () {
      // A fully-specified in-memory instance. 15 weeks * 2 semesters => the
      // annualization factor is 30, so for freedHoursPerWeek = 10 the annual
      // freed-hours total is 300.
      beforeAll(function () {
        this.assumptions = SavingsAssumptions.make({
          kwhPerFreedHourLow: 50,
          kwhPerFreedHourMid: 100,
          kwhPerFreedHourHigh: 150,
          electricityPriceLow: 0.08,
          electricityPriceMid: 0.1,
          electricityPriceHigh: 0.12,
          emissionFactorLow: 0.35,
          emissionFactorMid: 0.4,
          emissionFactorHigh: 0.45,
          weeksPerSemester: 15,
          semestersPerYear: 2,
        });
        this.freed = 10;
        this.annualHours = this.freed * 15 * 2; // 300
        this.result = this.assumptions.compute(this.freed);
      });

      it('echoes freedHoursPerWeek back onto the result', function () {
        expect(this.result.freedHoursPerWeek).toEqual(this.freed);
      });

      it('computes mid-scenario MWh = annualHours * kwh / 1000', function () {
        expect(this.result.mwhMid).toEqual((this.annualHours * 100) / 1000);
      });

      it('computes low-scenario MWh from the low kWh assumption', function () {
        expect(this.result.mwhLow).toEqual((this.annualHours * 50) / 1000);
      });

      it('computes high-scenario MWh from the high kWh assumption', function () {
        expect(this.result.mwhHigh).toEqual((this.annualHours * 150) / 1000);
      });

      it('computes mid-scenario dollars = annualHours * kwh * price', function () {
        expect(this.result.dollarsMid).toEqual(this.annualHours * 100 * 0.1);
      });

      it('computes low-scenario dollars from the low price assumption', function () {
        expect(this.result.dollarsLow).toEqual(this.annualHours * 50 * 0.08);
      });

      it('computes high-scenario dollars from the high price assumption', function () {
        expect(this.result.dollarsHigh).toEqual(this.annualHours * 150 * 0.12);
      });

      it('computes mid-scenario tCO2 = annualHours * kwh * factor / 1000', function () {
        expect(this.result.co2TonsMid).toEqual((this.annualHours * 100 * 0.4) / 1000);
      });

      it('computes low-scenario tCO2 from the low emission factor', function () {
        expect(this.result.co2TonsLow).toEqual((this.annualHours * 50 * 0.35) / 1000);
      });

      it('computes high-scenario tCO2 from the high emission factor', function () {
        expect(this.result.co2TonsHigh).toEqual((this.annualHours * 150 * 0.45) / 1000);
      });
    });

    describe('#compute when zero building-hours are freed', function () {
      beforeAll(function () {
        this.assumptions = SavingsAssumptions.make({
          kwhPerFreedHourLow: 50,
          kwhPerFreedHourMid: 100,
          kwhPerFreedHourHigh: 150,
          electricityPriceLow: 0.08,
          electricityPriceMid: 0.1,
          electricityPriceHigh: 0.12,
          emissionFactorLow: 0.35,
          emissionFactorMid: 0.4,
          emissionFactorHigh: 0.45,
          weeksPerSemester: 15,
          semestersPerYear: 2,
        });
        this.result = this.assumptions.compute(0);
      });

      it('yields zero dollars when nothing is freed', function () {
        expect(this.result.dollarsMid).toEqual(0);
      });

      it('yields zero MWh when nothing is freed', function () {
        expect(this.result.mwhMid).toEqual(0);
      });
    });

    describe('#compute defaults the annualization factors when they are absent', function () {
      // weeksPerSemester / semestersPerYear are omitted; the implementation
      // falls back to 15 and 2, so the factor stays 30 (annualHours = 300).
      beforeAll(function () {
        this.assumptions = SavingsAssumptions.make({
          kwhPerFreedHourLow: 50,
          kwhPerFreedHourMid: 100,
          kwhPerFreedHourHigh: 150,
          electricityPriceLow: 0.08,
          electricityPriceMid: 0.1,
          electricityPriceHigh: 0.12,
          emissionFactorLow: 0.35,
          emissionFactorMid: 0.4,
          emissionFactorHigh: 0.45,
        });
        this.result = this.assumptions.compute(10);
      });

      it('uses the default 15 weeks x 2 semesters annualization', function () {
        expect(this.result.mwhMid).toEqual((10 * 15 * 2 * 100) / 1000);
      });
    });

    describe('#getOrCreate', function () {
      beforeAll(function () {
        this.singleton = SavingsAssumptions.getOrCreate();
      });

      it('returns the singleton whose id is "default"', function () {
        expect(this.singleton.id).toEqual('default');
      });

      it('seeds the documented mid kWh-per-freed-hour assumption', function () {
        expect(this.singleton.kwhPerFreedHourMid).toEqual(100);
      });

      it('seeds 15 instructional weeks per semester', function () {
        expect(this.singleton.weeksPerSemester).toEqual(15);
      });

      it('seeds 2 semesters per year', function () {
        expect(this.singleton.semestersPerYear).toEqual(2);
      });
    });
  });
});
