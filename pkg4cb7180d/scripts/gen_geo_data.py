"""Generate C3 data files that need geometry from the campus OSM footprints.

Outputs
  data/Building/buildings.json      -- existing rows + lat/lon from the footprint centroid
  data/StudyLandmark/landmarks.json -- the student-landmark table (coords from OSM)

Run from the package root:  python3 scripts/gen_geo_data.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO = os.path.join(ROOT, 'ui/react/public/campus_buildings_v2.geojson')
CENTROIDS = os.path.join(ROOT, 'ui/react/public/building_centroids.json')


def ring_centroid(coords):
    """Area-weighted centroid of a closed ring of [lng, lat] pairs."""
    a = 0.0
    cx = 0.0
    cy = 0.0
    n = len(coords)
    for i in range(n - 1):
        x0, y0 = coords[i][0], coords[i][1]
        x1, y1 = coords[i + 1][0], coords[i + 1][1]
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if abs(a) < 1e-14:
        xs = [c[0] for c in coords]
        ys = [c[1] for c in coords]
        return sum(xs) / len(xs), sum(ys) / len(ys)
    a *= 0.5
    return cx / (6 * a), cy / (6 * a)


def feature_centroid(geom):
    t = geom.get('type')
    if t == 'Polygon':
        return ring_centroid(geom['coordinates'][0])
    if t == 'MultiPolygon':
        best = max(geom['coordinates'], key=lambda poly: len(poly[0]))
        return ring_centroid(best[0])
    return None


def load_osm_centroids():
    """osm_name -> (lng, lat), keeping the largest footprint per name."""
    geo = json.load(open(GEO))
    best = {}
    for f in geo['features']:
        props = f.get('properties') or {}
        name = props.get('osm_name')
        if not name:
            continue
        geom = f.get('geometry') or {}
        c = feature_centroid(geom)
        if c is None:
            continue
        verts = 0
        if geom.get('type') == 'Polygon':
            verts = len(geom['coordinates'][0])
        elif geom.get('type') == 'MultiPolygon':
            verts = max(len(p[0]) for p in geom['coordinates'])
        prev = best.get(name)
        if prev is None or verts > prev[1]:
            best[name] = (c, verts)
    return {k: v[0] for k, v in best.items()}


# ---------------------------------------------------------------- buildings
def write_buildings():
    path = os.path.join(ROOT, 'data/Building/buildings.json')
    rows = json.load(open(path))
    cent = json.load(open(CENTROIDS))
    hit = 0
    for r in rows:
        c = cent.get(r['id'])
        if c:
            r['lon'] = round(float(c[0]), 6)
            r['lat'] = round(float(c[1]), 6)
            hit += 1
        else:
            r.pop('lat', None)
            r.pop('lon', None)
    with open(path, 'w') as fh:
        json.dump(rows, fh, indent=1)
        fh.write('\n')
    print('buildings:', len(rows), 'with coords:', hit)


# --------------------------------------------------------------- landmarks
# Curated table of the places students actually say. `osm` is the exact
# `osm_name` in campus_buildings_v2.geojson that supplies the coordinates, so
# every lat/lon here is derived from the map's OpenStreetMap data.
LANDMARKS = [
    # --- Green Street / campustown apartments (students live here) ---
    ('HERE Champaign', 'HERE Champaign', 'apartment', False,
     '708 S Sixth St at E Green St, Champaign.', ['here', 'here champaign', 'here apartments']),
    ('Green Street Towers', 'Green Street Towers', 'apartment', False,
     'Apartments on E Green St.', ['green street towers', 'green st towers']),
    ('309 Green', '309 Green', 'apartment', False,
     'Apartments at 309 E Green St.', ['309 green', '309 e green']),
    ('Illini Tower', 'Illini Tower', 'apartment', False,
     'Residence hall-style apartments on E John St.', ['illini tower']),
    ('Skyline Tower', 'Skyline Tower', 'apartment', False,
     'Apartments on E Green St.', ['skyline', 'skyline tower']),
    ('The Tower at Third', 'The Tower at Third', 'apartment', False,
     'Apartments at Third and Green.', ['tower at third', 'the tower at third']),
    ('Hub Champaign Daniel', 'Hub Champaign Daniel', 'apartment', False,
     'Apartments on E Daniel St.', ['hub', 'hub champaign', 'hub on campus']),
    ('Latitude Apartments', 'Latitude Apartments', 'apartment', False,
     'Apartments on E Green St.', ['latitude']),
    ('Octave', 'Octave', 'apartment', False,
     'Apartments on E Green St.', ['octave']),
    ('Burnham 310', 'Burnham 310', 'apartment', False,
     'Apartments at 310 E Springfield Ave.', ['burnham', 'burnham 310']),
    ('Lofts 54', 'Lofts 54', 'apartment', False,
     'Apartments on E Green St.', ['lofts 54', 'lofts54']),
    ('Bankier Apartments', 'Bankier Apartments', 'apartment', False,
     'Campustown apartments.', ['bankier']),
    ('The Suites at Third', 'The Suites at Third', 'apartment', False,
     'Apartments at Third and Green.', ['suites at third']),
    ('Park Place Tower', 'Park Place Tower', 'apartment', False,
     'Apartments on E Green St.', ['park place']),

    # --- Popular study spots, treated as "usually packed" at peak hours ---
    ('Grainger Engineering Library', 'Grainger Engineering Library', 'library', True,
     'The engineering quad study hub — seats fill through the afternoon and evening.',
     ['grainger', 'grainger library', 'grainger engineering library', 'engineering library']),
    ('Main Library', 'Main Library', 'library', True,
     'Central library on the south quad — reading rooms are busy most of the day.',
     ['main library', 'the main library', 'library']),
    ('Undergraduate Library', 'Main Library', 'library', True,
     'The undergraduate collection now sits inside the Main Library complex, so it shares the same busy floors.',
     ['ugl', 'undergrad library', 'undergraduate library']),
    ('Illini Union', 'Illini Union', 'union', True,
     'Student union on the north quad — lounges and the south lounge are crowded between classes.',
     ['illini union', 'the union', 'union']),
    ('Electrical and Computer Engineering Building', 'Electrical and Computer Engineering Building',
     'engineering', True,
     'ECEB atrium and commons tables are a default engineering study spot and fill up fast.',
     ['eceb', 'ece building', 'electrical and computer engineering']),
    ('Siebel Center for Computer Science', 'Siebel Center for Computer Science', 'engineering', True,
     'Siebel commons and the basement tables are packed during CS office hours.',
     ['siebel', 'siebel center', 'siebel center for computer science', 'scs']),

    # --- Other campus anchors students navigate by (not flagged packed) ---
    ('Siebel Center for Design', 'Siebel Center for Design', 'engineering', False,
     'Design studios and open work tables on S Sixth St.', ['siebel design', 'siebel center for design']),
    ('Campus Instructional Facility', 'Campus Instructional Facility', 'classroom', False,
     'CIF — the newest classroom building on the engineering quad.',
     ['cif', 'campus instructional facility']),
    ('Activities and Recreation Center', 'Activities and Recreation Center', 'rec', False,
     'The ARC — recreation centre on S Fourth St.', ['arc', 'the arc', 'activities and recreation center']),
    ('Funk Library', 'Funk Library', 'library', False,
     'ACES library on the south quad.', ['funk', 'funk library', 'aces library']),
    ('Main Quad', 'Foellinger Auditorium', 'quad', False,
     'The Main Quad, between the Union and Foellinger Auditorium.',
     ['quad', 'the quad', 'main quad']),
    ('Engineering Quad', 'Grainger Engineering Library', 'quad', False,
     'The Engineering Quad, around Grainger and the Bardeen quad.',
     ['engineering quad', 'eng quad', 'bardeen quad']),
]


def write_landmarks():
    osm = load_osm_centroids()
    out = []
    missing = []
    for name, osm_name, category, packed, note, aliases in LANDMARKS:
        c = osm.get(osm_name)
        if not c:
            missing.append((name, osm_name))
            continue
        out.append({
            'id': name,
            'lon': round(float(c[0]), 6),
            'lat': round(float(c[1]), 6),
            'category': category,
            'usuallyPacked': bool(packed),
            'note': note,
            'aliases': sorted(set(aliases)),
            'osmName': osm_name,
        })
    d = os.path.join(ROOT, 'data/StudyLandmark')
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, 'landmarks.json'), 'w') as fh:
        json.dump(out, fh, indent=1)
        fh.write('\n')
    print('landmarks:', len(out), 'missing:', missing)


if __name__ == '__main__':
    write_buildings()
    write_landmarks()
