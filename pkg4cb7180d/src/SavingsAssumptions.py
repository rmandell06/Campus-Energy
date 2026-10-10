DEFAULTS = {
    "id": "default",
    "kwhPerFreedHourLow": 50.0, "kwhPerFreedHourMid": 100.0, "kwhPerFreedHourHigh": 150.0,
    "electricityPriceLow": 0.08, "electricityPriceMid": 0.10, "electricityPriceHigh": 0.12,
    "emissionFactorLow": 0.35, "emissionFactorMid": 0.40, "emissionFactorHigh": 0.45,
    "weeksPerSemester": 15, "semestersPerYear": 2,
}


def getOrCreate(cls):
    existing = c3.SavingsAssumptions.get("default")
    if existing is not None:
        return existing
    return c3.SavingsAssumptions.make(DEFAULTS).upsert()


def compute(this, freedHoursPerWeek):
    weeks = this.weeksPerSemester or 15
    sems = this.semestersPerYear or 2
    annual_hours = (freedHoursPerWeek or 0) * weeks * sems

    def mwh(kwh):
        return round(annual_hours * kwh / 1000.0, 2)

    def dollars(kwh, price):
        return round(annual_hours * kwh * price, 2)

    def co2_tons(kwh, factor):
        return round(annual_hours * kwh * factor / 1000.0, 2)

    return c3.SavingsResult.make({
        "freedHoursPerWeek": freedHoursPerWeek or 0,
        "mwhLow": mwh(this.kwhPerFreedHourLow),
        "mwhMid": mwh(this.kwhPerFreedHourMid),
        "mwhHigh": mwh(this.kwhPerFreedHourHigh),
        "dollarsLow": dollars(this.kwhPerFreedHourLow, this.electricityPriceLow),
        "dollarsMid": dollars(this.kwhPerFreedHourMid, this.electricityPriceMid),
        "dollarsHigh": dollars(this.kwhPerFreedHourHigh, this.electricityPriceHigh),
        "co2TonsLow": co2_tons(this.kwhPerFreedHourLow, this.emissionFactorLow),
        "co2TonsMid": co2_tons(this.kwhPerFreedHourMid, this.emissionFactorMid),
        "co2TonsHigh": co2_tons(this.kwhPerFreedHourHigh, this.emissionFactorHigh),
    })
