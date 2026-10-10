import json

DAY_LABELS = {"M": "Monday", "T": "Tuesday", "W": "Wednesday", "R": "Thursday", "F": "Friday"}

LLM_CONFIG_KEY = "default-completions"


def _fmt_money(n):
    try:
        n = float(n or 0)
    except Exception:
        return "$0"
    if abs(n) >= 1_000_000:
        return "${:.2f}M".format(n / 1_000_000)
    if abs(n) >= 1_000:
        return "${:.1f}K".format(n / 1_000)
    return "${:,.0f}".format(n)


def _grounding(cls):
    """Assemble factual context from the loaded data + latest run + assumptions."""
    stats = c3.OptimizationRun.overviewStats()
    a = c3.SavingsAssumptions.getOrCreate()

    sections = c3.Section.fetchCount(spec={})
    rooms = c3.Room.fetchCount(spec={})
    buildings = c3.Building.fetchCount(spec={})

    # Buildings that give up / receive the most sections (accepted moves only).
    out_counts = {}
    in_counts = {}
    moves = c3.MoveRecommendation.fetch(spec={
        "include": "fromRoom.building.id,toRoom.building.id,buildingHoursFreed,status",
        "filter": "status=='accepted'",
        "limit": -1,
    }).objs
    for m in moves:
        try:
            fb = m.fromRoom.building.id
            out_counts[fb] = out_counts.get(fb, 0) + 1
        except Exception:
            pass
        try:
            tb = m.toRoom.building.id
            in_counts[tb] = in_counts.get(tb, 0) + 1
        except Exception:
            pass
    top_out = sorted(out_counts.items(), key=lambda kv: -kv[1])[:5]
    top_in = sorted(in_counts.items(), key=lambda kv: -kv[1])[:5]

    weekdays = []
    emptiest = None
    best_gain = None
    for w in (stats.byWeekday or []):
        gain = (w.optimized or 0) - (w.current or 0)
        weekdays.append({
            "day": DAY_LABELS.get(w.day, w.day),
            "current": w.current or 0,
            "optimized": w.optimized or 0,
            "gain": gain,
        })
        if emptiest is None or (w.optimized or 0) > emptiest["optimized"]:
            emptiest = {"day": DAY_LABELS.get(w.day, w.day), "optimized": w.optimized or 0}
        if best_gain is None or gain > best_gain["gain"]:
            best_gain = {"day": DAY_LABELS.get(w.day, w.day), "gain": gain}

    sav = stats.savings
    return {
        "sections": sections,
        "rooms": rooms,
        "buildings": buildings,
        "emptyBefore": stats.emptyBefore,
        "emptyAfter": stats.emptyAfter,
        "freedHoursPerWeek": stats.freedHoursPerWeek,
        "movesCount": stats.movesCount,
        "acceptedCount": stats.acceptedCount,
        "weekdays": weekdays,
        "emptiest": emptiest,
        "bestGain": best_gain,
        "topOut": top_out,
        "topIn": top_in,
        "savings": {
            "mwhLow": sav.mwhLow, "mwhMid": sav.mwhMid, "mwhHigh": sav.mwhHigh,
            "dollarsLow": sav.dollarsLow, "dollarsMid": sav.dollarsMid, "dollarsHigh": sav.dollarsHigh,
            "co2Low": sav.co2TonsLow, "co2Mid": sav.co2TonsMid, "co2High": sav.co2TonsHigh,
        },
        "assumptions": {
            "kwh": [a.kwhPerFreedHourLow, a.kwhPerFreedHourMid, a.kwhPerFreedHourHigh],
            "price": [a.electricityPriceLow, a.electricityPriceMid, a.electricityPriceHigh],
            "co2": [a.emissionFactorLow, a.emissionFactorMid, a.emissionFactorHigh],
            "weeks": a.weeksPerSemester,
            "semesters": a.semestersPerYear,
        },
    }


def _context_text(g):
    wk = "\n".join(
        "  - {day}: {current} empty now -> {optimized} after optimization (+{gain})".format(**w)
        for w in g["weekdays"]
    )
    top_out = ", ".join("{} ({} sections out)".format(b, n) for b, n in g["topOut"]) or "n/a"
    top_in = ", ".join("{} ({} sections in)".format(b, n) for b, n in g["topIn"]) or "n/a"
    sav = g["savings"]
    asm = g["assumptions"]
    return (
        "CAMPUS ENERGY OPTIMIZER — GROUNDING FACTS (UIUC Fall 2026)\n"
        "Schedule: {sections} sections across {buildings} buildings and {rooms} rooms.\n"
        "Optimizer relocates movable sections into already-busy buildings WITHOUT changing "
        "any class meeting day or time (room changes only).\n\n"
        "Latest optimization run:\n"
        "  - Empty building-hours per week: {emptyBefore} (current) -> {emptyAfter} (optimized)\n"
        "  - Building-hours freed per week: {freed}\n"
        "  - Moves: {accepted} accepted of {total} proposed\n\n"
        "Empty building-hours by weekday:\n{wk}\n"
        "  - Emptiest weekday after optimization: {emptiest} ({emptiest_n} empty building-hours)\n"
        "  - Biggest improvement: {bestgain} (+{bestgain_n})\n\n"
        "Buildings giving up the most sections: {top_out}\n"
        "Buildings receiving the most sections: {top_in}\n\n"
        "Annualized savings (low / mid / high):\n"
        "  - Energy: {mwhL} / {mwhM} / {mwhH} MWh per year\n"
        "  - Cost: {dL} / {dM} / {dH} per year\n"
        "  - CO2 avoided: {cL} / {cM} / {cH} metric tons per year\n\n"
        "Savings assumptions (low/mid/high): energy per freed building-hour "
        "{kwh} kWh; electricity price {price} $/kWh; emission factor {co2} kg CO2/kWh; "
        "{weeks} weeks/semester; {sem} semesters/year. "
        "Savings assume classroom-zone HVAC setback over each freed building-hour."
    ).format(
        sections=g["sections"], buildings=g["buildings"], rooms=g["rooms"],
        emptyBefore=g["emptyBefore"], emptyAfter=g["emptyAfter"], freed=g["freedHoursPerWeek"],
        accepted=g["acceptedCount"], total=g["movesCount"], wk=wk,
        emptiest=g["emptiest"]["day"] if g["emptiest"] else "n/a",
        emptiest_n=g["emptiest"]["optimized"] if g["emptiest"] else 0,
        bestgain=g["bestGain"]["day"] if g["bestGain"] else "n/a",
        bestgain_n=g["bestGain"]["gain"] if g["bestGain"] else 0,
        top_out=top_out, top_in=top_in,
        mwhL=sav["mwhLow"], mwhM=sav["mwhMid"], mwhH=sav["mwhHigh"],
        dL=_fmt_money(sav["dollarsLow"]), dM=_fmt_money(sav["dollarsMid"]), dH=_fmt_money(sav["dollarsHigh"]),
        cL=sav["co2Low"], cM=sav["co2Mid"], cH=sav["co2High"],
        kwh="/".join(str(x) for x in asm["kwh"]),
        price="/".join(str(x) for x in asm["price"]),
        co2="/".join(str(x) for x in asm["co2"]),
        weeks=asm["weeks"], sem=asm["semesters"],
    )


def _fallback(question, g):
    """Deterministic grounded answer when no LLM is reachable."""
    q = (question or "").lower()
    sav = g["savings"]
    if any(k in q for k in ["weekday", "day", "emptiest", "most empty", "friday"]):
        e = g["emptiest"]
        bg = g["bestGain"]
        return (
            "After optimization, {day} has the most empty building-hours ({n} per the "
            "selected hour window). The biggest improvement over the current schedule is on "
            "{bgday} (+{bg} empty building-hours)."
        ).format(day=e["day"], n=e["optimized"], bgday=bg["day"], bg=bg["gain"])
    if any(k in q for k in ["assumption", "drive", "how is", "calculated", "co2", "carbon", "factor", "price"]):
        asm = g["assumptions"]
        return (
            "Cost and CO2 savings come from the editable savings assumptions. For each freed "
            "building-hour we assume {kwh} kWh of avoided energy (low/mid/high), valued at "
            "{price} $/kWh, emitting {co2} kg CO2/kWh. Freed building-hours per week ({freed}) "
            "are annualized over {weeks} weeks/semester x {sem} semesters/year. At the mid case "
            "that is {mwh} MWh, {dollars}, and {ctons} metric tons of CO2 avoided per year."
        ).format(
            kwh="/".join(str(x) for x in asm["kwh"]),
            price="/".join(str(x) for x in asm["price"]),
            co2="/".join(str(x) for x in asm["co2"]),
            freed=g["freedHoursPerWeek"], weeks=asm["weeks"], sem=asm["semesters"],
            mwh=sav["mwhMid"], dollars=_fmt_money(sav["dollarsMid"]), ctons=sav["co2Mid"],
        )
    if any(k in q for k in ["building", "give up", "vacate", "empty out", "which room", "relocate"]):
        top = ", ".join("{} ({})".format(b, n) for b, n in g["topOut"]) or "no buildings"
        return (
            "The buildings giving up the most sections in the optimized plan are: {top}. "
            "Their sections are absorbed by already-busy buildings so those donors can go fully "
            "dark for whole hour blocks."
        ).format(top=top)
    # Default: headline freed-hours + savings
    return (
        "The latest optimization frees {freed} building-hours per week (empty building-hours "
        "rise from {before} to {after}) by relocating {accepted} movable sections without "
        "changing any class day or time. Annualized, that is about {mwh} MWh, {dollars}, and "
        "{ctons} metric tons of CO2 avoided per year at the mid-case assumptions (ranges: "
        "{mwhL}-{mwhH} MWh, {dL}-{dH}, {cL}-{cH} tons)."
    ).format(
        freed=g["freedHoursPerWeek"], before=g["emptyBefore"], after=g["emptyAfter"],
        accepted=g["acceptedCount"], mwh=sav["mwhMid"], dollars=_fmt_money(sav["dollarsMid"]),
        ctons=sav["co2Mid"], mwhL=sav["mwhLow"], mwhH=sav["mwhHigh"],
        dL=_fmt_money(sav["dollarsLow"]), dH=_fmt_money(sav["dollarsHigh"]),
        cL=sav["co2Low"], cH=sav["co2High"],
    )


def ask(cls, question):
    if not question or not question.strip():
        return "Ask me about the schedule, freed building-hours, savings, or which buildings are affected."

    g = _grounding(cls)
    context = _context_text(g)

    system = (
        "You are the Campus Energy Optimizer assistant for UIUC Facilities energy managers. "
        "Answer ONLY using the grounding facts provided. Be concise (2-4 sentences), concrete, "
        "and always cite the relevant numbers. If the facts do not contain the answer, say so and "
        "point the user to the Overview or Heatmap screen. Never invent figures."
    )
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": context + "\n\nQUESTION: " + question.strip()},
    ]

    try:
        client = c3.GenaiCore.Llm.Completion.Client.forConfigKey(LLM_CONFIG_KEY)
        resp = client.completion(messages=messages, options={"returnJson": True})
        if isinstance(resp, str):
            resp = json.loads(resp)
        content = resp["choices"][0]["message"]["content"]
        if content and content.strip():
            return content.strip()
    except Exception:
        pass

    return _fallback(question, g)
