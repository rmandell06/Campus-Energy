import React, { useEffect, useMemo, useRef } from 'react';
import { Deck, OrbitView, COORDINATE_SYSTEM } from '@deck.gl/core';
import type { PickingInfo, OrbitViewState } from '@deck.gl/core';
import { ColumnLayer, TextLayer, LineLayer, SolidPolygonLayer } from '@deck.gl/layers';
import { energyRampRgb, POWERED_DOWN_RGB, hourLabel } from '@/shared/format';
import './skyline-labels.css';

/** One building-hour cell projected into the skyline (see Heatmap page). */
export interface SkylineCell {
  building: string;
  buildingIndex: number;
  hour: number;
  hourIndex: number;
  /** sections shown in the active scenario (the bar height) */
  sections: number;
  /** optimizer emptied this building-hour (was occupied, now 0) */
  freed: boolean;
}

export interface SkylineHoverInfo {
  x: number;
  y: number;
  cell: SkylineCell;
}

interface Props {
  cells: SkylineCell[];
  /** building names in display order (row 0 = busiest, nearest the camera) */
  buildings: string[];
  /** hours covered, left→right along the x axis */
  hours: number[];
  maxSections: number;
  onHover?: (info: SkylineHoverInfo | null) => void;
  onSelect?: (building: string) => void;
}

// The grid footprint is normalised to a roughly-square FOOT × FOOT patch in
// world space regardless of how many rows/hours there are, so the skyline never
// collapses into an edge-on sliver. Bar height is capped at a fraction of that
// footprint. Building labels live in an HTML overlay (not in world space), so
// the camera fit reserves a pixel gutter on the left for them.
const FOOT = 420; // world units along each footprint edge (normalised)
const HEIGHT_FRAC = 0.6; // tallest bar = 0.6 × footprint width
const FIT_MARGIN = 1.08; // 8% breathing room around the projected bbox
const BASE_ORBIT = 35; // classic three-quarter view
const BASE_PITCH = 35;
const ORBIT_SWING = 15; // ± degrees of idle auto-rotate
const SWING_PERIOD = 16; // seconds per full swing

// HTML label overlay geometry (pixels).
const LABEL_MAX_CHARS = 22; // truncate long building names
const LABEL_GAP = 10; // label right edge sits this far left of the first bar
const EDGE_PAD = 12; // keep labels this far inside the canvas edges
const ROW_STRIDE_PX = 14; // below this on-screen row spacing, show every 2nd row
const ZOOM_MIN = -4;
const ZOOM_MAX = 6;

const truncate = (s: string) => (s.length > LABEL_MAX_CHARS ? `${s.slice(0, LABEL_MAX_CHARS - 1)}…` : s);

/**
 * A deck.gl OrbitView "skyline": one extruded ColumnLayer tower per occupied
 * building-hour. x = hour (7am→10pm), y = building (busiest nearest), height =
 * sections on the orange energy ramp; freed hours collapse to a flat ice-blue
 * pad. The scene sits on a subtle ground grid and is framed as a classic
 * isometric three-quarter view, slowly auto-rotating ±15° until the user drags.
 *
 * Building labels are rendered as a top-most HTML overlay positioned from the
 * live projected coordinates — so bars never occlude them — and the camera fit
 * reserves a pixel gutter on the left so the widest label stays fully inside the
 * canvas with {@link EDGE_PAD}px padding. Labels right-align to end
 * {@link LABEL_GAP}px before the first bar column and thin to every 2nd row when
 * rows crowd closer than {@link ROW_STRIDE_PX}px on screen.
 */
export default function Skyline3D({
  cells,
  buildings,
  hours,
  maxSections,
  onHover,
  onSelect,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelLayerRef = useRef<HTMLDivElement>(null);
  const labelNodesRef = useRef<HTMLDivElement[]>([]);
  const maxLabelPxRef = useRef(0);
  const fitRef = useRef<(() => void) | null>(null);
  const deckRef = useRef<Deck<OrbitView> | null>(null);
  const viewStateRef = useRef<OrbitViewState | null>(null);
  const userRef = useRef(false); // true once the user has interacted

  const hoverRef = useRef(onHover);
  const selectRef = useRef(onSelect);
  hoverRef.current = onHover;
  selectRef.current = onSelect;

  const nBuildings = buildings.length;
  const nHours = hours.length;
  const max = Math.max(1, maxSections);
  // Stable identity for the building axis so the Deck is not torn down on a
  // mere scenario toggle (same names) — only when the actual row set changes.
  const buildingsKey = useMemo(() => buildings.join('|'), [buildings]);

  // Normalised geometry: both axes span ~FOOT so the footprint reads square.
  const geo = useMemo(() => {
    const hourStep = FOOT / Math.max(1, nHours - 1);
    const rowStep = FOOT / Math.max(1, nBuildings - 1);
    const footW = (nHours - 1) * hourStep;
    const footH = (nBuildings - 1) * rowStep;
    const maxH = HEIGHT_FRAC * FOOT;
    const colRadius = Math.min(hourStep, rowStep) * 0.42;
    const elevPerSection = maxH / max;
    const freedPad = maxH * 0.02;
    // Centre of the footprint, lifted to ~35% of the max bar height.
    const center: [number, number, number] = [footW / 2, -footH / 2, maxH * 0.35];
    const radius = 0.5 * Math.sqrt(footW * footW + footH * footH + maxH * maxH);
    return { hourStep, rowStep, footW, footH, maxH, colRadius, elevPerSection, freedPad, center, radius };
  }, [nBuildings, nHours, max]);

  // Hour ticks run along the front edge (building labels are the HTML overlay).
  const textData = useMemo(() => {
    const items: { text: string; position: [number, number, number] }[] = [];
    hours.forEach((h, i) => {
      items.push({ text: hourLabel(h), position: [i * geo.hourStep, geo.rowStep * 0.9, 0] });
    });
    return items;
  }, [hours, geo]);

  // Subtle ground plane + grid so the bars read as standing on a surface.
  const ground = useMemo(() => {
    const pad = geo.rowStep * 0.5;
    const x0 = -geo.colRadius - geo.hourStep * 0.3;
    const x1 = geo.footW + geo.colRadius + geo.hourStep * 0.3;
    const y0 = pad;
    const y1 = -geo.footH - pad;
    const plane = [{ polygon: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as [number, number][] }];
    const lines: { s: [number, number, number]; t: [number, number, number] }[] = [];
    for (let i = 0; i < nBuildings; i++) {
      const y = -i * geo.rowStep;
      lines.push({ s: [0, y, 0], t: [geo.footW, y, 0] });
    }
    for (let j = 0; j < nHours; j++) {
      const x = j * geo.hourStep;
      lines.push({ s: [x, 0, 0], t: [x, -geo.footH, 0] });
    }
    return { plane, lines };
  }, [geo, nBuildings, nHours]);

  const buildLayers = useMemo(() => {
    return () => [
      new SolidPolygonLayer<{ polygon: [number, number][] }>({
        id: 'skyline-ground',
        data: ground.plane,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getPolygon: (d) => d.polygon,
        getFillColor: [20, 20, 24, 150],
        extruded: false,
        pickable: false,
      }),
      new LineLayer<{ s: [number, number, number]; t: [number, number, number] }>({
        id: 'skyline-grid',
        data: ground.lines,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getSourcePosition: (d) => d.s,
        getTargetPosition: (d) => d.t,
        getColor: [120, 120, 130, 40],
        getWidth: 1,
        widthUnits: 'pixels',
        pickable: false,
      }),
      new ColumnLayer<SkylineCell>({
        id: 'skyline-cols',
        data: cells,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        diskResolution: 4,
        radius: geo.colRadius,
        angle: 45,
        extruded: true,
        material: false,
        getPosition: (d) => [d.hourIndex * geo.hourStep, -d.buildingIndex * geo.rowStep, 0],
        getElevation: (d) => (d.freed ? geo.freedPad : Math.max(0.0001, d.sections) * geo.elevPerSection),
        getFillColor: (d) =>
          d.freed
            ? [POWERED_DOWN_RGB[0], POWERED_DOWN_RGB[1], POWERED_DOWN_RGB[2], 235]
            : [...energyRampRgb(d.sections / max), 240],
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 60],
        onHover: (info: PickingInfo) => {
          const cell = info.object as SkylineCell | undefined;
          if (cell && info.x != null && info.y != null) {
            hoverRef.current?.({ x: info.x, y: info.y, cell });
          } else {
            hoverRef.current?.(null);
          }
        },
        onClick: (info: PickingInfo) => {
          const cell = info.object as SkylineCell | undefined;
          if (cell) selectRef.current?.(cell.building);
        },
        updateTriggers: {
          getElevation: [max, geo.elevPerSection],
          getFillColor: [max],
          getPosition: [geo.hourStep, geo.rowStep],
          radius: [geo.colRadius],
        },
      }),
      new TextLayer<(typeof textData)[number]>({
        id: 'skyline-hours',
        data: textData,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        getSize: 11,
        sizeUnits: 'pixels',
        billboard: true,
        getColor: [168, 168, 177, 255],
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        characterSet: 'auto',
      }),
    ];
  }, [cells, textData, ground, geo, max]);

  // Create the Deck once per grid shape; drive it imperatively otherwise.
  useEffect(() => {
    if (!canvasRef.current) return;
    const view = new OrbitView({ orbitAxis: 'Z', fovy: 40 });
    const orbitSamples = [BASE_ORBIT - ORBIT_SWING, BASE_ORBIT, BASE_ORBIT + ORBIT_SWING];

    const initial: OrbitViewState = {
      target: geo.center,
      rotationX: BASE_PITCH,
      rotationOrbit: BASE_ORBIT,
      zoom: 0,
      minZoom: ZOOM_MIN,
      maxZoom: ZOOM_MAX,
    };
    viewStateRef.current = initial;
    userRef.current = false;

    const deck = new Deck<OrbitView>({
      canvas: canvasRef.current,
      views: view,
      controller: true,
      viewState: initial,
      layers: buildLayers(),
      style: { background: 'transparent' },
      onViewStateChange: ({ viewState, interactionState }) => {
        viewStateRef.current = viewState as OrbitViewState;
        const is = interactionState as
          | { isDragging?: boolean; isPanning?: boolean; isRotating?: boolean; isZooming?: boolean }
          | undefined;
        if (is && (is.isDragging || is.isPanning || is.isRotating || is.isZooming)) {
          userRef.current = true;
        }
        deckRef.current?.setProps({ viewState: viewState as OrbitViewState });
      },
    });
    deckRef.current = deck;

    // Position the HTML building labels from the live projected coordinates.
    const positionLabels = (vs: OrbitViewState) => {
      const el = canvasRef.current;
      const nodes = labelNodesRef.current;
      if (!el || nodes.length === 0) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      const vp = view.makeViewport({ width: w, height: h, viewState: vs });
      // On-screen row spacing → thin to every 2nd row when rows crowd.
      let stride = 1;
      if (nBuildings > 1) {
        const a = vp.project([0, 0, 0]);
        const b = vp.project([0, -geo.rowStep, 0]);
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < ROW_STRIDE_PX) stride = 2;
      }
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (i % stride !== 0) {
          node.style.transform = 'translate(-9999px, -9999px)';
          continue;
        }
        const p = vp.project([-geo.colRadius, -i * geo.rowStep, 0]);
        const sx = p[0];
        const sy = p[1];
        if (sy < -12 || sy > h + 12) {
          node.style.transform = 'translate(-9999px, -9999px)';
          continue;
        }
        let rightX = sx - LABEL_GAP;
        const wNode = node.offsetWidth;
        // Never clip the left edge; if clamping would push the label over the
        // first bar column, hide it rather than overlap.
        if (rightX - wNode < EDGE_PAD) {
          if (EDGE_PAD + wNode > sx - LABEL_GAP) {
            node.style.transform = 'translate(-9999px, -9999px)';
            continue;
          }
          rightX = EDGE_PAD + wNode;
        }
        node.style.transform = `translate(${rightX}px, ${sy}px) translate(-100%, -50%)`;
      }
    };

    // Fit the camera so the footprint + tallest bar fit the canvas, reserving a
    // pixel gutter on the left wide enough for the widest HTML label, then pan
    // so the leftmost content clears that gutter with EDGE_PAD padding. The
    // worst case across the ±15° auto-rotate swing is used so labels never clip.
    const fit = () => {
      const el = canvasRef.current;
      if (!el) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;

      const labelBudget = maxLabelPxRef.current + LABEL_GAP; // px needed left of the first bar
      const needLeft = EDGE_PAD + labelBudget; // leftmost content x must be ≥ this
      const availW = w - EDGE_PAD - needLeft;
      const availH = h - 2 * EDGE_PAD;

      const xs = [-geo.colRadius, geo.footW + geo.colRadius];
      const ys = [-geo.footH - geo.rowStep * 0.5, geo.rowStep * 0.9];
      const zs = [0, geo.maxH];
      const corners: [number, number, number][] = [];
      for (const x of xs) for (const y of ys) for (const z of zs) corners.push([x, y, z]);

      let target: [number, number, number] = [...geo.center];
      let zoom = Math.log2(Math.min(w, h) / Math.max(1, 2 * geo.radius * FIT_MARGIN));

      for (let it = 0; it < 6; it++) {
        const base: OrbitViewState = {
          target,
          zoom,
          rotationX: BASE_PITCH,
          rotationOrbit: BASE_ORBIT,
          minZoom: ZOOM_MIN,
          maxZoom: ZOOM_MAX,
        };
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const orbit of orbitSamples) {
          const vp = view.makeViewport({ width: w, height: h, viewState: { ...base, rotationOrbit: orbit } });
          for (const c of corners) {
            const p = vp.project(c);
            if (p[0] < minX) minX = p[0];
            if (p[0] > maxX) maxX = p[0];
            if (p[1] < minY) minY = p[1];
            if (p[1] > maxY) maxY = p[1];
          }
        }
        const contentW = Math.max(1, maxX - minX);
        const contentH = Math.max(1, maxY - minY);
        const scale = Math.min(availW / contentW, availH / contentH);
        if (scale < 0.995 || scale > 1.03) {
          zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom + Math.log2(Math.max(0.05, scale))));
          continue;
        }
        // Pan so the leftmost content sits at needLeft and the box is centred vertically.
        const vp = view.makeViewport({ width: w, height: h, viewState: base });
        const dxPix = needLeft - minX;
        const dyPix = h / 2 - (minY + maxY) / 2;
        if (Math.abs(dxPix) < 1 && Math.abs(dyPix) < 1) break;
        const cur = vp.unproject([w / 2, h / 2]);
        const want = vp.unproject([w / 2 - dxPix, h / 2 - dyPix]);
        target = [target[0] + (want[0] - cur[0]), target[1] + (want[1] - cur[1]), target[2]];
      }

      const next: OrbitViewState = {
        target,
        zoom,
        rotationX: BASE_PITCH,
        rotationOrbit: BASE_ORBIT,
        minZoom: ZOOM_MIN,
        maxZoom: ZOOM_MAX,
      };
      viewStateRef.current = next;
      userRef.current = false;
      deck.setProps({ viewState: next });
      positionLabels(next);
    };
    fitRef.current = fit;
    fit();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        fit();
        deckRef.current?.redraw('resize');
      });
      ro.observe(canvasRef.current);
    }

    // Idle auto-rotate: swing the orbit ±15° until the user interacts; keep the
    // HTML labels pinned to the bars every frame.
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      const vsRef = viewStateRef.current;
      if (vsRef && deckRef.current) {
        if (!userRef.current) {
          const t = (performance.now() - start) / 1000;
          const orbit = BASE_ORBIT + ORBIT_SWING * Math.sin((t / SWING_PERIOD) * 2 * Math.PI);
          const vs: OrbitViewState = { ...vsRef, rotationOrbit: orbit };
          viewStateRef.current = vs;
          deckRef.current.setProps({ viewState: vs });
          positionLabels(vs);
        } else {
          positionLabels(vsRef);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      fitRef.current = null;
      deck.finalize();
      deckRef.current = null;
    };
    // Recreate only when the grid shape / scaling changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo]);

  // (Re)build the HTML building-label overlay when the row set changes, measure
  // the widest label, then re-fit so the camera reserves the right gutter.
  useEffect(() => {
    const layer = labelLayerRef.current;
    if (!layer) return;
    layer.replaceChildren();
    const nodes: HTMLDivElement[] = [];
    let maxW = 0;
    for (const name of buildings) {
      const node = document.createElement('div');
      node.className = 'sky-row-label';
      node.title = name;
      node.textContent = truncate(name);
      layer.appendChild(node);
      nodes.push(node);
    }
    for (const node of nodes) maxW = Math.max(maxW, node.offsetWidth);
    labelNodesRef.current = nodes;
    maxLabelPxRef.current = maxW;
    fitRef.current?.();
    return () => {
      layer.replaceChildren();
      labelNodesRef.current = [];
    };
  }, [buildingsKey, buildings, geo]);

  // Push new layers whenever the data / scenario slice changes.
  useEffect(() => {
    deckRef.current?.setProps({ layers: buildLayers() });
  }, [buildLayers]);

  return (
    <div className="relative h-full w-full">
      <canvas ref={canvasRef} className="h-full w-full" />
      <div ref={labelLayerRef} className="sky-label-layer" aria-hidden />
    </div>
  );
}
