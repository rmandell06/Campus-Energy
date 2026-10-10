"""Resolve one Wikimedia Commons exterior photo per campus building.

Writes data/BuildingPhoto/photos.json. A candidate is only accepted when the
file title contains every distinctive token of the building name, so we never
label a photo as a building it is not. Buildings with no confident match are
simply omitted — the UI then falls back to the illustrated placeholder.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = 'https://commons.wikimedia.org/w/api.php'
UA = 'BlockIO-CampusEnergy/1.0 (C3 AI student project; contact: via app)'

STOP = {
    'hall', 'building', 'bldg', 'center', 'centre', 'laboratory', 'lab', 'labs',
    'the', 'of', 'and', '&', 'annex', 'library', 'north', 'south', 'east',
    'west', 'university', 'illinois', 'uiuc', 'urbana', 'champaign', 'at',
    'st', 'street', 'ave', 'avenue', 'w', 'e', 'n', 's',
}
# Buildings whose names are plain street addresses or generic placeholders:
# a Commons search would only ever return a false positive.
SKIP_RE = re.compile(r'^\d|^outdoor|^storefront|^danville|^washington dc$', re.I)

EXPAND = {
    'ACES Lib, Info & Alum Ctr': 'ACES Library Illinois',
    'Literatures, Cultures, & Ling': 'Foreign Languages Building Illinois',
    'Natl Soybean Res Lab': 'National Soybean Research Center Illinois',
    'Nuclear Radiations Lab': 'Nuclear Engineering Laboratory Illinois',
    'Mechanical Engineering Lab': 'Mechanical Engineering Laboratory Illinois',
    'Electrical & Computer Eng Bldg': 'Electrical and Computer Engineering Building Illinois',
    'Siebel Center for Comp Sci': 'Thomas M. Siebel Center for Computer Science',
    'Campus Instructional Facility': 'Campus Instructional Facility Illinois',
    'Activities & Recreation Center': 'Activities and Recreation Center Illinois',
    'Natural History Building': 'Natural History Building Illinois',
    'Krannert Center for Perf Arts': 'Krannert Center for the Performing Arts',
    'Business Instructional Facility': 'Business Instructional Facility Illinois',
    'Everitt Laboratory': 'Everitt Laboratory Illinois',
    'Transportation Building': 'Transportation Building Illinois Urbana',
    'Materials Science & Eng Bld': 'Materials Science and Engineering Building Illinois',
    'Engineering Hall': 'Engineering Hall University of Illinois',
    'Illini Hall': 'Illini Hall Champaign',
    'Armory': 'Armory University of Illinois',
    'Gregory Hall': 'Gregory Hall Illinois',
    'Davenport Hall': 'Davenport Hall Illinois',
    'Noyes Laboratory': 'Noyes Laboratory Illinois',
}


def tokens(name):
    words = re.findall(r"[a-z0-9]+", name.lower())
    keep = [w for w in words if w not in STOP and len(w) > 2]
    return keep or words


def api(params):
    """One Commons API call, with exponential backoff on rate limiting.

    Commons answers a tight request loop with HTTP 429, which on the first run cost us 96 of 106
    buildings. Backing off and retrying is the difference between 10 photos and a full set.
    """
    params = dict(params)
    params.update({'format': 'json', 'origin': '*'})
    url = API + '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    delay = 2.0
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code not in (429, 503) or attempt == 5:
                raise
            retry_after = e.headers.get('Retry-After') if e.headers else None
            wait = float(retry_after) if (retry_after or '').isdigit() else delay
            sys.stderr.write('  rate limited, waiting %.0fs\n' % wait)
            sys.stderr.flush()
            time.sleep(wait)
            delay = min(delay * 2, 60.0)
    raise RuntimeError('unreachable')


def search(building):
    query = EXPAND.get(building, building + ' University of Illinois')
    try:
        d = api({
            'action': 'query',
            'generator': 'search',
            'gsrsearch': query,
            'gsrlimit': 8,
            'gsrnamespace': 6,
            'prop': 'imageinfo',
            'iiprop': 'url|extmetadata|mime',
            'iiurlwidth': 800,
        })
    except Exception as exc:  # network hiccup -> no photo, placeholder wins
        print('  ! ' + building + ': ' + str(exc), file=sys.stderr)
        return None
    pages = ((d.get('query') or {}).get('pages') or {})
    want = tokens(building)
    best = None
    for page in pages.values():
        title = page.get('title') or ''
        info = (page.get('imageinfo') or [{}])[0]
        mime = info.get('mime') or ''
        if not mime.startswith('image/') or 'svg' in mime:
            continue
        low = title.lower()
        # Every distinctive token of the building name must appear in the file
        # title: that is what keeps "Davenport Hall" off a "Daniels Hall" photo.
        if not all(t in low for t in want):
            continue
        meta = info.get('extmetadata') or {}
        artist = re.sub(r'<[^>]+>', '', (meta.get('Artist') or {}).get('value', '') or '').strip()
        license_short = (meta.get('LicenseShortName') or {}).get('value', '') or ''
        thumb = info.get('thumburl')
        if not thumb:
            continue
        # strip Wikimedia's analytics query string
        thumb = thumb.split('?')[0]
        # Commons returns search relevance as `index` (1 = best hit). Among the
        # candidates that pass the name-token gate, keep the most relevant one.
        rank = page.get('index', 999)
        cand = {
            'building': building,
            'kind': 'building',
            'imageUrl': thumb,
            'title': title[5:] if title.startswith('File:') else title,
            'credit': artist or 'Wikimedia Commons contributor',
            'license': license_short or 'See Wikimedia Commons',
            'sourceUrl': 'https://commons.wikimedia.org/wiki/' + urllib.parse.quote(title.replace(' ', '_')),
            'sourceName': 'Wikimedia Commons',
        }
        if best is None or rank < best[0]:
            best = (rank, cand)
    return best[1] if best else None


def main():
    rows = json.load(open(os.path.join(ROOT, 'data/Building/buildings.json')))
    d = os.path.join(ROOT, 'data/BuildingPhoto')
    os.makedirs(d, exist_ok=True)
    out_path = os.path.join(d, 'photos.json')

    # Merge, never replace. Commons rate-limits hard, so a run can easily resolve nothing; writing
    # the run's own results over the file would then delete photos an earlier run had already found.
    # Buildings already resolved are skipped outright, which also makes a re-run cheap.
    by_building = {}
    if os.path.exists(out_path):
        for row in json.load(open(out_path)):
            by_building[row['building']] = row
    had = len(by_building)

    for r in rows:
        name = r['id']
        if name in by_building:
            continue
        if SKIP_RE.match(name):
            print('skip  ' + name)
            continue
        hit = search(name)
        if hit:
            by_building[name] = hit
            print('OK    ' + name + '  ->  ' + hit['title'][:60])
        else:
            print('none  ' + name)
        time.sleep(1.1)

    out = [by_building[r['id']] for r in rows if r['id'] in by_building]
    for row in out:
        row['id'] = 'photo_' + re.sub(r'[^A-Za-z0-9]+', '_', row['building']).strip('_').lower()
    with open(out_path, 'w') as fh:
        json.dump(out, fh, indent=1)
        fh.write('\n')
    print('\nresolved ' + str(len(out)) + ' / ' + str(len(rows))
          + ' buildings (' + str(len(out) - had) + ' new this run)')


if __name__ == '__main__':
    main()
