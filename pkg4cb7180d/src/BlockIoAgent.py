"""Intent router for the Illini I/O agent.

`ask` first extracts a small structured intent from the message with the LLM (JSON only, no tools
in that step), then — driven by the caller's role, never by words in the message — routes to the
matching AgentTools functions and formats what came back. The LLM only ever picks an intent and
pulls out slots (course, day, hour, place, duration); it never produces a number that reaches the
user. Every figure in a reply is still copied from a tool result, and course identification is done
by exact regex + exact Section lookup, never by fuzzy-matching the raw message. If the LLM is
unavailable the router falls back to deterministic keyword/regex parsing, so the agent still works.

Role is authoritative. A STUDENT never runs a cancellation or any energy/$ analysis — a cancelled
class in a student message is only context (it means the student is free during that slot). A
FACILITIES user never gets study-room recommendations unless they explicitly ask.
"""
import json
import re

ALL_DAYS = ["M", "T", "W", "R", "F"]
DAY_LABELS = {"M": "Mon", "T": "Tue", "W": "Wed", "R": "Thu", "F": "Fri"}
DAY_FULL = {"M": "Monday", "T": "Tuesday", "W": "Wednesday", "R": "Thursday", "F": "Friday"}
# Plurals are listed explicitly because day matching is whole-word: "on Fridays" must resolve,
# and a prefix match would make "mon" fire inside "money".
DAY_WORDS = {
    "monday": "M", "mondays": "M", "mon": "M",
    "tuesday": "T", "tuesdays": "T", "tue": "T", "tues": "T",
    "wednesday": "W", "wednesdays": "W", "wed": "W",
    "thursday": "R", "thursdays": "R", "thu": "R", "thur": "R", "thurs": "R",
    "friday": "F", "fridays": "F", "fri": "F",
}
HOUR_START = 7
HOUR_END = 22

STUDENT_CHIPS = [
    "I live at HERE Champaign. Find me a quiet room for 2 hours right now.",
    "Somewhere near Siebel free until 5pm",
    "Which rooms in Lincoln Hall are open at 2pm Tuesday?",
    "My 11am class got cancelled, where can I study near the quad?",
]

FACILITIES_CHIPS = [
    "CS 225's Friday lecture is cancelled. What changes?",
    "Which building should we set back first on Fridays?",
    "What if we close Altgeld Hall on Fridays?",
    "Show me campus Friday at 5pm with Illini I/O",
]

SCENARIO_WORDS = [
    ("evenings", ["evening", "evenings", "after 4", "after 4pm", "late day"]),
    ("fridays", ["fridays only", "friday only", "just fridays"]),
    ("conservative", ["conservative", "least disruptive", "safest"]),
    ("aggressive", ["aggressive", "maximum", "most savings", "go further"]),
    ("allDay", ["all day", "whole day", "full day", "default plan"]),
]

PLACE_CUES = [
    "i live at", "i live in", "i'm living at", "im living at", "i am at", "i'm at", "im at",
    "i'm in", "im in", "i am in", "i stay at", "staying at",
    "walking distance of", "walking distance from",
    "somewhere near", "close to", "next to", "near the", "near", "around the", "around",
]

# Words that end a place phrase — everything after them is time or filter language.
PLACE_STOP = re.compile(
    r"\b(for|free|open|available|right now|now|today|tonight|until|till|at \d|from|that|which|"
    r"with|where|and i|please|quiet|study|studying)\b")

TIME_RE = re.compile(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b")
UNTIL_RE = re.compile(r"\b(?:until|till|til|through|up to|before)\s+(?:about\s+)?"
                      r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b")
HOURS_RE = re.compile(r"\b(\d{1,2})\s*(?:\+)?\s*(hours?|hrs?|h)\b")
MINS_RE = re.compile(r"\b(\d{1,3})\s*(minutes?|mins?|min)\b")
CLOSE_RE = re.compile(r"\b(\d{1,2})\s*(?:am|pm)?\s*(?:to|-|until|through)\s*(\d{1,2})\s*(am|pm)?\b")


# --------------------------------------------------------------------------
# small shared utilities
# --------------------------------------------------------------------------

def _phrase(hay, needle):
    """Whole-word substring test, so 'here' does not match inside 'where'."""
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


def _hour12(h):
    suffix = "AM" if h < 12 else "PM"
    base = h % 12
    if base == 0:
        base = 12
    return str(base) + " " + suffix


def _hshort(h):
    suffix = "am" if h < 12 else "pm"
    base = h % 12
    if base == 0:
        base = 12
    return str(base) + suffix


def _money(amount):
    a = float(amount or 0)
    if a >= 1000000:
        return "$" + str(round(a / 1000000.0, 1)) + "M"
    if a >= 1000:
        return "$" + str(int(round(a / 1000.0))) + "K"
    return "$" + str(int(round(a)))


def _dur_text(minutes):
    m = int(minutes or 0)
    if m >= 120 and m % 60 == 0:
        return str(m // 60) + " hours"
    if m == 60:
        return "an hour"
    if m > 60:
        return str(m // 60) + "h " + str(m % 60) + "m"
    return str(m) + " minutes"


def _is_fac(role):
    return (role or "").lower().startswith("fac")


def _to24(hour, meridiem):
    h = int(hour)
    mer = (meridiem or "").replace(".", "")
    if mer.startswith("p"):
        if h < 12:
            h += 12
    elif mer.startswith("a"):
        if h == 12:
            h = 0
    elif h <= 7:
        # No am/pm given: a bare 1..7 in a campus question means the afternoon.
        h += 12
    return h


def _parse_day(low, default):
    for word, letter in DAY_WORDS.items():
        if _phrase(low, word):
            return letter
    return default


def _parse_hour(low, default):
    m = UNTIL_RE.search(low)
    start = None
    for t in TIME_RE.finditer(low):
        if m is not None and t.start() >= m.start():
            continue  # that is the "until" time, not the start time
        start = _to24(t.group(1), t.group(3))
        break
    if start is None and m is None:
        bare = re.search(r"\bat\s+(\d{1,2})\b", low)
        if bare:
            start = _to24(bare.group(1), None)
    if start is None:
        return default
    if start < HOUR_START or start >= HOUR_END:
        return default
    return start


def _parse_duration(low, hour):
    """Minutes the student needs, from either a duration or an 'until <time>' phrase."""
    m = UNTIL_RE.search(low)
    if m:
        end = _to24(m.group(1), m.group(3))
        if end > hour:
            return (end - hour) * 60
    m = HOURS_RE.search(low)
    if m:
        return max(30, int(m.group(1)) * 60)
    m = MINS_RE.search(low)
    if m:
        return max(15, int(m.group(1)))
    if _phrase(low, "half an hour"):
        return 30
    if _phrase(low, "an hour") or _phrase(low, "a hour"):
        return 60
    if _phrase(low, "all afternoon"):
        return 240
    return 60


def _place_text(low):
    """The place phrase in a question, e.g. 'here champaign' or 'the quad'."""
    best = None
    best_at = len(low) + 1
    for cue in PLACE_CUES:
        i = low.find(cue)
        if i < 0 or i >= best_at:
            continue
        rest = low[i + len(cue):].strip()
        for sep in [".", ",", "?", "!", ";"]:
            j = rest.find(sep)
            if j > 0:
                rest = rest[:j]
        cut = PLACE_STOP.search(rest)
        if cut:
            rest = rest[:cut.start()]
        rest = rest.strip(" .,?!'\"")
        if rest:
            best = rest
            best_at = i
    return best


def _find_building(low, names):
    """The longest building name mentioned in the question, or None. Falls back to a distinctive
    leading word (e.g. "Noyes" for "Noyes Laboratory") so "Noyes lab" still resolves."""
    hit = None
    for n in names:
        if len(n) <= (len(hit) if hit else 3):
            continue
        if _phrase(low, n.lower()):
            hit = n
    if hit:
        return hit
    for n in names:
        head = n.split()[0] if n else ""
        if len(head) >= 4 and _phrase(low, head.lower()):
            return n
    return None


def _building_names():
    return [b.id for b in c3.Building.fetch(spec={"include": "id", "limit": -1}).objs]


def _packed():
    """({buildingId: landmark note}, [landmark names]) for the 'usually packed' venues.

    StudyLandmark#buildingId is a newer field that may not be provisioned on the live schema, so
    both the include and the attribute read are kept tolerant: the landmark names still populate
    (used for the crowding caveat) even when the building link is unavailable.
    """
    try:
        lms = c3.StudyLandmark.fetch(spec={
            "include": "id, note, buildingId, usuallyPacked",
            "filter": "usuallyPacked == true", "limit": -1}).objs
    except Exception:
        lms = c3.StudyLandmark.fetch(spec={
            "include": "id, note, usuallyPacked",
            "filter": "usuallyPacked == true", "limit": -1}).objs
    blds = {}
    names = []
    for lm in lms:
        names.append(lm.id)
        try:
            if lm.buildingId:
                blds[lm.buildingId] = lm.id
        except Exception:
            pass
    return blds, names


def _place_in_text(low):
    """The most specific place named verbatim in the message — a StudyLandmark (apartment or
    campus landmark, matched on its name or any alias) or a building — matched whole-word so brand
    names like 'HERE Champaign', 'YUGO' or 'ISR' are recognised exactly.

    This is the reliable origin signal and takes priority over the LLM's extracted place: the model
    sometimes drops a brand word it mistakes for an ordinary word (e.g. 'HERE' in 'near HERE
    champaign' becomes just 'champaign', which then fuzzy-resolves to the wrong apartment). A direct
    whole-word lookup against the real landmark/building names cannot make that mistake. Returns the
    canonical name to hand to AgentTools.locate, or None when the message names no known place.
    """
    best = None
    best_len = 0
    try:
        lms = c3.StudyLandmark.fetch(spec={"include": "id, aliases", "limit": -1}).objs
    except Exception:
        try:
            lms = c3.StudyLandmark.fetch(spec={"include": "id", "limit": -1}).objs
        except Exception:
            lms = []
    for lm in lms:
        cands = [lm.id]
        try:
            cands += list(lm.aliases or [])
        except Exception:
            pass
        for c in cands:
            cl = (c or "").strip().lower()
            if len(cl) >= 3 and len(cl) > best_len and _phrase(low, cl):
                best, best_len = c, len(cl)
    # Fall back to a building named in the message (e.g. "near Siebel", "by Altgeld Hall").
    for n in _building_names():
        nl = n.lower()
        if len(nl) > best_len and _phrase(low, nl):
            best, best_len = n, len(nl)
    return best


def _reply(answer, steps, cards, actions, followUps, notFound, intent,
           applyLabel=None, applyScenario=None, applySectionIds=None):
    return c3.AgentReply.make({
        "answer": answer,
        "steps": steps or [],
        "cards": cards or [],
        "actions": actions or [],
        "followUps": followUps or [],
        "applyLabel": applyLabel,
        "applyScenario": applyScenario,
        "applySectionIds": applySectionIds or [],
        "notFound": bool(notFound),
        "intent": intent,
    })


def _act(kind, **kw):
    d = {"kind": kind}
    d.update(kw)
    return c3.MapAction.make(d)


def _room_card(r, packed_note=None):
    lines = [r.roomType + " in " + r.building, r.freeUntilLabel]
    if r.walkMinutes >= 0:
        lines.append(str(r.walkMinutes) + " min walk")
    return c3.AgentCard.make({
        "kind": "room",
        "title": r.roomName,
        "subtitle": r.building,
        "lines": lines,
        "roomId": r.roomId,
        "building": r.building,
        "metricLabel": "Free for",
        "metricValue": _dur_text(r.minutesFree),
        "walkMinutes": r.walkMinutes,
        "freeUntilLabel": r.freeUntilLabel,
        "minutesFree": r.minutesFree,
        "lat": r.lat,
        "lon": r.lon,
        "isAssumption": bool(packed_note),
    })


# --------------------------------------------------------------------------
# LLM intent extraction + exact course matching
# --------------------------------------------------------------------------

# subject + 3-digit number, e.g. "CS 225", "cs225". The ONLY way a course is identified — the raw
# message is never fuzzy-searched against the schedule.
COURSE_RE = re.compile(r"([A-Za-z]{2,5})\s*(\d{3})")


def _esc(text):
    """Escape a value for inclusion in a C3 filter string literal."""
    return str(text or "").replace("\\", "").replace("'", "")


def _is_cancelled(s):
    """Section#cancelled, tolerant of the field not being provisioned (treated as not cancelled)."""
    try:
        return bool(s.cancelled)
    except Exception:
        return False


def _regex_course(text):
    """(subject, number) from an explicit course code, or None. Case-insensitive, exact shape."""
    m = COURSE_RE.search(text or "")
    if not m:
        return None
    return (m.group(1).upper(), m.group(2))


def _course_label(course):
    return (course[0] + " " + course[1]) if course else ""


def _match_sections(course, section, day):
    """Exact Section lookup: subject == subject AND number == number (plus section and day when
    given). Never fuzzy. Returns live Section objects, cancelled ones removed."""
    if not course:
        return []
    subject, number = course
    filt = "subject == '" + _esc(subject) + "' && number == '" + _esc(number) + "'"
    if section:
        filt += " && section == '" + _esc(section) + "'"
    include = ("id, subject, number, section, sectionType, days, startMin, endMin, "
               "startTime, endTime, movable, cancelled, room.id, room.building.id")
    try:
        secs = c3.Section.fetch(spec={"include": include, "filter": filt, "limit": -1}).objs
    except Exception:
        secs = c3.Section.fetch(spec={
            "include": include.replace(", cancelled", ""), "filter": filt, "limit": -1}).objs
    out = []
    for s in secs:
        if _is_cancelled(s):
            continue
        days = [c for c in (s.days or "") if c in ALL_DAYS]
        if day and day not in days:
            continue
        out.append(s)
    return out


def _pick_meeting(matches, day_sel):
    """The earliest meeting among matched sections — the slot the student is freed into."""
    best = None
    for s in matches:
        days = [c for c in (s.days or "") if c in ALL_DAYS]
        if not days:
            continue
        md = day_sel if (day_sel and day_sel in days) else days[0]
        cand = {
            "day": md,
            "startMin": s.startMin if s.startMin is not None else 600,
            "timeLabel": ((s.startTime or "") + "-" + (s.endTime or "")).strip(" -"),
        }
        if best is None or cand["startMin"] < best["startMin"]:
            best = cand
    return best or {"day": (day_sel or "M"), "startMin": 600, "timeLabel": ""}


def _loads(content):
    """Parse the LLM's JSON, tolerant of markdown fences or stray prose around the object."""
    if not content:
        return {}
    s = content.strip()
    i = s.find("{")
    j = s.rfind("}")
    if i >= 0 and j > i:
        s = s[i:j + 1]
    try:
        obj = json.loads(s)
        return obj if isinstance(obj, dict) else {}
    except Exception:
        return {}


def _extract(question, role):
    """Pull a structured intent out of the message with the LLM — JSON only, no tools yet.

    Returns {} (so the deterministic keyword/regex routing takes over) if the model is unavailable.
    """
    if _is_fac(role):
        role_line = ("Role is FACILITIES. Allowed intents: cancel_impact, setback_priority, "
                     "building_status, show_time. A cancelled class IS a cancel_impact request. "
                     "Do not pick a study-room intent.")
    else:
        role_line = ("Role is STUDENT. Allowed intents: find_room (the default), room_in_building, "
                     "when_free. A cancelled class is NOT a cancellation request - it only means "
                     "the student is free during that class's time slot, so the intent is "
                     "find_room.")
    system = (
        "You extract a structured intent from one campus-assistant message. "
        "Return ONLY a JSON object, no prose and no markdown fences.\n" + role_line + "\n"
        "Schema: {\"intent\": string, "
        "\"course\": {\"subject\": string, \"number\": string, \"section\": string|null}|null, "
        "\"day\": one of M T W R F or null, \"hour\": integer 7-21 or null, "
        "\"place\": string|null, \"durationMin\": integer|null, \"building\": string|null}. "
        "Fill course only from an explicit course code like 'CS 225'. "
        "Fill day/hour only when the message states them. "
        "place is where the person currently is (apartment, landmark, or address). Copy the place "
        "phrase EXACTLY as written, including brand/apartment names, even when a word looks like an "
        "ordinary English word: in 'near HERE champaign' the place is 'HERE champaign' (HERE is an "
        "apartment brand, not the adverb 'here'); in 'near YUGO' it is 'YUGO'; 'ISR' and 'the quad' "
        "are places. Never shorten a place to just the city. "
        "building is a named campus building to search inside.")
    try:
        client = c3.GenaiCore.Llm.Completion.Client.forConfigKey("default-completions")
        resp = client.completion(
            messages=[{"role": "system", "content": system},
                      {"role": "user", "content": question}],
            options={"returnJson": True, "max_tokens": 500})
        return _loads(resp["choices"][0]["message"]["content"])
    except Exception:
        return {}


# --------------------------------------------------------------------------
# entry points
# --------------------------------------------------------------------------

def suggestions(cls, role):
    return list(FACILITIES_CHIPS) if _is_fac(role) else list(STUDENT_CHIPS)


def ask(cls, question, role, day, hour, near):
    q = (question or "").strip()
    low = q.lower()
    d = day if day in ALL_DAYS else "M"
    h = hour if (hour is not None and HOUR_START <= hour < HOUR_END) else 10
    if not q:
        return _reply(
            "Ask me where to study, or what a cancellation would free up.",
            [], [], [], suggestions(cls, role), False, "empty")

    # 1. Extract a structured intent with the LLM (JSON only, no tools yet).
    intent = _extract(q, role)
    kind = (intent.get("intent") or "").strip()
    cinfo = intent.get("course")
    section = cinfo.get("section") if isinstance(cinfo, dict) else None

    # 2. Course identity is settled by exact regex, not by the model's guess or the raw message.
    course = _regex_course(q)

    # 3. Slots: trust the model when present and valid, else fall back to deterministic parsing.
    llm_day = intent.get("day")
    day_sel = llm_day if llm_day in ALL_DAYS else _parse_day(low, None)
    llm_hour = intent.get("hour")
    hour_sel = llm_hour if (isinstance(llm_hour, int) and HOUR_START <= llm_hour < HOUR_END) else None
    # Place resolution, most reliable first: a known landmark/building named verbatim in the
    # message beats the LLM's extracted place (which can drop a brand word like "HERE"), which in
    # turn beats the deterministic phrase parse. This is the fix for "near HERE champaign"
    # resolving to the wrong apartment.
    place = _place_in_text(low) or intent.get("place") or _place_text(low)
    building = intent.get("building")
    dur = intent.get("durationMin")

    # 4. Route by role — the role, from the active route, decides which intents are even allowed.
    if _is_fac(role):
        return _facilities(q, low, kind, course, section, day_sel, hour_sel, building, d, h)
    return _student(q, low, kind, course, section, day_sel, hour_sel, place, building, dur, near, d, h)


# --------------------------------------------------------------------------
# student intents
# --------------------------------------------------------------------------

def _student(q, low, kind, course, section, day_sel, hour_sel, place, building, dur, near, d, h):
    names = _building_names()
    day = day_sel or d
    hour = hour_sel if hour_sel is not None else h

    # A course in a STUDENT message is only context — it means "I'm free when that class meets".
    # We look its meeting time up exactly and pin day/hour to it; we never cancel anything.
    lead = None
    if course:
        matches = _match_sections(course, section, day_sel)
        if not matches:
            where = (" on " + DAY_FULL[day_sel]) if day_sel else ""
            return _reply(
                "I couldn't find " + _course_label(course) + where + " in the schedule.",
                [], [], [], STUDENT_CHIPS, True, "findRoom")
        meet = _pick_meeting(matches, day_sel)
        day = meet["day"]
        hour = max(HOUR_START, min(meet["startMin"] // 60, HOUR_END - 1))
        when = DAY_FULL[day] + (" " + meet["timeLabel"] if meet["timeLabel"] else " at " + _hour12(hour))
        lead = _course_label(course) + " is out, so you're free " + when + "."

    # "Which rooms in Lincoln Hall are open at 2pm Tuesday?" — a specific building, no origin.
    if kind == "room_in_building" and building and not place:
        named = (building if building in names else _find_building(building.lower(), names))
        if named:
            return _rooms_in_building(named, day, hour, near, low)

    place_text = place or building
    want_dur = dur if (isinstance(dur, int) and dur > 0) else 120
    return _find_room(place_text, day, hour, near, want_dur, lead)


def _rooms_in_building(building, day, hour, near, low):
    steps = ["Checking " + building + " for " + DAY_FULL[day] + " " + _hour12(hour) + "..."]
    status = c3.AgentTools.buildingStatus(building, day, hour)
    if status is None:
        return _reply("I could not find a building called \"" + building + "\" in the schedule.",
                      steps, [], [], STUDENT_CHIPS, True, "roomsInBuilding")

    when = DAY_FULL[day] + " at " + _hour12(hour)
    rooms = [r for r in c3.AgentTools.freeRooms(day, hour, 0, near, 0, 400)
             if r.building == building]
    steps.append("Found " + str(len(rooms)) + " class-free rooms there.")

    actions = [_act("clear"), _act("setTime", day=day, hour=hour),
               _act("flyTo", building=building)]

    if rooms:
        rooms = rooms[:6]
        actions.append(_act("highlight", buildings=[building], color="energy"))
        top = rooms[0]
        answer = (str(len(rooms)) + (" room is" if len(rooms) == 1 else " rooms are")
                  + " class-free in " + building + " " + when
                  + ", and the building is already open for "
                  + str(status.sectionsNow)
                  + (" class." if status.sectionsNow == 1 else " classes.")
                  + " " + top.roomName + " stays open the longest: " + top.freeUntilLabel + ".")
        cards = [_room_card(r) for r in rooms]
        follow = ["Somewhere near " + building + " free until " + _hshort(min(hour + 3, 21)),
                  "Which rooms in " + building + " are open at "
                  + _hshort(min(hour + 2, 21)) + " " + DAY_FULL[day] + "?"]
        return _reply(answer, steps, cards, actions, follow, False, "roomsInBuilding")

    # Nothing free here — say why, then offer real alternatives rather than a dead end.
    alt = _nearby_alternatives(building, day, hour, near, status)
    if status.sectionsNow == 0:
        why = (building + " has no classes " + when
               + ", so it is not heated and lit then — studying there would add energy rather than use"
               + " what is already on.")
    else:
        why = ("Every room in " + building + " is in use " + when + ".")
    if alt:
        answer = why + " The closest open alternatives are in " + \
                 _and_list(sorted(set(r.building for r in alt[:3]))) + "."
        actions.append(_act("highlight",
                            buildings=sorted(set(r.building for r in alt[:3])), color="energy"))
        cards = [_room_card(r) for r in alt[:3]]
        return _reply(answer, steps, cards, actions,
                      ["Somewhere near " + building + " right now"], False, "roomsInBuilding")
    return _reply(why + " I could not find an open room elsewhere at that hour either.",
                  steps, [], actions, STUDENT_CHIPS, True, "roomsInBuilding")


def _nearby_alternatives(building, day, hour, near, status):
    origin = near
    if origin is None and status is not None and status.lat is not None:
        origin = c3.MapPin.make({
            "label": building, "lat": status.lat, "lon": status.lon,
            "source": "building", "usuallyPacked": False})
    return c3.AgentTools.freeRooms(day, hour, 0, origin, 0, 12)


def _and_list(items):
    items = list(items)
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    return ", ".join(items[:-1]) + " and " + items[-1]


def _find_room(place_text, day, hour, near, dur, lead):
    """The student study-spot flow: locate the pin, skip the usually-packed spots, and return the
    top 3 empty classrooms in buildings already running — no energy or dollar framing.

    `lead` is the first sentence (e.g. "CS 225 is out, so you're free Fri 11:00 AM-11:50 AM.") when a
    cancelled/named course pinned the time; None otherwise.
    """
    steps = []
    pin = None
    if place_text:
        steps.append("Finding " + place_text + "...")
        pin = c3.AgentTools.locate(place_text)
        if pin is None:
            return _reply(
                (lead + " " if lead else "")
                + "I couldn't place \"" + place_text + "\". Try an apartment name, a campus "
                "building, or a landmark like the Illini Union.",
                steps, [], [], STUDENT_CHIPS, True, "findRoom")
        steps.append("Located " + pin.label + ".")
    elif near is not None:
        pin = near
        steps.append("Using your saved location: " + (near.label or "your pin") + ".")

    # Always steer off the usually-packed study spots — that is the whole point of the finder.
    packed_blds, _packed_names = _packed()

    steps.append("Looking for rooms free for " + _dur_text(dur) + " on " + DAY_FULL[day]
                 + " from " + _hour12(hour) + "...")

    # Nearest within a short walk first (≤12 min), widened only if nothing turns up.
    if pin is not None:
        attempts = [(dur, 12), (dur, 20), (dur, 0)]
    else:
        attempts = [(dur, 0)]
    if dur > 60:
        attempts.append((60, 0))

    rooms = []
    used_dur = dur
    for (adur, awalk) in attempts:
        found = c3.AgentTools.freeRooms(day, hour, adur, pin, awalk, 40)
        found = [r for r in found if r.building not in packed_blds]
        if found:
            rooms = found
            used_dur = adur
            break

    if not rooms:
        return _reply(
            (lead + " " if lead else "")
            + "Nothing is open for " + _dur_text(dur) + " on " + DAY_FULL[day] + " from "
            + _hour12(hour) + " right now. Try a shorter stay or a different hour.",
            steps, [], [_act("setTime", day=day, hour=hour)],
            ["Which rooms are open at " + _hshort(min(hour + 2, 21)) + " " + DAY_FULL[day] + "?"],
            True, "findRoom")

    top3 = rooms[:3]
    steps.append("Ranked " + str(len(rooms)) + " open rooms; showing the best 3.")

    # Map: drop the pin, draw the walking line to #1, fly there.
    actions = [_act("clear"), _act("setTime", day=day, hour=hour)]
    if pin is not None:
        actions.append(_act("dropPin", lat=pin.lat, lon=pin.lon, label=pin.label, color="pin"))
        if top3[0].walkMinutes >= 0:
            actions.append(_act("drawWalk", lat=pin.lat, lon=pin.lon, label=pin.label,
                                toBuilding=top3[0].building, walkMinutes=top3[0].walkMinutes))
    actions.append(_act("highlight",
                        buildings=sorted(set(r.building for r in top3)), color="energy"))
    actions.append(_act("flyTo", building=top3[0].building))

    first = top3[0]
    n = len(top3)
    count_txt = ("1 empty classroom" if n == 1 else str(n) + " empty classrooms")
    if lead is None:
        lead = "You're free " + DAY_FULL[day] + " at " + _hour12(hour) + "."
    if pin is not None:
        second = ("The popular study spots near " + pin.label
                  + " are usually packed, so here " + ("is " if n == 1 else "are ")
                  + count_txt + " close by.")
    else:
        second = "Here " + ("is " if n == 1 else "are ") + count_txt + " nearby."
    answer = lead + " " + second
    if used_dur < dur:
        answer += (" Nothing was open for the full " + _dur_text(dur)
                   + ", so these are the longest I could find.")

    cards = [_room_card(r) for r in top3]
    follow = ["Which rooms in " + first.building + " are open at "
              + _hshort(min(hour + 2, 21)) + " " + DAY_FULL[day] + "?"]
    return _reply(answer, steps, cards, actions, follow, False, "findRoom")


# --------------------------------------------------------------------------
# facilities intents
# --------------------------------------------------------------------------

def _facilities(q, low, kind, course, section, day_sel, hour_sel, building, d, h):
    names = _building_names()
    if building:
        named = building if building in names else _find_building(building.lower(), names)
    else:
        named = _find_building(low, names)
    day = day_sel if day_sel in ALL_DAYS else _parse_day(low, d)
    hour = hour_sel if hour_sel is not None else _parse_hour(low, h)

    # The LLM's intent is authoritative; keyword matching only fills in when extraction failed.
    kw_cancel = ("cancel" in low or "cancelled" in low or "canceled" in low) and "close" not in low
    is_cancel = kind == "cancel_impact" or (not kind and kw_cancel)
    is_setback = kind == "setback_priority" or (
        not kind and ("set back" in low or "setback" in low
                      or "power down" in low or "power-down" in low))
    is_show = kind == "show_time" or (
        not kind and ("show" in low or "take me" in low or "fly" in low or "go to" in low))

    # Closing a whole building is a facilities power but outside the restricted intent set, so it
    # stays keyword-driven. A cancellation intent must win over a stray "close" in the sentence.
    # "clos" catches close/closing/closed; a close request names no course code, so let it win
    # over a cancel intent the LLM sometimes misfires on "impact of closing ...".
    wants_close = ("clos" in low or "shut" in low or "switch off" in low
                   or "turn off" in low or "power off" in low)
    if wants_close and not course:
        return _close(low, named, day)
    if is_cancel:
        return _cancel(q, low, course, day_sel)
    if is_setback:
        return _setback(low, day)
    for key, words in SCENARIO_WORDS:
        for w in words:
            if _phrase(low, w):
                return _scenario(key)
    if is_show:
        return _show(low, named, day, hour)
    if named:
        return _status(named, day, hour)
    return _reply(
        "I can answer that kind of question with the tools I have — try one of these.",
        [], [], [], FACILITIES_CHIPS, False, "help")


def _cancel(q, low, course, day_sel):
    """Simulate a cancellation for the exactly-matched course and report only the buildings whose
    schedule actually changes. Course identity is settled by regex + exact Section lookup — never by
    searching the raw message — so a facilities answer can only ever name real sections."""
    scope = "rest of term" if ("rest of term" in low or "rest of the term" in low
                               or "every week" in low or "permanently" in low) else "one day"
    if not course:
        return _reply(
            "Tell me which course's class is cancelled — for example \"CS 225's Friday lecture is "
            "cancelled. What changes?\"",
            [], [], [], FACILITIES_CHIPS, True, "cancel")

    label = _course_label(course)
    steps = ["Looking up " + label + " in the schedule..."]
    matches = _match_sections(course, None, day_sel)
    if not matches:
        where = (" on " + DAY_FULL[day_sel]) if day_sel else ""
        return _reply(
            "I couldn't find " + label + where + " in the schedule.",
            steps, [], [], FACILITIES_CHIPS, True, "cancel")

    # Day to apply: the day the user named, else the day these sections actually meet.
    day = day_sel
    if not day:
        day = _pick_meeting(matches, None)["day"]

    ids = [s.id for s in matches]
    steps.append("Matched " + str(len(matches))
                 + (" section" if len(matches) == 1 else " sections") + " of " + label + ".")
    steps.append("Recomputing affected buildings for " + DAY_FULL.get(day, "the week") + "...")
    impact = c3.AgentTools.cancelSections(ids, scope, day)

    # Only buildings whose schedule actually changes — hide the 0-hour ones entirely.
    changed = [b for b in impact.buildings if b.hoursFreed > 0]
    primary = changed[0] if changed else None

    actions = [_act("clear")]
    if primary is not None:
        hl_hour = None
        for w in primary.windows:
            hl_hour = w.startHour
            break
        if hl_hour is None:
            hl_hour = matches[0].startMin // 60 if matches[0].startMin else 10
        actions.append(_act("setTime", day=day, hour=max(HOUR_START, min(hl_hour, HOUR_END - 1))))
        actions.append(_act("flyTo", building=primary.building))
        actions.append(_act("highlight", buildings=[primary.building], color="poweredDown"))

    cards = []
    for b in changed[:4]:
        lines = [b.sentence]
        for w in b.windows[:3]:
            lines.append(w.label)
        cards.append(c3.AgentCard.make({
            "kind": "building",
            "title": b.building,
            "subtitle": "Can power down earlier",
            "lines": lines,
            "building": b.building,
            "metricLabel": "Hours freed",
            "metricValue": str(b.hoursFreed),
            "lat": b.lat,
            "lon": b.lon,
        }))
    cards.append(c3.AgentCard.make({
        "kind": "scenario",
        "title": ("Annual impact" if impact.annualized else "Impact for the day"),
        "subtitle": impact.scopeLabel,
        "lines": [str(round(impact.kwh)) + " kWh",
                  str(round(impact.co2Tons, 2)) + " tons CO2",
                  (str(impact.extraSwaps) + " extra room swaps unlocked")
                  if impact.extraSwaps else "No extra room swaps unlocked"],
        "metricLabel": ("Saved per year" if impact.annualized else "Saved that day"),
        "metricValue": _money(impact.dollars),
    }))

    if changed:
        answer = impact.summary
    else:
        answer = ("Cancelling " + label + " on " + DAY_FULL.get(day, "that day")
                  + " doesn't free any building early — every building it uses still has other "
                  "classes in session around that time.")
    follow = []
    apply_label = None
    if not impact.annualized:
        follow.append("What if " + label + " is cancelled for the rest of term?")
        answer += " That is the one-day figure — ask about the rest of term for the annual number."
    else:
        apply_label = "Apply to plan"
    if primary is not None:
        follow.append("What if we close " + primary.building + " on "
                      + DAY_LABELS.get(day, "Fri") + "days?")

    return _reply(answer, steps, cards, actions, follow, False, "cancel",
                  applyLabel=apply_label,
                  applySectionIds=(ids if apply_label else None))


def _close(low, named, day):
    if not named:
        return _reply("Tell me which building to close — for example \"What if we close Altgeld "
                      "Hall on Fridays?\"", [], [], [], FACILITIES_CHIPS, True, "close")
    days = [day] if (_parse_day(low, None) is not None) else list(ALL_DAYS)
    h0, h1 = HOUR_START, HOUR_END
    m = CLOSE_RE.search(low)
    if m:
        a = _to24(m.group(1), None)
        b = _to24(m.group(2), m.group(3))
        if HOUR_START <= a < b <= HOUR_END:
            h0, h1 = a, b

    steps = ["Relocating every class in " + named + " on "
             + _and_list([DAY_LABELS[x] for x in days]) + "...",
             "Checking which receiving buildings would have to stay on..."]
    impact = c3.AgentTools.closeBuilding(named, days, h0, h1)
    if impact is None:
        return _reply("I could not find a building called \"" + named + "\".",
                      steps, [], [], FACILITIES_CHIPS, True, "close")

    cards = [c3.AgentCard.make({
        "kind": "building",
        "title": named,
        "subtitle": "If closed " + _and_list([DAY_LABELS[x] for x in days])
                    + " " + _hshort(h0) + "-" + _hshort(h1),
        "lines": [str(impact.sectionsAffected) + " classes affected",
                  str(impact.sectionsRelocated) + " could be relocated",
                  (str(impact.sectionsUnplaceable) + " have nowhere to go"
                   if impact.sectionsUnplaceable else "All of them fit elsewhere"),
                  str(impact.hoursFreed) + " hours freed here, "
                  + str(impact.netHoursFreed) + " net across campus"],
        "building": named,
        "metricLabel": "Net saving",
        "metricValue": _money(impact.dollars) + "/yr",
    })]
    if impact.destinations:
        cards.append(c3.AgentCard.make({
            "kind": "note",
            "title": "Where the classes would go",
            "subtitle": str(len(impact.destinations)) + " receiving buildings",
            "lines": impact.destinations[:6],
        }))

    actions = [_act("clear"), _act("setTime", day=days[0], hour=max(h0, 10)),
               _act("flyTo", building=named),
               _act("highlight", buildings=[named], color="poweredDown")]
    if impact.destinations:
        actions.append(_act("highlight", buildings=impact.destinations[:5], color="energy"))

    return _reply(impact.summary, steps, cards, actions,
                  ["Which building should we set back first on "
                   + DAY_LABELS[days[0]] + "days?"],
                  False, "close")


def _setback(low, day):
    only_day = _parse_day(low, None)
    steps = ["Ranking setback windows by annual cost"
             + ((" for " + DAY_FULL[only_day]) if only_day else "") + "..."]
    rows = c3.AgentTools.setbackSchedule(only_day, 5)
    if not rows:
        return _reply("No building has a class-free window to set back"
                      + ((" on " + DAY_FULL[only_day]) if only_day else "") + ".",
                      steps, [], [], FACILITIES_CHIPS, True, "setback")

    top = rows[0]
    steps.append("Top of the list: " + top.building + ".")
    cards = []
    for r in rows:
        lines = [w.label for w in r.windows[:3]]
        if r.newlyFreedHoursPerWeek:
            lines.append(str(r.newlyFreedHoursPerWeek) + " of " + str(r.hoursPerWeek)
                         + " hours unlocked by Illini I/O")
        cards.append(c3.AgentCard.make({
            "kind": "setback",
            "title": r.building,
            "subtitle": str(r.hoursPerWeek) + " class-free hours a week",
            "lines": lines,
            "building": r.building,
            "metricLabel": "Worth",
            "metricValue": _money(r.dollarsPerYear) + "/yr",
            "lat": r.lat,
            "lon": r.lon,
        }))

    parts = [top.building + " first: " + str(top.hoursPerWeek)
             + " class-free hours a week, worth " + _money(top.dollarsPerYear)
             + " a year — the most of any building"
             + ((" on " + DAY_FULL[only_day]) if only_day else "") + "."]
    if top.windows:
        parts.append(top.windows[0].label + ".")
    if len(rows) > 1:
        parts.append("Then " + _and_list([r.building for r in rows[1:5]]) + ".")
    answer = " ".join(parts)

    actions = [_act("clear"), _act("flyTo", building=top.building),
               _act("highlight", buildings=[r.building for r in rows], color="poweredDown")]
    if top.windows:
        actions.append(_act("setTime", day=top.windows[0].day, hour=top.windows[0].startHour))

    return _reply(answer, steps, cards, actions,
                  ["What if we close " + top.building + " on "
                   + (DAY_LABELS[only_day] if only_day else "Fri") + "days?"],
                  False, "setback")


def _scenario(key):
    steps = ["Re-running the optimizer for the \"" + key + "\" scenario...",
             "Recomputing building occupancy and savings..."]
    res = c3.OptimizationRun.runScenario(key)
    cards = [c3.AgentCard.make({
        "kind": "scenario",
        "title": res.label,
        "subtitle": str(res.movesCount) + " classes change rooms, 0 class times change",
        "lines": [str(res.buildingsPoweredDown) + " of " + str(res.totalBuildings)
                  + " buildings power down early",
                  str(res.freedHoursPerWeek) + " building-hours freed per week",
                  "Near-empty hours: " + str(res.wastefulCurrent) + " to "
                  + str(res.wastefulOptimized),
                  str(round(res.co2TonsMid)) + " tons CO2 avoided per year"],
        "metricLabel": "Saved per year",
        "metricValue": _money(res.dollarsMid),
    })]
    answer = (res.sentence + " That is " + str(res.freedHoursPerWeek)
              + " building-hours a week, from " + str(res.movesCount)
              + " room changes and no change to any class time.")
    return _reply(answer, steps, cards,
                  [_act("setScenario", scenario=key), _act("setScenario", scenario="withBlockIo")],
                  ["Which building should we set back first on Fridays?"],
                  False, "scenario", applyScenario=key)


def _show(low, named, day, hour):
    with_block = ("illini i/o" in low or "illini io" in low or "block i/o" in low
                  or "block io" in low or "optimized" in low or "with block" in low
                  or "with illini" in low)
    steps = ["Setting the map to " + DAY_FULL[day] + " " + _hour12(hour)
             + (" with Illini I/O..." if with_block else "...")]
    actions = [_act("setTime", day=day, hour=hour),
               _act("setScenario", scenario=("withBlockIo" if with_block else "today"))]
    if named:
        actions.append(_act("flyTo", building=named))

    rows = c3.AgentTools.setbackSchedule(day, 300)
    powered = [r for r in rows
               if any(w.startHour <= hour < w.endHour and w.newlyFreed for w in r.windows)]
    steps.append(str(len(powered)) + " buildings are powered down at that hour under the plan.")
    if powered:
        actions.append(_act("highlight",
                            buildings=[r.building for r in powered[:30]], color="poweredDown"))

    answer = (DAY_FULL[day] + " at " + _hour12(hour) + ", "
              + ("with Illini I/O " if with_block else "")
              + str(len(powered)) + (" building is" if len(powered) == 1 else " buildings are")
              + " powered down that would be running today.")
    if powered:
        answer += (" The biggest is " + powered[0].building + " at "
                   + _money(powered[0].dollarsPerYear) + " a year.")
    cards = []
    for r in powered[:4]:
        cards.append(c3.AgentCard.make({
            "kind": "building",
            "title": r.building,
            "subtitle": "Powered down at " + _hour12(hour),
            "lines": [w.label for w in r.windows[:2]],
            "building": r.building,
            "metricLabel": "Worth",
            "metricValue": _money(r.dollarsPerYear) + "/yr",
            "lat": r.lat,
            "lon": r.lon,
        }))
    return _reply(answer, steps, cards, actions,
                  ["Which building should we set back first on " + DAY_LABELS[day] + "days?"],
                  False, "show")


def _status(building, day, hour):
    steps = ["Checking " + building + " for " + DAY_FULL[day] + " " + _hour12(hour) + "..."]
    st = c3.AgentTools.buildingStatus(building, day, hour)
    if st is None:
        return _reply("I could not find a building called \"" + building + "\".",
                      steps, [], [], FACILITIES_CHIPS, True, "status")
    lines = [s.courseLabel + " " + (s.sectionLabel or "") + " · " + (s.timeLabel or "")
             for s in st.sectionsInSession[:5]]
    if not lines:
        lines = ["No classes in session this hour."]
    cards = [c3.AgentCard.make({
        "kind": "building",
        "title": building,
        "subtitle": st.statusSentence,
        "lines": lines,
        "building": building,
        "metricLabel": "Classes per week",
        "metricValue": str(st.sectionsPerWeek),
        "lat": st.lat,
        "lon": st.lon,
    })]
    for w in st.setbackWindows[:3]:
        cards.append(c3.AgentCard.make({
            "kind": "setback",
            "title": w.dayLabel + " " + _hshort(w.startHour) + "-" + _hshort(w.endHour),
            "subtitle": ("Unlocked by Illini I/O" if w.newlyFreed else "Already class-free"),
            "lines": [w.label],
            "building": building,
            "metricLabel": "Hours",
            "metricValue": str(w.hours),
        }))
    actions = [_act("clear"), _act("setTime", day=day, hour=hour),
               _act("flyTo", building=building),
               _act("highlight", buildings=[building],
                    color=("poweredDown" if st.status != "running" else "energy"))]
    return _reply(st.statusSentence + ".", steps, cards, actions,
                  ["What if we close " + building + " on Fridays?"],
                  False, "status")
