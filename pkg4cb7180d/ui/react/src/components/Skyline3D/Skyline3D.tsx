import React, { useEffect, useMemo, useRef } from 'react';
import { Deck, OrbitView, COORDINATE_SYSTEM } from '@deck.gl/core';
import type { PickingInfo, OrbitViewState } from '@deck.gl/core';
import { ColumnLayer, TextLayer, LineLayer, SolidPolygonLayer } from '@deck.gl/layers';
import { energyRampRgb, POWERED_DOWN_RGB, hourLabel } from '@/shared/format';

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
// footprint, and a left gutter holds the building labels outside the bars.
const FOOT = 420; // world units along each footprint edge (normalised)
const HEIGHT_FRAC = 0.6; // tallest bar = 0.6 × footprint width
const GUTTER_FRAC = 0.18; // left label gutter as a fraction of footprint width
const FIT_MARGIN = 1.08; // 8% breathing room around the projected bbox
const BASE_ORBIT = 35; // classic three-quarter view
const BASE_PITCH = 35;
const ORBIT_SWING = 15; // ± degrees of idle auto-rotate
const SWING_PERIOD = 16; // seconds per full swing

/**
 * A deck.gl OrbitView "skyline": one extruded ColumnLayer tower per occupied
 * building-hour. x = hour (7am→10pm), y = building (busiest nearest), height =
 * sections on the orange energy ramp; freed hours collapse to a flat ice-blue
 * pad. The scene sits on a subtle ground grid, is framed as a classic isometric
 * three-quarter view fit to its full 3D bounding box (footprint + tallest bar +
 * label gutter) with margin, and slowly auto-rotates ±15° until the user drags.
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

  // Normalised geometry: both axes span ~FOOT so the footprint reads square.
  const geo = useMemo(() => {
    const hourStep = FOOT / Math.max(1, nHours - 1);
    const rowStep = FOOT / Math.max(1, nBuildings - 1);
    const footW = (nHours - 1) * hourStep;
    const footH = (nBuildings - 1) * rowStep;
    const maxH = HEIGHT_FRAC * FOOT;
    const gutter = GUTTER_FRAC * FOOT;
    const colRadius = Math.min(hourStep, rowStep) * 0.42;
    const elevPerSection = maxH / max;
    const freedPad = maxH * 0.02;
    const labelX = -(colRadius + 8);
    // Centre of (gutter + footprint), lifted to ~35% of the max bar height.
    const center: [number, number, number] = [(footW - gutter) / 2, -footH / 2, maxH * 0.35];
    const bx = footW + gutter;
    const radius = 0.5 * Math.sqrt(bx * bx + footH * footH + maxH * maxH);
    return {
      hourStep,
      rowStep,
      footW,
      footH,
      maxH,
      gutter,
      colRadius,
      elevPerSection,
      freedPad,
      labelX,
      center,
      radius,
    };
  }, [nBuildings, nHours, max]);

  // Axis labels: building names right-aligned in the left gutter (thinned to
  // avoid overlap), hour ticks along the front edge.
  const textData = useMemo(() => {
    const items: {
      text: string;
      position: [number, number, number];
      anchor: 'start' | 'end' | 'middle';
    }[] = [];
    hours.forEach((h, i) => {
      items.push({
        text: hourLabel(h),
        position: [i * geo.hourStep, geo.rowStep * 0.9, 0],
        anchor: 'middle',
      });
    });
    const stride = nBuildings <= 16 ? 1 : nBuildings <= 28 ? 2 : 4;
    buildings.forEach((b, i) => {
      if (i % stride !== 0) return;
      const label = b.length > 22 ? `${b.slice(0, 21)}…` : b;
      items.push({ text: label, position: [geo.labelX, -i * geo.rowStep, 0], anchor: 'end' });
    });
    return items;
  }, [hours, buildings, nBuildings, geo]);

  // Subtle ground plane + grid so the bars read as standing on a surface.
  const ground = useMemo(() => {
    const pad = geo.rowStep * 0.5;
    const x0 = -geo.gutter;
    const x1 = geo.footW + geo.hourStep * 0.3;
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
        id: 'skyline-labels',
        data: textData,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getTextAnchor: (d) => d.anchor,
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
    const initial: OrbitViewState = {
      target: geo.center,
      rotationX: BASE_PITCH,
      rotationOrbit: BASE_ORBIT,
      zoom: 0,
      minZoom: -4,
      maxZoom: 6,
    };
    viewStateRef.current = initial;
    userRef.current = false;

    const deck = new Deck<OrbitView>({
      canvas: canvasRef.current,
      views: new OrbitView({ orbitAxis: 'Z', fovy: 40 }),
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

    // Fit the camera so the projected bounding box (footprint + tallest bar +
    // gutter) fits the smaller canvas dimension with an 8% margin.
    const fit = () => {
      const el = canvasRef.current;
      if (!el) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      const px = Math.min(w, h);
      const extent = 2 * geo.radius * FIT_MARGIN;
      const zoom = Math.log2(px / Math.max(1, extent));
      const next: OrbitViewState = {
        ...(viewStateRef.current ?? initial),
        target: geo.center,
        zoom,
      };
      viewStateRef.current = next;
      deck.setProps({ viewState: next });
    };
    fit();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        fit();
        deckRef.current?.redraw('resize');
      });
      ro.observe(canvasRef.current);
    }

    // Idle auto-rotate: swing the orbit ±15° until the user interacts.
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      if (!userRef.current && deckRef.current && viewStateRef.current) {
        const t = (performance.now() - start) / 1000;
        const orbit = BASE_ORBIT + ORBIT_SWING * Math.sin((t / SWING_PERIOD) * 2 * Math.PI);
        const vs: OrbitViewState = { ...viewStateRef.current, rotationOrbit: orbit };
        viewStateRef.current = vs;
        deckRef.current.setProps({ viewState: vs });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      deck.finalize();
      deckRef.current = null;
    };
    // Recreate only when the grid shape / scaling changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo]);

  // Push new layers whenever the data / scenario slice changes.
  useEffect(() => {
    deckRef.current?.setProps({ layers: buildLayers() });
  }, [buildLayers]);

  return <canvas ref={canvasRef} className="h-full w-full" />;
}
