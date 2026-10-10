"""Tool layer for the Block I/O agent.

Every function here reads live Building / Room / Section / BuildingHour /
MoveRecommendation records, or re-runs the existing optimizer. That is the whole
point: because the agent can only quote what these functions return, it cannot
invent a building, a room, a section, a time or a dollar figure.

The read tools have no side effects. The two simulation tools (cancelSections,
closeBuilding) work on an in-memory *copy* of the occupancy grid and never write
a BuildingHour row or change a saved MoveRecommendation.
"""
import json
import math
import urllib.parse
import urllib.request

ALL_DAYS = ["M", "T", "W", "R", "F"]
DAY_LABELS = {"M": "Mon", "T": "Tue", "W": "Wed", "R": "Thu", "F": "Fri"}
DAY_WORDS = {
    "monday": "M", "mon": "M", "tuesday": "T", "tue": "T", "tues": "T",
    "wednesday": "W", "wed": "W", "thursday": "R", "thu": "R", "thur": "R",
    "thurs": "R", "friday": "F", "fri": "F",
}
HOUR_START = 7
HOUR_END = 22  # exclusive; blocks are 7..21


def _is_cancelled(s):
    """Section#cancelled, tolerant of the field not being provisioned yet (treated as not cancelled)."""
    try:
        return bool(s.cancelled)
    except Exception:
        return False


def _geopoint(label, lat, lon, source, usually_packed=False, note=None):
    """Build a MapPin, tolerant of the live schema predating the usuallyPacked / note fields.

    MapPin is the clean replacement for the frozen built-in GeoPoint value type (see MapPin.c3typ).
    We try the full value first and fall back to the always-present label / lat / lon / source so
    locate() never throws mid-demo if usuallyPacked / note are not yet provisioned.
    """
    try:
        return c3.MapPin.make({
            "label": label, "lat": lat, "lon": lon, "source": source,
            "usuallyPacked": bool(usually_packed), "note": note,
        })
    except Exception:
        return c3.MapPin.make({
            "label": label, "lat": lat, "lon": lon, "source": source,
        })


def _geo_map():
    """{building_id: {"lat": float, "lon": float}} from BuildingGeo.

    Coordinates live in their own entity (see BuildingGeo) because Building.lat / Building.lon are
    not provisioned on the live schema. Everything geo-aware reads location through here.
    """
    out = {}
    for g in c3.BuildingGeo.fetch(spec={
            "include": "building, lat, lon", "limit": -1}).objs:
        if g.building is None:
            continue
        out[g.building] = {"lat": g.lat, "lon": g.lon}
    return out


# Walking model: straight-line distance scaled for the street grid, at a normal
# pace. Deliberately a transparent approximation rather than a routing call.
WALK_DETOUR = 1.3
WALK_SPEED_MPS = 1.3


# --------------------------------------------------------------------------
# formatting helpers
# --------------------------------------------------------------------------

def _overlaps(sched, h):
    """True when any (startMin, endMin) in sched overlaps block [h:00, h+1:00)."""
    lo = h * 60
    hi = (h + 1) * 60
    for (s, e) in sched:
        if s < hi and e > lo:
            return True
    return False


def _blocks(start_min, end_min):
    """The hour blocks in 7..21 that a meeting touches."""
    return [h for h in range(HOUR_START, HOUR_END)
            if start_min < (h + 1) * 60 and end_min > h * 60]


def _clock(minutes):
    """540 -> '9:00 AM'. Used for exact next-class times."""
    h = (minutes // 60) % 24
    m = minutes % 60
    suffix = "AM" if h < 12 else "PM"
    base = h % 12
    if base == 0:
        base = 12
    return str(base) + ":" + ("0" + str(m))[-2:] + " " + suffix


def _hshort(h):
    """15 -> '3pm'. Compact hour for setback window sentences."""
    suffix = "am" if h < 12 else "pm"
    base = h % 12
    if base == 0:
        base = 12
    return str(base) + suffix


def _room_type(types):
    """Plain-English room type from the section-type codes a room hosts."""
    ts = set(t for t in (types or []) if t)
    if "LEC" in ts:
        return "lecture hall"
    if ts & set(["LAB", "LBD", "L1", "L2", "L3", "L4", "L5"]):
        return "lab"
    if ts & set(["SEM", "CNF", "RES", "IND"]):
        return "seminar room"
    if ts & set(["ST", "PR"]):
        return "studio"
    return "classroom"


def _esc(text):
    """Escape a value for inclusion in a C3 filter string literal."""
    return str(text or "").replace("\\", "").replace("'", "")


def _money(amount):
    """204900.0 -> '$205K'. Compact money for one-line sentences."""
    a = float(amount or 0)
    if a >= 1000000:
        return "$" + str(round(a / 1000000.0, 1)) + "M"
    if a >= 1000:
        return "$" + str(int(round(a / 1000.0))) + "K"
    return "$" + str(int(round(a)))


# --------------------------------------------------------------------------
# the shared schedule model
# --------------------------------------------------------------------------

def _schedule(occ=True):
    """Load the live schedule once and build the occupancy model every tool shares.

    Returns a dict with:
      secs         list of flattened section records
      by_id        section id -> record
      room_bld     room id -> building name
      room_types   room id -> set of section-type codes it hosts
      room_name    room id -> room designator
      bld          building name -> {lat, lon, spw}
      base_occ     (building, day, hour) -> classes under today's schedule
      eff_occ      (building, day, hour) -> classes after APPROVED swaps only
      eff_room     section id -> room it meets in after approved swaps
      sched        (room id, day) -> [(startMin, endMin)] after approved swaps
    """
    sections = c3.Section.fetch(spec={
        "include": "id, subject, number, section, crn, sectionType, days, startMin, endMin, "
                   "startTime, endTime, movable, cancelled, room.id, room.building.id",
        "limit": -1,
    }).objs
    # A cancelled section is out of the plan: it occupies no building-hour and
    # frees its room. See Section#cancelled.
    sections = [s for s in sections if not _is_cancelled(s)]
    rooms = c3.Room.fetch(spec={
        "include": "id, roomName, typesHosted, building.id", "limit": -1}).objs
    buildings = c3.Building.fetch(spec={
        "include": "id, sectionsPerWeek, isSpecialtyVenue", "limit": -1}).objs
    geo = _geo_map()

    room_bld = {}
    room_types = {}
    room_name = {}
    for r in rooms:
        if r.building is None:
            continue
        room_bld[r.id] = r.building.id
        room_types[r.id] = set(r.typesHosted or [])
        room_name[r.id] = r.roomName

    bld = {}
    for b in buildings:
        g = geo.get(b.id) or {}
        bld[b.id] = {
            "lat": g.get("lat"), "lon": g.get("lon"),
            "spw": b.sectionsPerWeek or 0,
            "specialty": bool(b.isSpecialtyVenue),
        }

    secs = []
    by_id = {}
    for s in sections:
        if s.room is None or s.room.building is None:
            continue
        rec = {
            "id": s.id,
            "room": s.room.id,
            "bld": s.room.building.id,
            "days": [d for d in (s.days or "") if d in ALL_DAYS],
            "daysRaw": s.days or "",
            "sm": s.startMin or 0,
            "em": s.endMin or 0,
            "typ": s.sectionType or "",
            "movable": bool(s.movable),
            "course": ((s.subject or "") + " " + (s.number or "")).strip(),
            "sectionLabel": s.section or "",
            "crn": s.crn or "",
            "timeLabel": ((s.startTime or "") + " - " + (s.endTime or "")).strip(" -"),
        }
        rec["blks"] = _blocks(rec["sm"], rec["em"])
        secs.append(rec)
        by_id[s.id] = rec

    model = {
        "secs": secs, "by_id": by_id, "room_bld": room_bld, "room_types": room_types,
        "room_name": room_name, "bld": bld,
        "base_occ": {}, "eff_occ": {}, "eff_room": {}, "sched": {},
    }
    if not occ:
        return model

    # Where each section actually meets once approved swaps are applied. Only
    # 'accepted' moves count — the setback schedule must never promise hours the
    # user has not signed off on.
    moves = c3.MoveRecommendation.fetch(spec={
        "include": "section.id, toRoom.id, toRoom.building.id",
        "filter": "status == 'accepted'",
        "limit": -1,
    }).objs
    eff_room = {}
    for m in moves:
        if m.section is None or m.toRoom is None:
            continue
        eff_room[m.section.id] = m.toRoom.id

    base_occ = {}
    eff_occ = {}
    sched = {}
    for rec in secs:
        eff = eff_room.get(rec["id"], rec["room"])
        eff_b = room_bld.get(eff, rec["bld"])
        for d in rec["days"]:
            sched.setdefault((eff, d), []).append((rec["sm"], rec["em"]))
            for h in rec["blks"]:
                bk = (rec["bld"], d, h)
                base_occ[bk] = base_occ.get(bk, 0) + 1
                ek = (eff_b, d, h)
                eff_occ[ek] = eff_occ.get(ek, 0) + 1

    model["base_occ"] = base_occ
    model["eff_occ"] = eff_occ
    model["eff_room"] = eff_room
    model["sched"] = sched
    return model


def _windows_for(building, base_occ, eff_occ, days):
    """Merged runs of zero-class hours for one building.

    A weekday is skipped entirely when the building never had a class that day
    under today's schedule — it is already unused, so there is nothing to act
    on. A day whose classes all moved away under approved swaps *is* included,
    and every one of its hours counts as newly freed.
    """
    out = []
    for d in days:
        if not any(base_occ.get((building, d, h), 0) > 0 for h in range(HOUR_START, HOUR_END)):
            continue
        h = HOUR_START
        while h < HOUR_END:
            if eff_occ.get((building, d, h), 0) != 0:
                h += 1
                continue
            start = h
            newly = False
            while h < HOUR_END and eff_occ.get((building, d, h), 0) == 0:
                if base_occ.get((building, d, h), 0) > 0:
                    newly = True
                h += 1
            out.append((d, start, h, newly))
    return out


def _mk_window(building, d, start, end, newly):
    return c3.SetbackWindow.make({
        "building": building,
        "day": d,
        "dayLabel": DAY_LABELS.get(d, d),
        "startHour": start,
        "endHour": end,
        "hours": end - start,
        "label": DAY_LABELS.get(d, d) + " " + _hshort(start) + "-" + _hshort(end)
                 + ": no classes, safe to set back",
        "newlyFreed": bool(newly),
    })


def _dist_m(lat1, lon1, lat2, lon2):
    """Great-circle distance in metres."""
    r = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def _walk_min(lat1, lon1, lat2, lon2):
    if lat1 is None or lon1 is None or lat2 is None or lon2 is None:
        return -1
    metres = _dist_m(lat1, lon1, lat2, lon2) * WALK_DETOUR
    return max(1, int(round(metres / WALK_SPEED_MPS / 60.0)))


# --------------------------------------------------------------------------
# freeRooms
# --------------------------------------------------------------------------

def freeRooms(cls, day, hour, minDurationMin, near, maxWalkMin, limit):
    if day not in ALL_DAYS:
        return []
    if hour is None or hour < HOUR_START or hour > HOUR_END - 1:
        return []
    min_dur = minDurationMin or 0
    cap = limit if limit and limit > 0 else 40

    m = _schedule()
    eff_occ = m["eff_occ"]

    # Buildings already running this hour under the approved plan. This is the
    # energy rule: a room only qualifies if its building is heated and lit
    # anyway, so studying there adds nothing.
    on = {}
    for b in m["bld"]:
        c = eff_occ.get((b, day, hour), 0)
        if c >= 1:
            on[b] = c
    if not on:
        return []

    near_lat = near.lat if near is not None else None
    near_lon = near.lon if near is not None else None
    max_walk = maxWalkMin if maxWalkMin and maxWalkMin > 0 else 0

    out = []
    for room_id, b in m["room_bld"].items():
        if b not in on:
            continue
        room_sched = m["sched"].get((room_id, day), [])
        if _overlaps(room_sched, hour):
            continue  # a class meets here this block

        # Exact next-class start, so the card can say "free until 2:50 PM"
        # rather than rounding to an hour boundary.
        later = [s for (s, _e) in room_sched if s >= (hour + 1) * 60]
        if later:
            next_start = min(later)
            minutes_free = next_start - hour * 60
            free_until = "free until " + _clock(next_start)
        else:
            next_start = -1
            minutes_free = HOUR_END * 60 - hour * 60
            free_until = "free rest of day"
        if minutes_free < min_dur:
            continue

        meta = m["bld"].get(b) or {}
        walk = _walk_min(near_lat, near_lon, meta.get("lat"), meta.get("lon"))
        if max_walk and walk > 0 and walk > max_walk:
            continue

        out.append(c3.FreeRoom.make({
            "roomId": room_id,
            "roomName": m["room_name"].get(room_id) or room_id,
            "building": b,
            "roomType": _room_type(m["room_types"].get(room_id)),
            "buildingSections": on[b],
            "freeUntilMin": next_start,
            "freeUntilLabel": free_until,
            "minutesFree": minutes_free,
            "walkMinutes": walk,
            "lat": meta.get("lat"),
            "lon": meta.get("lon"),
        }))

    # Longest-free first, then nearest (unknown walks last), then quietest
    # building, then a stable id tiebreak.
    out.sort(key=lambda r: (-r.minutesFree,
                            r.walkMinutes if r.walkMinutes >= 0 else 999,
                            r.buildingSections, r.roomId))
    return out[:cap]


# --------------------------------------------------------------------------
# buildingStatus
# --------------------------------------------------------------------------

def buildingStatus(cls, building, day, hour):
    if not building:
        return None
    d = day if day in ALL_DAYS else "M"
    h = hour if (hour is not None and HOUR_START <= hour < HOUR_END) else 10

    m = _schedule()
    if building not in m["bld"]:
        return None

    base = m["base_occ"].get((building, d, h), 0)
    eff = m["eff_occ"].get((building, d, h), 0)

    in_session = []
    for rec in m["secs"]:
        eff_room = m["eff_room"].get(rec["id"], rec["room"])
        eff_b = m["room_bld"].get(eff_room, rec["bld"])
        here_today = rec["bld"] == building
        here_after = eff_b == building
        if not (here_today or here_after):
            continue
        if d not in rec["days"] or h not in rec["blks"]:
            continue
        in_session.append(c3.RoomSectionSlot.make({
            "sectionId": rec["id"],
            "courseLabel": rec["course"],
            "sectionLabel": rec["sectionLabel"],
            "typeCode": rec["typ"],
            "startMin": rec["sm"],
            "endMin": rec["em"],
            "timeLabel": rec["timeLabel"],
            "movedAway": bool(here_today and not here_after),
        }))
    in_session.sort(key=lambda s: (s.startMin, s.courseLabel))

    wins = _windows_for(building, m["base_occ"], m["eff_occ"], ALL_DAYS)
    win_objs = [_mk_window(building, wd, ws, we, wn) for (wd, ws, we, wn) in wins]

    if eff > 0:
        status = "running"
    elif base > 0:
        status = "poweredDown"
    else:
        status = "dark"

    # Plain English, as a sentence — the tooltip must read like prose.
    parts = [building]
    if base == 0:
        parts.append("no classes this hour")
    elif base == 1:
        parts.append("1 class now")
    else:
        parts.append(str(base) + " classes now")

    if status == "poweredDown":
        covering = [w for w in win_objs if w.day == d and w.startHour <= h < w.endHour]
        if covering:
            w = covering[0]
            parts.append("With Block I/O: powered down " + w.dayLabel + " "
                         + _hshort(w.startHour) + "-" + _hshort(w.endHour))
        else:
            parts.append("With Block I/O: powered down")
    elif status == "running":
        if eff == 1:
            parts.append("With Block I/O: still 1 class here")
        else:
            parts.append("With Block I/O: still " + str(eff) + " classes here")
    else:
        parts.append("already dark")

    return c3.BuildingStatusInfo.make({
        "building": building,
        "day": d,
        "hour": h,
        "sectionsNow": base,
        "sectionsWithBlockIo": eff,
        "status": status,
        "statusSentence": " · ".join(parts),
        "sectionsInSession": in_session,
        "setbackWindows": win_objs,
        "sectionsPerWeek": (m["bld"].get(building) or {}).get("spw") or 0,
        "lat": (m["bld"].get(building) or {}).get("lat"),
        "lon": (m["bld"].get(building) or {}).get("lon"),
    })


# --------------------------------------------------------------------------
# findSections
# --------------------------------------------------------------------------

TYPE_WORDS = {
    "lecture": ["LEC", "LCD"], "lec": ["LEC", "LCD"],
    "lab": ["LAB", "LBD"], "laboratory": ["LAB", "LBD"],
    "discussion": ["DIS"], "disc": ["DIS"], "section": ["DIS"],
    "seminar": ["SEM", "CNF"], "quiz": ["Q"], "studio": ["ST"],
}


def _mk_match(rec, room_name):
    return c3.SectionMatch.make({
        "id": rec["id"],
        "courseLabel": rec["course"],
        "sectionLabel": rec["sectionLabel"],
        "typeCode": rec["typ"],
        "days": rec["daysRaw"],
        "timeLabel": rec["timeLabel"],
        "startMin": rec["sm"],
        "endMin": rec["em"],
        "building": rec["bld"],
        "roomId": rec["room"],
        "roomName": room_name,
        "movable": rec["movable"],
    })


def findSections(cls, query, day, limit):
    q = (query or "").strip()
    if not q:
        return []
    cap = limit if limit and limit > 0 else 20
    low = q.lower()
    words = [w for w in ''.join(ch if ch.isalnum() else ' ' for ch in low).split() if w]

    m = _schedule(occ=False)

    # course code, e.g. "CS 225" / "cs225"
    subject = None
    number = None
    for i, w in enumerate(words):
        if w.isalpha() and 2 <= len(w) <= 4:
            if i + 1 < len(words) and words[i + 1].isdigit() and len(words[i + 1]) == 3:
                subject, number = w.upper(), words[i + 1]
                break
        if len(w) > 3 and w[:-3].isalpha() and w[-3:].isdigit():
            subject, number = w[:-3].upper(), w[-3:]
            break

    want_types = []
    for w in words:
        want_types.extend(TYPE_WORDS.get(w, []))

    want_day = day if day in ALL_DAYS else None
    if want_day is None:
        for w in words:
            if w in DAY_WORDS:
                want_day = DAY_WORDS[w]
                break

    crn = None
    for w in words:
        if w.isdigit() and len(w) == 5:
            crn = w
            break

    # building name mentioned in the query
    bld_hit = None
    for name in m["bld"]:
        nl = name.lower()
        if len(nl) > 4 and nl in low:
            if bld_hit is None or len(nl) > len(bld_hit.lower()):
                bld_hit = name

    scored = []
    for rec in m["secs"]:
        score = 0
        if subject and number:
            if rec["course"].upper() == subject + " " + number:
                score += 100
            elif rec["course"].upper().startswith(subject + " "):
                score += 20
            else:
                continue
        elif crn:
            if rec["crn"] == crn:
                score += 100
            else:
                continue
        elif bld_hit:
            if rec["bld"] == bld_hit:
                score += 60
            else:
                continue
        else:
            # last resort: the course label or room appears in the text
            cl = rec["course"].lower()
            if cl and cl in low:
                score += 40
            elif rec["room"].lower() in low:
                score += 40
            else:
                continue

        if want_types:
            if rec["typ"] in want_types:
                score += 30
            else:
                continue
        if want_day:
            if want_day in rec["days"]:
                score += 10
            else:
                continue
        scored.append((-score, rec["course"], rec["sectionLabel"], rec))

    scored.sort(key=lambda t: (t[0], t[1], t[2]))
    return [_mk_match(t[3], m["room_name"].get(t[3]["room"])) for t in scored[:cap]]


# --------------------------------------------------------------------------
# cancelSections  (simulation — never writes)
# --------------------------------------------------------------------------

def _savings_for(hours_per_week, annualize):
    """kWh / dollars / CO2 for freed hours, always via SavingsAssumptions."""
    a = c3.SavingsAssumptions.getOrCreate()
    if annualize:
        res = a.compute(hours_per_week)
        return (res.mwhMid * 1000.0, res.dollarsMid, res.co2TonsMid)
    kwh = (hours_per_week or 0) * (a.kwhPerFreedHourMid or 100.0)
    return (round(kwh, 2),
            round(kwh * (a.electricityPriceMid or 0.10), 2),
            round(kwh * (a.emissionFactorMid or 0.40) / 1000.0, 3))


def cancelSections(cls, sectionIds, scope, day):
    ids = [s for s in (sectionIds or []) if s]
    scp = "rest of term" if (scope or "").lower().startswith("rest") else "one day"
    m = _schedule()

    recs = [m["by_id"][i] for i in ids if i in m["by_id"]]
    if not recs:
        return c3.CancelImpact.make({
            "scope": scp, "scopeLabel": scp, "sectionIds": ids, "sections": [],
            "hoursFreed": 0, "buildings": [], "extraSwaps": 0,
            "kwh": 0.0, "dollars": 0.0, "co2Tons": 0.0, "annualized": scp == "rest of term",
            "summary": "I could not find those sections in the schedule, so there is nothing to simulate.",
        })

    # Which weekdays the cancellation covers.
    target_day = day if day in ALL_DAYS else None
    removal = []  # (rec, [days])
    for rec in recs:
        if target_day:
            days = [target_day] if target_day in rec["days"] else []
        elif scp == "one day":
            days = rec["days"][:1]
        else:
            days = list(rec["days"])
        if days:
            removal.append((rec, days))
    if not removal:
        label = DAY_LABELS.get(target_day, target_day or "")
        return c3.CancelImpact.make({
            "scope": scp, "scopeLabel": scp, "sectionIds": ids,
            "sections": [_mk_match(r, m["room_name"].get(r["room"])) for r in recs],
            "hoursFreed": 0, "buildings": [], "extraSwaps": 0,
            "kwh": 0.0, "dollars": 0.0, "co2Tons": 0.0, "annualized": scp == "rest of term",
            "summary": "Those sections do not meet on " + label + ", so nothing changes.",
        })

    # Simulate on a copy. The saved plan is untouched.
    sim_occ = dict(m["eff_occ"])
    sim_sched = {}
    for k, v in m["sched"].items():
        sim_sched[k] = list(v)

    removed_by_bld = {}
    touched = set()
    for (rec, days) in removal:
        eff_room = m["eff_room"].get(rec["id"], rec["room"])
        eff_b = m["room_bld"].get(eff_room, rec["bld"])
        removed_by_bld[eff_b] = removed_by_bld.get(eff_b, 0) + 1
        for d in days:
            lst = sim_sched.get((eff_room, d))
            if lst and (rec["sm"], rec["em"]) in lst:
                lst.remove((rec["sm"], rec["em"]))
            for h in rec["blks"]:
                k = (eff_b, d, h)
                sim_occ[k] = max(0, sim_occ.get(k, 0) - 1)
                touched.add(k)

    hours_freed = 0
    freed_by_bld = {}
    for k in touched:
        if sim_occ.get(k, 0) == 0 and m["eff_occ"].get(k, 0) > 0:
            hours_freed += 1
            freed_by_bld[k[0]] = freed_by_bld.get(k[0], 0) + 1

    # Per-building consequences.
    impacts = []
    affected = sorted(set(list(removed_by_bld.keys())),
                      key=lambda b: (-freed_by_bld.get(b, 0), b))
    for b in affected:
        before = _windows_for(b, m["base_occ"], m["eff_occ"], ALL_DAYS)
        after = _windows_for(b, m["base_occ"], sim_occ, ALL_DAYS)
        before_keys = set((d, s, e) for (d, s, e, _n) in before)
        new_wins = [w for w in after if (w[0], w[1], w[2]) not in before_keys]
        freed = freed_by_bld.get(b, 0)
        meta = m["bld"].get(b) or {}
        if freed > 0 and new_wins:
            w = new_wins[0]
            sentence = (b + " loses its last class in " + str(freed)
                        + (" hour" if freed == 1 else " hours")
                        + ", so it can set back " + DAY_LABELS.get(w[0], w[0]) + " "
                        + _hshort(w[1]) + "-" + _hshort(w[2]) + ".")
        elif freed > 0:
            sentence = (b + " frees " + str(freed)
                        + (" hour" if freed == 1 else " hours")
                        + ", extending a window it already had.")
        else:
            sentence = (b + " still has other classes in every hour, so its schedule does not change.")
        impacts.append(c3.BuildingImpact.make({
            "building": b,
            "hoursFreed": freed,
            "sectionsRemoved": removed_by_bld.get(b, 0),
            "canPowerDownEarlier": bool(freed > 0 and new_wins),
            "windows": [_mk_window(b, wd, ws, we, wn) for (wd, ws, we, wn) in new_wins],
            "sentence": sentence,
            "lat": meta.get("lat"),
            "lon": meta.get("lon"),
        }))

    extra = _extra_swaps(m, sim_occ, sim_sched, set(k[0] for k in touched),
                         set(k[1] for k in touched))

    kwh, dollars, co2 = _savings_for(hours_freed, scp == "rest of term")

    if scp == "one day":
        scope_label = "just this " + (DAY_LABELS.get(removal[0][1][0], "day"))
        basis = "for the day"
    else:
        scope_label = "every " + DAY_LABELS.get(removal[0][1][0], "week") + " for the rest of term"
        basis = "a year"

    courses = sorted(set(r["course"] for (r, _d) in removal))
    subject_txt = ", ".join(courses[:2]) + ("" if len(courses) <= 2 else " and others")
    if hours_freed:
        lead = [b.building for b in impacts if b.hoursFreed > 0][:2]
        where = " and ".join(lead) if lead else "the affected buildings"
        summary = ("Cancelling " + subject_txt + " frees " + str(hours_freed)
                   + (" building-hour" if hours_freed == 1 else " building-hours")
                   + " in " + where + " — about " + _money(dollars) + " " + basis + ".")
    else:
        summary = ("Cancelling " + subject_txt
                   + " does not empty any building: other classes are still in session in every hour it touches.")
    if extra:
        summary += (" It also unlocks " + str(extra)
                    + (" extra room swap." if extra == 1 else " extra room swaps."))

    return c3.CancelImpact.make({
        "scope": scp,
        "scopeLabel": scope_label,
        "sectionIds": [r["id"] for (r, _d) in removal],
        "sections": [_mk_match(r, m["room_name"].get(r["room"])) for (r, _d) in removal],
        "hoursFreed": hours_freed,
        "buildings": impacts,
        "extraSwaps": extra,
        "kwh": kwh,
        "dollars": dollars,
        "co2Tons": co2,
        "summary": summary,
        "annualized": scp == "rest of term",
    })


def _extra_swaps(m, sim_occ, sim_sched, blds, days):
    """Count additional room swaps that become possible in the touched buildings.

    This is the scoped equivalent of the main optimizer: only movable sections in
    buildings whose occupancy just dropped are reconsidered, and only against
    rooms in buildings already running at that exact day and hour.
    """
    if not blds:
        return 0
    count = 0
    for rec in m["secs"]:
        if not rec["movable"] or count >= 25:
            continue
        eff_room = m["eff_room"].get(rec["id"], rec["room"])
        src = m["room_bld"].get(eff_room, rec["bld"])
        if src not in blds:
            continue
        if rec["id"] in m["eff_room"]:
            continue  # already relocated by an approved swap
        cells = [(d, h) for d in rec["days"] if d in days for h in rec["blks"]]
        if not cells:
            continue
        if not all(sim_occ.get((src, d, h), 0) <= 2 for (d, h) in cells):
            continue
        placed = False
        for room_id, types in m["room_types"].items():
            tb = m["room_bld"].get(room_id)
            if tb is None or tb == src:
                continue
            if rec["typ"] not in types:
                continue
            if not all(sim_occ.get((tb, d, h), 0) >= 1 for (d, h) in cells):
                continue
            if any(_sched_busy(sim_sched.get((room_id, d), []), rec["sm"], rec["em"])
                   for d in rec["days"]):
                continue
            placed = True
            break
        if placed:
            count += 1
    return count


def _sched_busy(sched, sm, em):
    for (a, b) in sched:
        if sm < b and em > a:
            return True
    return False


def applyCancellation(cls, sectionIds):
    """Commit a cancellation: flag the sections, then recompute the whole plan."""
    ids = [s for s in (sectionIds or []) if s]
    if ids:
        clause = " || ".join("id == '" + _esc(i) + "'" for i in ids)
        found = c3.Section.fetch(spec={
            "include": "id", "filter": clause, "limit": -1}).objs
        if found:
            try:
                c3.Section.mergeBatch([
                    c3.Section.make({"id": s.id, "cancelled": True}) for s in found])
            except Exception:
                # Section#cancelled may not be provisioned on the live schema yet; the
                # re-run below still produces a valid plan, just without the flag persisted.
                pass
    return c3.OptimizationRun.rerunCurrent()


# --------------------------------------------------------------------------
# closeBuilding  (simulation — never writes)
# --------------------------------------------------------------------------

def closeBuilding(cls, building, days, hourStart, hourEnd):
    if not building:
        return None
    m = _schedule()
    if building not in m["bld"]:
        return None

    day_set = [d for d in (days or ALL_DAYS) if d in ALL_DAYS] or list(ALL_DAYS)
    h0 = hourStart if (hourStart is not None and hourStart >= HOUR_START) else HOUR_START
    h1 = hourEnd if (hourEnd is not None and hourEnd <= HOUR_END) else HOUR_END

    sim_occ = dict(m["eff_occ"])
    sim_sched = {}
    for k, v in m["sched"].items():
        sim_sched[k] = list(v)

    # Sections meeting in the building inside the closure window.
    affected = []
    for rec in m["secs"]:
        eff_room = m["eff_room"].get(rec["id"], rec["room"])
        if m["room_bld"].get(eff_room, rec["bld"]) != building:
            continue
        ds = [d for d in rec["days"] if d in day_set]
        hs = [h for h in rec["blks"] if h0 <= h < h1]
        if ds and hs:
            affected.append((rec, eff_room, ds, hs))

    before_occ = dict(sim_occ)
    relocated = 0
    unplaceable = 0
    dest_count = {}

    for (rec, eff_room, ds, _hs) in affected:
        # vacate the source first
        for d in ds:
            lst = sim_sched.get((eff_room, d))
            if lst and (rec["sm"], rec["em"]) in lst:
                lst.remove((rec["sm"], rec["em"]))
            for h in rec["blks"]:
                k = (building, d, h)
                sim_occ[k] = max(0, sim_occ.get(k, 0) - 1)

        cells = [(d, h) for d in ds for h in rec["blks"]]
        best = None
        best_busy = -1
        for room_id, types in m["room_types"].items():
            tb = m["room_bld"].get(room_id)
            if tb is None or tb == building:
                continue
            if rec["typ"] not in types:
                continue
            if not all(sim_occ.get((tb, d, h), 0) >= 1 for (d, h) in cells):
                continue
            if any(_sched_busy(sim_sched.get((room_id, d), []), rec["sm"], rec["em"]) for d in ds):
                continue
            busy = sum(sim_occ.get((tb, d, h), 0) for (d, h) in cells)
            if busy > best_busy:
                best_busy = busy
                best = room_id
        if best is None:
            unplaceable += 1
            continue
        tb = m["room_bld"][best]
        relocated += 1
        dest_count[tb] = dest_count.get(tb, 0) + 1
        for d in ds:
            sim_sched.setdefault((best, d), []).append((rec["sm"], rec["em"]))
            for h in rec["blks"]:
                k = (tb, d, h)
                sim_occ[k] = sim_occ.get(k, 0) + 1

    gross = 0
    for d in day_set:
        for h in range(h0, h1):
            if before_occ.get((building, d, h), 0) > 0 and sim_occ.get((building, d, h), 0) == 0:
                gross += 1
    added = 0
    for k, v in sim_occ.items():
        if k[0] == building:
            continue
        if v > 0 and before_occ.get(k, 0) == 0:
            added += 1
    net = gross - added

    destinations = sorted(dest_count.keys(), key=lambda b: (-dest_count[b], b))
    _kwh, dollars, co2 = _savings_for(max(0, net), True)

    day_txt = "/".join(DAY_LABELS.get(d, d) for d in day_set)
    if not affected:
        summary = ("No classes meet in " + building + " on " + day_txt
                   + " in that window, so closing it changes nothing.")
    else:
        bits = ["Closing " + building + " on " + day_txt + " moves " + str(relocated)
                + (" class" if relocated == 1 else " classes")]
        if destinations:
            bits.append(" into " + " and ".join(destinations[:2]))
        bits.append(", netting " + str(net) + (" freed hour" if net == 1 else " freed hours")
                    + " a week (about " + _money(dollars) + "/yr).")
        summary = "".join(bits)
        if unplaceable:
            summary += (" " + str(unplaceable)
                        + (" class has" if unplaceable == 1 else " classes have")
                        + " nowhere to go, so the closure is not fully feasible as stated.")

    return c3.CloseImpact.make({
        "building": building,
        "days": day_set,
        "hourStart": h0,
        "hourEnd": h1,
        "sectionsAffected": len(affected),
        "sectionsRelocated": relocated,
        "sectionsUnplaceable": unplaceable,
        "destinations": destinations,
        "hoursFreed": gross,
        "netHoursFreed": net,
        "dollars": dollars,
        "co2Tons": co2,
        "summary": summary,
    })


# --------------------------------------------------------------------------
# locate / walkMinutes
# --------------------------------------------------------------------------

FILLER = [
    "i live at", "i live in", "i'm at", "im at", "i am at", "i'm in", "im in",
    "find me", "somewhere near", "close to", "next to", "near the", "near",
    "around the", "around", "by the", "at the", "from the", "from", "at ", "in ",
]


def _clean_place(text):
    s = (text or "").strip().lower()
    for f in FILLER:
        if s.startswith(f):
            s = s[len(f):].strip()
    return s.strip(" .,?!")


def _phrase(hay, needle):
    """Whole-word substring test: 'here' must not match inside 'where'.

    Landmark aliases are short brand words, so a naive substring test produces
    wrong pins on perfectly ordinary questions.
    """
    h = (hay or "").lower()
    n = (needle or "").lower()
    if not n or not h:
        return False
    start = 0
    while True:
        i = h.find(n, start)
        if i < 0:
            return False
        before = i == 0 or not h[i - 1].isalnum()
        j = i + len(n)
        after = j >= len(h) or not h[j].isalnum()
        if before and after:
            return True
        start = i + 1


def locate(cls, text):
    raw = (text or "").strip()
    if not raw:
        return None
    q = _clean_place(raw)
    if not q:
        return None

    landmarks = c3.StudyLandmark.fetch(spec={
        "include": "id, lat, lon, category, usuallyPacked, note, aliases", "limit": -1}).objs

    def mk(lm, src):
        return _geopoint(lm.id, lm.lat, lm.lon, src, lm.usuallyPacked, lm.note)

    # 1. exact name or alias
    for lm in landmarks:
        if lm.id.lower() == q:
            return mk(lm, "landmark")
        for a in (lm.aliases or []):
            if (a or "").lower() == q:
                return mk(lm, "landmark")

    # 2. whole-word match either way, longest wins so "grainger library" beats "grainger"
    best = None
    best_len = 0
    for lm in landmarks:
        cands = [lm.id.lower()] + [(a or "").lower() for a in (lm.aliases or [])]
        for c in cands:
            if not c or len(c) <= best_len:
                continue
            if _phrase(q, c) or (len(c) > 5 and _phrase(c, q)):
                best = lm
                best_len = len(c)
    if best is not None:
        return mk(best, "landmark")

    # 3. a building name (coordinates come from BuildingGeo, see _geo_map)
    geo = _geo_map()
    bb_id = None
    bb_len = 0
    for b_id in geo:
        nl = b_id.lower()
        if len(nl) <= bb_len:
            continue
        if _phrase(q, nl) or _phrase(nl, q):
            bb_id = b_id
            bb_len = len(nl)
    if bb_id is not None:
        return _geopoint(bb_id, geo[bb_id]["lat"], geo[bb_id]["lon"], "building")

    # 4. online geocoder, scoped to the campus area. Kept last and short-timeout
    #    so an offline demo never stalls on it.
    try:
        url = ("https://nominatim.openstreetmap.org/search?format=json&limit=1"
               "&viewbox=-88.28,40.14,-88.17,40.07&bounded=1&q="
               + urllib.parse.quote(raw + ", Champaign, Illinois"))
        req = urllib.request.Request(url, headers={
            "User-Agent": "BlockIO-CampusEnergy/1.0 (C3 AI student project)"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            hits = json.loads(resp.read().decode("utf-8"))
        if hits:
            h = hits[0]
            return _geopoint(
                (h.get("display_name") or raw).split(",")[0],
                float(h["lat"]), float(h["lon"]), "geocoder")
    except Exception:
        pass
    return None


def walkMinutes(cls, to_from, to):
    if to_from is None or to is None:
        return -1
    return _walk_min(to_from.lat, to_from.lon, to.lat, to.lon)


# --------------------------------------------------------------------------
# setbackSchedule
# --------------------------------------------------------------------------

def setbackSchedule(cls, day, limit):
    m = _schedule()
    days = [day] if day in ALL_DAYS else list(ALL_DAYS)
    cap = limit if limit and limit > 0 else 200

    a = c3.SavingsAssumptions.getOrCreate()
    kwh_default = a.kwhPerFreedHourMid or 100.0
    weeks = (a.weeksPerSemester or 15) * (a.semestersPerYear or 2)
    price = a.electricityPriceMid or 0.10
    factor = a.emissionFactorMid or 0.40

    overrides = {}
    for b in c3.Building.fetch(spec={
            "include": "id, hvacKwhPerHour", "limit": -1,
            "filter": "exists(hvacKwhPerHour)"}).objs:
        overrides[b.id] = b.hvacKwhPerHour

    out = []
    for b, meta in m["bld"].items():
        wins = _windows_for(b, m["base_occ"], m["eff_occ"], days)
        if not wins:
            continue
        hours = sum(w[2] - w[1] for w in wins)
        newly = 0
        for d in days:
            for h in range(HOUR_START, HOUR_END):
                if m["base_occ"].get((b, d, h), 0) > 0 and m["eff_occ"].get((b, d, h), 0) == 0:
                    newly += 1
        rate = overrides.get(b) or kwh_default
        kwh_week = hours * rate
        out.append(c3.BuildingSetback.make({
            "building": b,
            "windows": [_mk_window(b, wd, ws, we, wn) for (wd, ws, we, wn) in wins],
            "hoursPerWeek": hours,
            "kwhPerWeek": round(kwh_week, 1),
            "dollarsPerYear": round(kwh_week * weeks * price, 2),
            "co2TonsPerYear": round(kwh_week * weeks * factor / 1000.0, 2),
            "newlyFreedHoursPerWeek": newly,
            "lat": meta.get("lat"),
            "lon": meta.get("lon"),
        }))

    out.sort(key=lambda s: (-s.dollarsPerYear, s.building))
    return out[:cap]


# --------------------------------------------------------------------------
# roomDetail
# --------------------------------------------------------------------------

def roomDetail(cls, roomId, day, hour, near):
    if not roomId:
        return None
    d = day if day in ALL_DAYS else "M"
    h = hour if (hour is not None and HOUR_START <= hour < HOUR_END) else 10

    m = _schedule()
    if roomId not in m["room_bld"]:
        return None
    b = m["room_bld"][roomId]
    meta = m["bld"].get(b) or {}

    slots = []
    for rec in m["secs"]:
        eff_room = m["eff_room"].get(rec["id"], rec["room"])
        here_today = rec["room"] == roomId
        here_after = eff_room == roomId
        if not (here_today or here_after):
            continue
        if d not in rec["days"]:
            continue
        slots.append(c3.RoomSectionSlot.make({
            "sectionId": rec["id"],
            "courseLabel": rec["course"],
            "sectionLabel": rec["sectionLabel"],
            "typeCode": rec["typ"],
            "startMin": rec["sm"],
            "endMin": rec["em"],
            "timeLabel": rec["timeLabel"],
            "movedAway": bool(here_today and not here_after),
        }))
    slots.sort(key=lambda s: (s.startMin, s.courseLabel))

    sched = m["sched"].get((roomId, d), [])
    free_now = not _overlaps(sched, h)
    later = [s for (s, _e) in sched if s >= (h + 1) * 60]
    if free_now:
        if later:
            nxt = min(later)
            minutes_free = nxt - h * 60
            free_until = "free until " + _clock(nxt)
        else:
            minutes_free = HOUR_END * 60 - h * 60
            free_until = "free rest of day"
    else:
        minutes_free = 0
        free_until = None

    near_lat = near.lat if near is not None else None
    near_lon = near.lon if near is not None else None

    return c3.RoomDetailInfo.make({
        "roomId": roomId,
        "roomName": m["room_name"].get(roomId) or roomId,
        "building": b,
        "roomType": _room_type(m["room_types"].get(roomId)),
        "typesHosted": sorted(m["room_types"].get(roomId) or []),
        "day": d,
        "hour": h,
        "freeNow": free_now,
        "freeUntilLabel": free_until,
        "minutesFree": minutes_free,
        "walkMinutes": _walk_min(near_lat, near_lon, meta.get("lat"), meta.get("lon")),
        "sectionsToday": slots,
        "buildingSections": m["eff_occ"].get((b, d, h), 0),
        "lat": meta.get("lat"),
        "lon": meta.get("lon"),
    })
