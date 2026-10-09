import json

ALL_DAYS = ["M", "T", "W", "R", "F"]
DAY_LABELS = {"M": "Mon", "T": "Tue", "W": "Wed", "R": "Thu", "F": "Fri"}


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
                   "startTime,endTime,movable,room.id,room.building.id,"
                   "room.building.isSpecialtyVenue",
        "limit": -1,
    }).objs
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

    # Update BuildingHour.sectionsOptimized with final occupancy (only touched days/hours
    # change; others are reset to their current baseline to stay consistent).
    bh_updates = []
    bhs = c3.BuildingHour.fetch(spec={
        "include": "id,building.id,day,hour,sectionsCurrent", "limit": -1}).objs
    for bh in bhs:
        b = bh.building.id
        d = bh.day
        h = bh.hour
        if d in day_set and hour_start <= h < hour_end:
            opt = bld_occ.get((b, d, h), 0)
        else:
            opt = bh.sectionsCurrent
        bh_updates.append(c3.BuildingHour.make({"id": bh.id, "sectionsOptimized": opt}))
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
