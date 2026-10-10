ALL_DAYS = ["M", "T", "W", "R", "F"]
HOUR_START = 7
HOUR_END = 22  # exclusive; blocks are 7..21


def _is_cancelled(s):
    """Section#cancelled, tolerant of the field not being provisioned yet (treated as not cancelled)."""
    try:
        return bool(s.cancelled)
    except Exception:
        return False


def _overlaps(sched, h):
    """True when any (startMin, endMin) in sched overlaps the hour block [h:00, h+1:00)."""
    lo = h * 60
    hi = (h + 1) * 60
    for (s, e) in sched:
        if s < hi and e > lo:
            return True
    return False


def _hour12(h):
    """Format a 24-hour integer hour as a 12-hour clock label, e.g. 7 -> '7 AM', 14 -> '2 PM'."""
    suffix = "AM" if h < 12 else "PM"
    base = h % 12
    if base == 0:
        base = 12
    return str(base) + " " + suffix


def findStudySpots(cls, day, hour, scenario):
    # ---- 1. Normalize / validate inputs ----
    if day not in ALL_DAYS:
        return []
    if hour is None or hour < HOUR_START or hour > HOUR_END - 1:
        return []
    scen = scenario if scenario else "optimized"

    # ---- 2. Which buildings are already "on" this block, and how busy ----
    bhs = c3.BuildingHour.fetch(spec={
        "include": "building.id,day,hour,sectionsCurrent,sectionsOptimized",
        "filter": "day == '" + day + "' && hour == " + str(hour),
        "limit": -1,
    }).objs
    building_on = {}
    for bh in bhs:
        if bh.building is None:
            continue
        count = bh.sectionsOptimized if scen == "optimized" else bh.sectionsCurrent
        count = count or 0
        if count >= 1:
            building_on[bh.building.id] = count
    if not building_on:
        return []

    # ---- 3. Rooms in those "on" buildings ----
    rooms = c3.Room.fetch(spec={
        "include": "id,roomName,typesHosted,building.id", "limit": -1}).objs
    rooms = [r for r in rooms if r.building is not None and r.building.id in building_on]
    if not rooms:
        return []

    # ---- 4. Current room schedules for the selected weekday ----
    sections = c3.Section.fetch(spec={
        "include": "id,days,startMin,endMin,cancelled,room.id", "limit": -1}).objs
    sec_info = {}        # section_id -> (startMin, endMin, days, room_id)
    room_sched = {}      # room_id -> [(startMin, endMin), ...] meeting on `day`
    for s in sections:
        if _is_cancelled(s):
            continue     # out of the plan: its room counts as free
        room_id = s.room.id if s.room is not None else None
        sec_info[s.id] = (s.startMin, s.endMin, s.days or "", room_id)
        if room_id is not None and day in (s.days or ""):
            room_sched.setdefault(room_id, []).append((s.startMin, s.endMin))

    # ---- 5. Apply accepted moves so emptiness reflects the optimized plan ----
    if scen == "optimized":
        moves = c3.MoveRecommendation.fetch(spec={
            "include": "section.id,fromRoom.id,toRoom.id",
            "filter": "status == 'accepted'",
            "limit": -1,
        }).objs
        for m in moves:
            if m.section is None or m.fromRoom is None or m.toRoom is None:
                continue
            info = sec_info.get(m.section.id)
            if info is None:
                continue
            start_min, end_min, s_days, _ = info
            if day not in s_days:
                continue
            frm = room_sched.get(m.fromRoom.id)
            if frm is not None and (start_min, end_min) in frm:
                frm.remove((start_min, end_min))
            room_sched.setdefault(m.toRoom.id, []).append((start_min, end_min))

    # ---- 6/7/8. Build study spots for empty rooms ----
    spots = []
    for r in rooms:
        sched = room_sched.get(r.id, [])
        if _overlaps(sched, hour):
            continue  # a class meets here this block — not empty

        # consecutive class-free blocks starting at `hour`
        free_hours = 0
        h = hour
        while h < HOUR_END and not _overlaps(sched, h):
            free_hours += 1
            h += 1

        next_h = hour + free_hours
        if next_h >= HOUR_END:
            free_until = "free rest of day"
        else:
            free_until = "free until " + _hour12(next_h)

        spots.append(c3.StudySpot.make({
            "roomId": r.id,
            "roomName": r.roomName,
            "building": r.building.id,
            "buildingSections": building_on[r.building.id],
            "roomTypes": r.typesHosted or [],
            "freeHours": free_hours,
            "freeUntilLabel": free_until,
        }))

    # ---- 10. Rank: quietest-but-occupied building first, then longest availability ----
    spots.sort(key=lambda sp: (sp.buildingSections, -sp.freeHours, sp.roomId))
    return spots
