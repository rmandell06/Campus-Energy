import React, { useEffect, useRef, useState } from 'react';
import maplibregl, { Map as MlMap, StyleSpecification, ExpressionSpecification } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ArcLayer, ScatterplotLayer } from '@deck.gl/layers';
import { TripsLayer } from '@deck.gl/geo-layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import 'maplibre-gl/dist/maplibre-gl.css';
import './labels.css';
import type { MoveArc } from '@/shared/campusModel';

/** Per-building slice for one weekday + hour + scenario (see campusModel). */
export interface MapBuildingState {
  sections: number;
  sectionsCurrent: number;
  freed: boolean;
}

export interface ArcHoverInfo {
  x: number;
  y: number;
  courseLabel: string;
  from: string;
  to: string;
}

interface Props {
  geojson: FeatureCollection;
  /** keyed by schedule-building name */
  stateByBuilding: Record<string, MapBuildingState>;
  /** busiest single building-hour section count, for orange-ramp intensity */
  maxSections: number;
  /**
   * 'energy' (default) = orange ramp by sections + ice-blue freed; 'study' =
   * ice-blue ramp by free-room count (Study Spots page).
   */
  mode?: 'energy' | 'study';
  /** study mode only: schedule-building name → open class-free room count */
  studyByBuilding?: Record<string, number>;
  /** study mode only: busiest free-room count, for the ice ramp intensity */
  maxFree?: number;
  /** energy-flow arcs (optimized mode); empty hides the flow layers */
  arcs?: MoveArc[];
  /** when set, this arc is drawn bright + wide and the rest are dimmed */
  highlightArcId?: string | null;
  /** buildings powered down this hour, for the pulsing rings */
  pulses?: { name: string; position: [number, number] }[];
  showFlows?: boolean;
  /** HTML pin labels for the busiest buildings, priority-ordered (busiest first) */
  labels?: { name: string; position: [number, number] }[];
  /** building whose label must always stay visible (hovered / selected) */
  focusLabel?: string | null;
  bounds?: [[number, number], [number, number]] | null;
  /** external fly-to request: [lng, lat] (changes trigger an eased flyTo) */
  flyTo?: [number, number] | null;
  autoOrbit?: boolean;
  onHover?: (name: string | null, state?: MapBuildingState) => void;
  onSelect?: (name: string) => void;
  onArcHover?: (info: ArcHoverInfo | null) => void;
}

interface FootprintProps {
  fid: number;
  schedule_building?: string | null;
  tracked?: boolean;
  height?: number;
}

const UIUC_CENTER: [number, number] = [-88.2272, 40.1075];
const DARK_BASEMAP = 'https://tiles.openfreemap.org/styles/dark';
const OFFLINE_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0a0a0b' } }],
};

const ORANGE_SRC: [number, number, number] = [255, 95, 5];
const ICE_TGT: [number, number, number] = [110, 193, 255];
const LOOP = 100; // trips time units per loop

// Core-campus zoom clamp: fit the dense core so buildings + arcs fill the
// frame at any pane width, but never zoom so far out that campus becomes a
// tiny cluster, nor so far in that we lose context.
const MIN_ZOOM = 14.6;
const MAX_ZOOM = 16.2;
const FIT_PITCH = 60;
const FIT_BEARING = -18;
// If fitting the core bounds would land wider than this (wide, short panes),
// the campus reads as a small cluster amid empty streets — snap to a fixed
// core-campus camera instead.
const CORE_FIT_MIN_ZOOM = 14.8;
const CORE_CAMERA = { center: UIUC_CENTER, zoom: 15, pitch: FIT_PITCH, bearing: FIT_BEARING };

async function pickStyle(): Promise<string | StyleSpecification> {
  try {
    const r = await fetch(DARK_BASEMAP);
    if (r.ok) return DARK_BASEMAP;
  } catch {
    /* blocked network: footprints still render on the plain canvas */
  }
  return OFFLINE_STYLE;
}

/** Build a lifted, curved multi-point path between two points for the TripsLayer. */
function arcPath(
  s: [number, number],
  t: [number, number],
  lift: number,
  n = 24,
): { path: [number, number, number][]; timestamps: number[] } {
  const path: [number, number, number][] = [];
  const timestamps: number[] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const lng = s[0] + (t[0] - s[0]) * f;
    const lat = s[1] + (t[1] - s[1]) * f;
    const z = Math.sin(f * Math.PI) * lift;
    path.push([lng, lat, z]);
    timestamps.push(f * LOOP);
  }
  return { path, timestamps };
}

/**
 * The 3D campus map. MapLibre GL extrudes all 2,115 real OSM footprints from
 * `campus_buildings_v2.geojson`; per-building occupancy is pushed in through
 * feature-state (never a source rebuild) so day/hour/scenario changes recolour
 * and re-grow in place. A deck.gl MapboxOverlay draws the energy flow on top:
 * ArcLayer (classes leaving a building that powers down), an animated TripsLayer
 * (energy visibly flowing along those arcs) and a pulsing ScatterplotLayer on the
 * powered-down buildings. Palette: orange ramp = energy on, ice blue = powered
 * down; non-schedule buildings are neutral dark gray, scheduled-but-empty mid gray.
 */
export default function CampusMap3D({
  geojson,
  stateByBuilding,
  maxSections,
  mode = 'energy',
  studyByBuilding,
  maxFree,
  arcs,
  highlightArcId,
  pulses,
  showFlows = true,
  labels,
  focusLabel,
  bounds,
  flyTo,
  autoOrbit = true,
  onHover,
  onSelect,
  onArcHover,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const labelLayer = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const mapRef = useRef<MlMap | null>(null);
  const fitCoreRef = useRef<() => void>(() => {});
  // Instant re-fit used on resize; no-op until the style has loaded.
  const refitRef = useRef<() => void>(() => {});
  // True once the user has touched the camera (or it was flown somewhere) — a
  // resize must not yank it back to the overview after that.
  const interactedRef = useRef(false);
  const repositionLabelsRef = useRef<() => void>(() => {});
  const focusLabelRef = useRef<string | null>(focusLabel ?? null);
  focusLabelRef.current = focusLabel ?? null;
  const orbitRef = useRef(autoOrbit);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const readyRef = useRef(false);
  const stateRef = useRef(stateByBuilding);
  const maxRef = useRef(maxSections);
  const modeRef = useRef(mode);
  const studyRef = useRef<Record<string, number>>(studyByBuilding ?? {});
  const maxFreeRef = useRef(maxFree ?? 1);
  const arcsRef = useRef<MoveArc[]>(arcs ?? []);
  const highlightRef = useRef<string | null>(highlightArcId ?? null);
  const pulsesRef = useRef(pulses ?? []);
  const flowsRef = useRef(showFlows);
  const hoverRef = useRef(onHover);
  const selectRef = useRef(onSelect);
  const arcHoverRef = useRef(onArcHover);
  stateRef.current = stateByBuilding;
  maxRef.current = maxSections;
  modeRef.current = mode;
  studyRef.current = studyByBuilding ?? {};
  maxFreeRef.current = maxFree ?? 1;
  arcsRef.current = arcs ?? [];
  highlightRef.current = highlightArcId ?? null;
  pulsesRef.current = pulses ?? [];
  flowsRef.current = showFlows;
  hoverRef.current = onHover;
  selectRef.current = onSelect;
  arcHoverRef.current = onArcHover;

  const applyState = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    if (modeRef.current === 'study') {
      const maxF = Math.max(1, maxFreeRef.current);
      for (const f of geojson.features) {
        const p = f.properties as FootprintProps | null;
        if (!p?.schedule_building) continue;
        const n = studyRef.current[p.schedule_building] ?? 0;
        const ratio = n > 0 ? Math.min(1, n / maxF) : 0;
        const free = ratio > 0 ? Math.max(0.14, ratio) : 0;
        map.setFeatureState(
          { source: 'campus', id: p.fid },
          { free, heightMul: free > 0 ? 1 + 0.3 * ratio : 1 },
        );
      }
      return;
    }
    const max = Math.max(1, maxRef.current);
    for (const f of geojson.features) {
      const p = f.properties as FootprintProps | null;
      if (!p?.schedule_building) continue;
      const s = stateRef.current[p.schedule_building];
      const ratio = s && s.sections > 0 ? Math.min(1, s.sections / max) : 0;
      const lit = ratio > 0 ? Math.max(0.08, ratio) : 0;
      map.setFeatureState(
        { source: 'campus', id: p.fid },
        { lit, freed: !!s?.freed, heightMul: lit > 0 ? 1 + 0.25 * ratio : 1 },
      );
    }
  };

  // Build the deck.gl layer stack from the current refs + animation clock.
  const buildLayers = (): Layer[] => {
    const layers: Layer[] = [];
    const a = arcsRef.current;
    const hi = highlightRef.current;
    if (flowsRef.current && a.length) {
      const dim = (base: readonly [number, number, number], d: MoveArc, alpha = 230): [number, number, number, number] =>
        hi && d.id !== hi ? [base[0], base[1], base[2], 36] : [base[0], base[1], base[2], alpha];
      layers.push(
        new ArcLayer<MoveArc>({
          id: 'moves',
          data: a,
          getSourcePosition: (d) => d.source,
          getTargetPosition: (d) => d.target,
          getSourceColor: (d) => dim(ORANGE_SRC, d),
          getTargetColor: (d) => dim(ICE_TGT, d),
          getWidth: (d) => (hi && d.id === hi ? 6 : Math.min(6, 3 + d.corridor * 0.4)),
          widthMinPixels: 3,
          widthMaxPixels: 6,
          getHeight: 0.5,
          greatCircle: false,
          pickable: true,
          updateTriggers: {
            getSourceColor: hi,
            getTargetColor: hi,
            getWidth: hi,
          },
          onHover: (info: PickingInfo) => {
            const obj = info.object as MoveArc | undefined;
            if (obj && info.x != null) {
              arcHoverRef.current?.({
                x: info.x,
                y: info.y,
                courseLabel: obj.courseLabel,
                from: obj.fromBuilding,
                to: obj.toBuilding,
              });
            } else {
              arcHoverRef.current?.(null);
            }
          },
        }),
      );

      // Animate particles along the arcs. With many arcs (the Moves mini-map)
      // only the highlighted corridor animates, keeping the scene legible.
      const tripSource = hi ? a.filter((d) => d.id === hi) : a.length <= 50 ? a : [];
      if (tripSource.length) {
        const trips = tripSource.map((d) => arcPath(d.source, d.target, 0.0009));
        const now = (performance.now() / 1000) * 22;
        layers.push(
          new TripsLayer<{ path: [number, number, number][]; timestamps: number[] }>({
            id: 'flow',
            data: trips,
            getPath: (d) => d.path,
            getTimestamps: (d) => d.timestamps,
            getColor: ICE_TGT,
            opacity: 0.9,
            widthMinPixels: 2.5,
            trailLength: LOOP * 0.35,
            currentTime: now % LOOP,
            fadeTrail: true,
            jointRounded: true,
            capRounded: true,
          }),
        );
      }
    }

    const rings = pulsesRef.current;
    if (flowsRef.current && rings.length) {
      const phase = (performance.now() / 1600) % 1;
      const radius = 28 + 60 * phase;
      const alpha = Math.round(220 * (1 - phase));
      layers.push(
        new ScatterplotLayer<{ name: string; position: [number, number] }>({
          id: 'pulse',
          data: rings,
          getPosition: (d) => d.position,
          getRadius: radius,
          radiusUnits: 'meters',
          filled: false,
          stroked: true,
          lineWidthMinPixels: 2.5,
          getLineColor: [ICE_TGT[0], ICE_TGT[1], ICE_TGT[2], alpha],
          updateTriggers: { getRadius: radius, getLineColor: alpha },
        }),
      );
    }
    return layers;
  };

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let resizeObs: ResizeObserver | null = null;
    (async () => {
      const style = await pickStyle();
      if (cancelled || !el.current) return;
      const map = new maplibregl.Map({
        container: el.current,
        style,
        center: UIUC_CENTER,
        zoom: MIN_ZOOM,
        pitch: FIT_PITCH,
        bearing: FIT_BEARING,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

      const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
      overlayRef.current = overlay;
      map.addControl(overlay as unknown as maplibregl.IControl);

      // maplibre-gl.css forces `.maplibregl-map { position: relative }`, so the
      // container must carry a real size (the parent stage sets a definite
      // height). Resize once after construction and whenever the stage resizes,
      // otherwise the GL canvas can stick at 0px and render a blank black box.
      if (typeof ResizeObserver !== 'undefined' && el.current) {
        resizeObs = new ResizeObserver(() => {
          mapRef.current?.resize();
          if (!interactedRef.current) refitRef.current();
        });
        resizeObs.observe(el.current);
      }

      map.on('load', () => {
        map.resize();
        for (const l of map.getStyle().layers ?? []) {
          const layer = l as { id: string; 'source-layer'?: string };
          if (layer['source-layer'] === 'building') {
            map.setLayoutProperty(l.id, 'visibility', 'none');
          }
        }
        map.setLight({ anchor: 'viewport', color: '#ffffff', intensity: 0.3 });
        map.addSource('campus', { type: 'geojson', data: geojson, promoteId: 'fid' });

        const colorExpr =
          modeRef.current === 'study'
            ? ([
                'case',
                ['>', ['number', ['feature-state', 'free'], 0], 0],
                [
                  'interpolate',
                  ['linear'],
                  ['number', ['feature-state', 'free'], 0],
                  0,
                  '#1b394d',
                  0.5,
                  '#3f93d6',
                  1,
                  '#6ec1ff',
                ],
                ['boolean', ['get', 'tracked'], false],
                '#2a2a30',
                '#161619',
              ] as ExpressionSpecification)
            : ([
                'case',
                ['boolean', ['feature-state', 'freed'], false],
                '#6ec1ff',
                ['>', ['number', ['feature-state', 'lit'], 0], 0],
                [
                  'interpolate',
                  ['linear'],
                  ['number', ['feature-state', 'lit'], 0],
                  0,
                  '#5a2206',
                  0.5,
                  '#ff5f05',
                  1,
                  '#ffb37a',
                ],
                ['boolean', ['get', 'tracked'], false],
                '#3a3a42',
                '#1c1c20',
              ] as ExpressionSpecification);
        map.addLayer({
          id: 'campus-3d',
          type: 'fill-extrusion',
          source: 'campus',
          paint: {
            'fill-extrusion-height': [
              '*',
              ['coalesce', ['get', 'height'], 10],
              ['coalesce', ['feature-state', 'heightMul'], 1],
            ],
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 0.96,
            'fill-extrusion-vertical-gradient': true,
            'fill-extrusion-color': colorExpr,
          },
        });
        // Smooth 600ms grow + recolour (property names typed as string so the
        // maplibre v4 TS defs that omit *-transition don't reject them).
        map.setPaintProperty('campus-3d', 'fill-extrusion-height-transition', { duration: 600 });
        map.setPaintProperty('campus-3d', 'fill-extrusion-color-transition', { duration: 400 });

        readyRef.current = true;
        setReady(true);
        applyState();

        // Frame the core campus (bounds already exclude far outliers), capped
        // so buildings + arcs fill the frame at any pane width. fitBounds caps
        // the high end via maxZoom; we clamp the low end afterwards.
        const fitCore = (duration = 0) => {
          if (!bounds) return;
          // Compute the fit without animating so the check is exact even when
          // the move itself is eased (the old post-fitBounds getZoom() read the
          // pre-animation zoom).
          const cam = map.cameraForBounds(bounds, {
            padding: 40,
            bearing: FIT_BEARING,
            maxZoom: MAX_ZOOM,
          });
          const fitZoom = cam?.zoom ?? MIN_ZOOM;
          if (fitZoom < CORE_FIT_MIN_ZOOM) {
            if (duration > 0) map.easeTo({ ...CORE_CAMERA, duration });
            else map.jumpTo(CORE_CAMERA);
            return;
          }
          map.fitBounds(bounds, {
            padding: 40,
            pitch: FIT_PITCH,
            bearing: FIT_BEARING,
            maxZoom: MAX_ZOOM,
            duration,
          });
        };
        fitCoreRef.current = () => {
          orbitRef.current = autoOrbit;
          fitCore(900);
        };
        refitRef.current = () => fitCore(0);
        fitCore(0);

        map.on('mousemove', 'campus-3d', (e) => {
          const p = e.features?.[0]?.properties as FootprintProps | undefined;
          const name = p?.schedule_building ?? null;
          map.getCanvas().style.cursor = name ? 'pointer' : '';
          hoverRef.current?.(name, name ? stateRef.current[name] : undefined);
        });
        map.on('mouseleave', 'campus-3d', () => hoverRef.current?.(null));
        map.on('click', 'campus-3d', (e) => {
          const p = e.features?.[0]?.properties as FootprintProps | undefined;
          if (p?.schedule_building) selectRef.current?.(p.schedule_building);
        });

        orbitRef.current = autoOrbit;
        const stop = () => {
          orbitRef.current = false;
          interactedRef.current = true;
        };
        map.on('mousedown', stop);
        map.on('touchstart', stop);
        map.on('dragstart', stop);
        map.on('wheel', stop);

        const frame = () => {
          if (orbitRef.current) map.setBearing(map.getBearing() + 0.02);
          overlayRef.current?.setProps({ layers: buildLayers() });
          raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
      });
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      resizeObs?.disconnect();
      readyRef.current = false;
      overlayRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geojson]);

  // Recolour / re-grow when the hour/scenario slice (or study slice) changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(applyState, [stateByBuilding, maxSections, studyByBuilding, maxFree]);

  // External fly-to (search box / "show on map").
  useEffect(() => {
    if (flyTo && mapRef.current) {
      interactedRef.current = true; // a later resize must not undo the fly-to
      mapRef.current.flyTo({ center: flyTo, zoom: 16.5, pitch: 55, duration: 1600 });
    }
  }, [flyTo]);

  // Collision-aware building labels. Instead of letting every pin draw (which
  // piles them on top of each other), we own absolutely-positioned pills in an
  // overlay and, on every map move/zoom, project each building to screen space
  // and greedily place labels in priority order (busiest first), skipping any
  // whose box would intersect an already-placed one. At most 6 show when zoomed
  // out (< 15.5) and up to 15 when zoomed in; the hovered/selected building's
  // label is always kept, and reserves its box first so others avoid it.
  const LEADER = 10; // px gap between the pill and the building point
  useEffect(() => {
    const map = mapRef.current;
    const layer = labelLayer.current;
    if (!map || !ready || !layer || !labels?.length) return;

    interface LabelNode {
      name: string;
      lngLat: [number, number];
      holder: HTMLDivElement;
      w: number;
      h: number;
    }

    const nodes: LabelNode[] = labels.map((l) => {
      const holder = document.createElement('div');
      holder.className = 'cm-label-holder';
      const pill = document.createElement('div');
      pill.className = 'cm-label-pill';
      pill.textContent = l.name;
      const leader = document.createElement('div');
      leader.className = 'cm-label-leader';
      holder.appendChild(pill);
      holder.appendChild(leader);
      layer.appendChild(holder);
      return { name: l.name, lngLat: l.position, holder, w: 0, h: 0 };
    });
    // Measure once (text is fixed, so the pill box is constant).
    for (const n of nodes) {
      const pill = n.holder.firstElementChild as HTMLElement;
      n.w = pill.offsetWidth;
      n.h = pill.offsetHeight;
    }

    const intersects = (
      a: { x1: number; y1: number; x2: number; y2: number },
      b: { x1: number; y1: number; x2: number; y2: number },
    ) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

    const place = () => {
      const w = layer.clientWidth;
      const h = layer.clientHeight;
      const cap = map.getZoom() < 15.5 ? 6 : 15;
      const focus = focusLabelRef.current;
      // Focused label first (always shown + reserves its box), then priority.
      const ordered = [...nodes].sort((a, b) => {
        const af = a.name === focus ? 1 : 0;
        const bf = b.name === focus ? 1 : 0;
        return bf - af;
      });
      const placed: { x1: number; y1: number; x2: number; y2: number }[] = [];
      let shown = 0;
      for (const n of ordered) {
        const pt = map.project(n.lngLat);
        const forced = n.name === focus;
        const offscreen = pt.x < -40 || pt.y < -40 || pt.x > w + 40 || pt.y > h + 40;
        const box = {
          x1: pt.x - n.w / 2,
          y1: pt.y - LEADER - n.h,
          x2: pt.x + n.w / 2,
          y2: pt.y - LEADER,
        };
        const blocked =
          offscreen ||
          (!forced && (shown >= cap || placed.some((p) => intersects(p, box))));
        if (blocked) {
          n.holder.style.transform = 'translate(-9999px, -9999px)';
          continue;
        }
        n.holder.style.transform = `translate(${pt.x}px, ${pt.y}px) translate(-50%, -100%)`;
        n.holder.dataset.focus = forced ? 'true' : 'false';
        placed.push(box);
        if (!forced) shown += 1;
      }
    };

    repositionLabelsRef.current = place;
    let scheduled = false;
    const onMove = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        place();
      });
    };
    map.on('move', onMove);
    map.on('zoom', onMove);
    place();

    return () => {
      map.off('move', onMove);
      map.off('zoom', onMove);
      repositionLabelsRef.current = () => {};
      nodes.forEach((n) => n.holder.remove());
    };
  }, [labels, ready]);

  // Immediately re-place labels when the hovered/selected building changes so
  // its label pops in without waiting for a map move.
  useEffect(() => {
    repositionLabelsRef.current();
  }, [focusLabel]);

  return (
    <div className="relative h-full w-full">
      <div ref={el} className="h-full w-full" />
      <div ref={labelLayer} className="pointer-events-none absolute inset-0 overflow-hidden" />
      {ready ? (
        <button
          type="button"
          onClick={() => fitCoreRef.current()}
          className="io-chip absolute bottom-28 right-3 z-10"
        >
          Reset view
        </button>
      ) : null}
    </div>
  );
}
