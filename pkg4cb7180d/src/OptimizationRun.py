import json

ALL_DAYS = ["M", "T", "W", "R", "F"]
DAY_LABELS = {"M": "Mon", "T": "Tue", "W": "Wed", "R": "Thu", "F": "Fri"}


def _is_cancelled(s):
    """Whether a section is cancelled, tolerant of the field not being provisioned yet.

    Section#cancelled is a newer field; until the live schema carries it, reading the attribute
    raises. Treating that as "not cancelled" is the correct default (nothing has been cancelled)
    and keeps the optimizer running either way.
    """
    try:
        return bool(s.cancelled)
    except Exception:
        return False


def _blocks(start_min, end_min, hour_start, hour_end):
    return [h for h in range(hour_start, hour_end)
            if start_min < (h + 1) * 60 and end_min > h * 60]


def runOptimization(cls, hourStart, hourEnd, maxOccupancyToEvacuate, days, excludeBuildings):
    hour_start = hourStart if hourStart else 7
    hour_end = hourEnd if hourEnd else 22
    max_occ = maxOccupancyToEvacuate if maxOccupancyToEvacuate else 2
    day_set = [d for d in (days or ALL_DAYS) if d in ALL_DAYS] or list(ALL_DAYS)
    excluded = set(excludeBuildings or [])

    # ---- Load data ----
    sections = c3.Section.fetch(spec={
        "include": "id,subject,number,section,crn,sectionType,days,startMin,endMin,"
                   "startTime,endTime,movable,cancelled,room.id,room.building.id,"
                   "room.building.isSpecialtyVenue",
        "limit": -1,
    }).objs
    # Cancelled sections are out of the plan entirely: they neither occupy a
    # building-hour nor need a room, so the optimizer must not see them.
    sections = [s for s in sections if not _is_cancelled(s)]
    rooms = c3.Room.fetch(spec={
        "include": "id,typesHosted,building.id", "limit": -1}).objs
    buildings = [b.id for b in c3.Building.fetch(spec={"include": "id", "limit": -1}).objs]

    room_building = {}
    room_types = {}
    for r in rooms:
        room_building[r.id] = r.building.id
        room_types[r.id] = set(r.typesHosted or [])

    # ---- Build in-memory occupancy model ----
    bld_occ = {}        # (building, day, hour) -> count
    room_sched = {}     # (room, day) -> list of (start, end)
    secs = []
    for s in sections:
        room = s.room
        if room is None:
            continue
        bld = room.building.id
        sdays = [d for d in (s.days or "") if d in day_set]
        blks = _blocks(s.startMin, s.endMin, hour_start, hour_end)
        if not sdays or not blks:
            # still record occupancy for days outside the model? Only model selected days.
            pass
        rec = {
            "id": s.id, "b": bld, "room": room.id, "days": sdays, "blks": blks,
            "sm": s.startMin, "em": s.endMin, "typ": s.sectionType,
            "movable": bool(s.movable),
            "specialty": bool(room.building.isSpecialtyVenue),
            "course": (s.subject or "") + " " + (s.number or ""),
            "sectionLabel": s.section, "startTime": s.startTime, "endTime": s.endTime,
            "daysRaw": s.days,
        }
        secs.append(rec)
        for d in sdays:
            for h in blks:
                k = (bld, d, h)
                bld_occ[k] = bld_occ.get(k, 0) + 1
            rk = (room.id, d)
            room_sched.setdefault(rk, []).append((s.startMin, s.endMin))

    # Full-week baseline occupancy, captured before any relocation. The greedy loop below
    # rewrites each record's building in place, so this cannot be derived afterwards; and it
    # deliberately spans all days and hours 7..22 rather than this run's window, so a run
    # scoped to one day still leaves a consistent baseline for the rest of the week.
    base_occ = {}
    for s in sections:
        if s.room is None:
            continue
        sb = s.room.building.id
        for d in (s.days or ""):
            if d not in ALL_DAYS:
                continue
            for h in _blocks(s.startMin, s.endMin, 7, 22):
                bk = (sb, d, h)
                base_occ[bk] = base_occ.get(bk, 0) + 1

    def cells(rec):
        return [(d, h) for d in rec["days"] for h in rec["blks"]]

    def bld_total(b, cs):
        return sum(bld_occ.get((b, d, h), 0) for (d, h) in cs)

    def empty_count():
        c = 0
        for b in buildings:
            for d in day_set:
                for h in range(hour_start, hour_end):
                    if bld_occ.get((b, d, h), 0) == 0:
                        c += 1
        return c

    before = empty_count()

    # ---- Candidate selection ----
    candidates = []
    for rec in secs:
        if not rec["movable"] or rec["specialty"]:
            continue
        if rec["b"] in excluded:
            continue
        cs = cells(rec)
        if not cs:
            continue
        if all(bld_occ.get((rec["b"], d, h), 0) <= max_occ for (d, h) in cs):
            candidates.append(rec)
    candidates.sort(key=lambda r: bld_total(r["b"], cells(r)))

    def overlaps(sched, sm, em):
        for (a, b) in sched:
            if sm < b and em > a:
                return True
        return False

    # ---- Greedy relocation ----
    moves = []
    for rec in candidates:
        cs = cells(rec)
        src = rec["b"]
        best = None
        best_busy = -1
        for room_id, types in room_types.items():
            tb = room_building[room_id]
            if tb == src or tb in excluded:
                continue
            if rec["typ"] not in types:
                continue
            # target building already running in every touched block
            if not all(bld_occ.get((tb, d, h), 0) >= 1 for (d, h) in cs):
                continue
            # room free on each day for the time span
            free = True
            for d in rec["days"]:
                if overlaps(room_sched.get((room_id, d), []), rec["sm"], rec["em"]):
                    free = False
                    break
            if not free:
                continue
            busy = bld_total(tb, cs)
            if busy > best_busy:
                best_busy = busy
                best = room_id
        if best is None:
            continue
        tb = room_building[best]
        freed = sum(1 for (d, h) in cs if bld_occ.get((src, d, h), 0) == 1)
        # apply
        for d in rec["days"]:
            for h in rec["blks"]:
                bld_occ[(src, d, h)] = bld_occ.get((src, d, h), 0) - 1
                bld_occ[(tb, d, h)] = bld_occ.get((tb, d, h), 0) + 1
            src_sched = room_sched.get((rec["room"], d), [])
            if (rec["sm"], rec["em"]) in src_sched:
                src_sched.remove((rec["sm"], rec["em"]))
            room_sched.setdefault((best, d), []).append((rec["sm"], rec["em"]))
        moves.append({
            "section": rec["id"], "fromRoom": rec["room"], "toRoom": best,
            "freed": freed, "course": rec["course"].strip(),
            "sectionLabel": rec["sectionLabel"], "typ": rec["typ"],
            "days": rec["daysRaw"],
            "timeLabel": (rec["startTime"] or "") + " - " + (rec["endTime"] or ""),
        })
        rec["b"] = tb
        rec["room"] = best

    after = empty_count()

    # ---- Persist ----
    run_id = "run_" + c3.DateTime.now().toString().replace(":", "").replace("-", "").replace(".", "")
    params = {
        "hourStart": hour_start, "hourEnd": hour_end,
        "maxOccupancyToEvacuate": max_occ, "days": day_set,
        "excludeBuildings": sorted(excluded),
    }
    run = c3.OptimizationRun.make({
        "id": run_id,
        "timestamp": c3.DateTime.now(),
        "paramsJson": json.dumps(params),
        "emptyHoursBefore": before,
        "emptyHoursAfter": after,
        "movesCount": len(moves),
    }).create()

    # Clear prior recommendations, then create new ones (default accepted so KPIs show the
    # full optimized scenario out of the box; the Moves page can reject individual moves).
    try:
        c3.MoveRecommendation.removeAll(spec=c3.RemoveAllSpec.make({"filter": "exists(id)"}))
    except Exception:
        existing = c3.MoveRecommendation.fetch(spec={"include": "id", "limit": -1}).objs
        if existing:
            c3.MoveRecommendation.removeBatch([c3.MoveRecommendation.make({"id": m.id}) for m in existing])

    move_objs = []
    for m in moves:
        move_objs.append(c3.MoveRecommendation.make({
            "section": {"id": m["section"]},
            "fromRoom": {"id": m["fromRoom"]},
            "toRoom": {"id": m["toRoom"]},
            "buildingHoursFreed": m["freed"],
            "status": "accepted",
            "optimizationRun": {"id": run_id},
            "courseLabel": m["course"],
            "sectionLabel": m["sectionLabel"],
            "typeCode": m["typ"],
            "days": m["days"],
            "timeLabel": m["timeLabel"],
        }))
    _batch_create(c3.MoveRecommendation, move_objs)

    # Rewrite both occupancy columns.
    #
    # sectionsCurrent is recomputed over the whole week from the sections that are still in the
    # plan, which is what makes a cancellation show up on the "Today" map rather than only in the
    # optimized view. It is derived independently of this run's day/hour window, since a run
    # scoped to (say) Fridays must not leave the rest of the week stale.
    #
    # sectionsOptimized is the post-move occupancy inside the window, and the same recomputed
    # baseline outside it.
    bh_updates = []
    bhs = c3.BuildingHour.fetch(spec={
        "include": "id,building.id,day,hour", "limit": -1}).objs
    for bh in bhs:
        b = bh.building.id
        d = bh.day
        h = bh.hour
        cur = base_occ.get((b, d, h), 0)
        if d in day_set and hour_start <= h < hour_end:
            opt = bld_occ.get((b, d, h), 0)
        else:
            opt = cur
        bh_updates.append(c3.BuildingHour.make({
            "id": bh.id, "sectionsCurrent": cur, "sectionsOptimized": opt}))
    _batch_merge(c3.BuildingHour, bh_updates)

    return run


def _batch_create(typ, objs, size=1000):
    for i in range(0, len(objs), size):
        typ.createBatch(objs[i:i + size])


def _batch_merge(typ, objs, size=1000):
    for i in range(0, len(objs), size):
        typ.mergeBatch(objs[i:i + size])


def latest(cls):
    res = c3.OptimizationRun.fetch(spec={
        "include": "this", "order": "descending(timestamp)", "limit": 1}).objs
    return res[0] if res else None


def overviewStats(cls):
    run = c3.OptimizationRun.latest()
    assumptions = c3.SavingsAssumptions.getOrCreate()

    if run is None:
        empty_before = c3.BuildingHour.fetchCount(spec={"filter": "sectionsCurrent==0"})
        savings = assumptions.compute(0)
        by_weekday = _weekday_stats()
        return c3.OverviewStats.make({
            "emptyBefore": empty_before, "emptyAfter": empty_before,
            "freedHoursPerWeek": 0, "movesCount": 0, "acceptedCount": 0,
            "runId": None, "byWeekday": by_weekday, "savings": savings,
        })

    accepted = c3.MoveRecommendation.fetch(spec={
        "include": "buildingHoursFreed", "filter": "status=='accepted'", "limit": -1}).objs
    accepted_count = len(accepted)
    freed = sum(m.buildingHoursFreed or 0 for m in accepted)
    empty_before = run.emptyHoursBefore
    empty_after = empty_before + freed

    savings = assumptions.compute(freed)
    by_weekday = _weekday_stats()

    return c3.OverviewStats.make({
        "emptyBefore": empty_before,
        "emptyAfter": empty_after,
        "freedHoursPerWeek": freed,
        "movesCount": run.movesCount,
        "acceptedCount": accepted_count,
        "runId": run.id,
        "byWeekday": by_weekday,
        "savings": savings,
    })


def _weekday_stats():
    stats = []
    for d in ALL_DAYS:
        cur = c3.BuildingHour.fetchCount(spec={"filter": "day=='" + d + "' && sectionsCurrent==0"})
        opt = c3.BuildingHour.fetchCount(spec={"filter": "day=='" + d + "' && sectionsOptimized==0"})
        stats.append(c3.WeekdayStat.make({
            "day": d, "label": DAY_LABELS[d], "current": cur, "optimized": opt}))
    return stats


# --------------------------------------------------------------------------
# scenario presets
# --------------------------------------------------------------------------

# Each preset is nothing more than a different set of bounds for runOptimization, so a scenario is
# never a separate code path or a canned figure. Tuple: (label, hourStart, hourEnd, maxOcc, days).
PRESETS = {
    "allDay": ("All day", 7, 22, 2, None),
    "evenings": ("Evenings only (after 4pm)", 16, 22, 2, None),
    "fridays": ("Fridays only", 7, 22, 2, ["F"]),
    "conservative": ("Conservative", 7, 22, 1, None),
    "aggressive": ("Aggressive", 7, 22, 4, None),
}


def runScenario(cls, name):
    key = name if name in PRESETS else "allDay"
    label, h0, h1, max_occ, days = PRESETS[key]
    run = c3.OptimizationRun.runOptimization(h0, h1, max_occ, days, None)
    return _scenario_result(key, label, run)


def rerunCurrent(cls):
    prev = c3.OptimizationRun.latest()
    h0, h1, max_occ, days = 7, 22, 2, None
    key = "allDay"
    if prev is not None and prev.paramsJson:
        try:
            p = json.loads(prev.paramsJson)
            h0 = p.get("hourStart") or 7
            h1 = p.get("hourEnd") or 22
            max_occ = p.get("maxOccupancyToEvacuate") or 2
            days = p.get("days") or None
            if days and len(days) == len(ALL_DAYS):
                days = None
            key = _preset_key(h0, h1, max_occ, days)
        except Exception:
            pass
    run = c3.OptimizationRun.runOptimization(h0, h1, max_occ, days, None)
    return _scenario_result(key, PRESETS[key][0], run)


def _preset_key(h0, h1, max_occ, days):
    """Which preset a set of bounds corresponds to, so a re-run keeps the user's chip selected."""
    for k, (_label, p0, p1, pm, pd) in PRESETS.items():
        if p0 == h0 and p1 == h1 and pm == max_occ and (pd or None) == (days or None):
            return k
    return "allDay"


def _scenario_result(key, label, run):
    """Headline figures for a completed run, read back from the occupancy table.

    Everything here is derived from BuildingHour, which the run has just rewritten, so the KPI row,
    the map colouring and this sentence are all reading the same numbers by construction. Money and
    emissions always come through SavingsAssumptions.
    """
    bhs = c3.BuildingHour.fetch(spec={
        "include": "building.id, sectionsCurrent, sectionsOptimized", "limit": -1}).objs

    freed = 0
    wasteful_cur = 0
    wasteful_opt = 0
    powered_down = set()
    for bh in bhs:
        cur = bh.sectionsCurrent or 0
        opt = bh.sectionsOptimized or 0
        if cur > 0 and opt == 0:
            freed += 1
            powered_down.add(bh.building.id)
        if cur == 1 or cur == 2:
            wasteful_cur += 1
        if opt == 1 or opt == 2:
            wasteful_opt += 1

    total_buildings = c3.Building.fetchCount()
    savings = c3.SavingsAssumptions.getOrCreate().compute(freed)
    n = len(powered_down)

    sentence = (label + ": " + str(n)
                + (" building powers" if n == 1 else " buildings power")
                + " down earlier, " + _money(savings.dollarsMid) + "/yr.")

    return c3.ScenarioResult.make({
        "name": key,
        "label": label,
        "buildingsPoweredDown": n,
        "totalBuildings": total_buildings,
        "freedHoursPerWeek": freed,
        "movesCount": run.movesCount if run is not None else 0,
        "wastefulCurrent": wasteful_cur,
        "wastefulOptimized": wasteful_opt,
        "dollarsLow": savings.dollarsLow,
        "dollarsMid": savings.dollarsMid,
        "dollarsHigh": savings.dollarsHigh,
        "co2TonsMid": savings.co2TonsMid,
        "mwhMid": savings.mwhMid,
        "sentence": sentence,
        "runId": run.id if run is not None else None,
    })


def _money(amount):
    a = float(amount or 0)
    if a >= 1000000:
        return "$" + str(round(a / 1000000.0, 1)) + "M"
    if a >= 1000:
        return "$" + str(int(round(a / 1000.0))) + "K"
    return "$" + str(int(round(a)))
