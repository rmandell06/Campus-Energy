# Workspace Summary — pkg4cb7180d

**App:** **Block I/O** — "Illini Campus Energy Optimizer". Relocates "movable" class sections into already-occupied buildings to leave whole buildings dark and cut HVAC/energy. Dark-mode only (pinned in `main.tsx`; theme toggle removed from SideNav).

## Design system (frontend-only, Block I/O redesign)

- **Minimal monochrome dark theme** (Linear/Vercel/Stripe feel) implemented in `styles/campus-theme.css` (imported LAST). It re-skins all C3 primitives by overriding the Layer-3 `--c3-style-basic-*` role tokens + shadcn aliases — do NOT hardcode colors in components, override tokens here. Near-black page `#0a0a0b`, surfaces `#111113`/`#17171a`, hairline borders ~8% white, off-white ink `#ededed` / `#8a8a93`. Grayscale accent is near-white (Vercel-style primary button).
- **Colour reserved for DATA only:** `--data-amber #f5b041` (building running) and `--data-green #3ddc97` (savings / powered down / freed). The ONLY orange is the Illinois Block I logo `#FF5F05` (`components/BlockILogo/BlockILogo.tsx`).
- **Fonts:** Inter (`--font-display`, tight headline numbers) + mono readouts. Utility classes in campus-theme.css: `.panel`, `.eyebrow`, `.font-display`, `.tabnums`, `.mono`, `.text-amber/.text-green`, `.hud-corner(--tl/tr/bl/br)`, `.io-range`, `.io-typing-dot`, `.io-pulse`, `.io-bar-grow`.
- Chart colors come from `shared/format.ts` (`COLOR_RUNNING`/`COLOR_SAVED`, grayscale→amber `SEQ_HEAT`, `occupancyColor`).

## 3D Campus Map (signature feature)

- **Static asset:** `public/campus_buildings.geojson` (2049 OSM footprints; 87 matched to schedule buildings via `schedule_building` prop). Loaded once via `hooks/useCampusGeojson.ts` (`import.meta.env.BASE_URL + 'campus_buildings.geojson'`); also exposes the matched-name set.
- **`components/CampusMap3D/CampusMap3D.tsx`** — MapLibre GL (`maplibre-gl@4.7.1`), OpenFreeMap dark basemap w/ offline fallback, `fill-extrusion` of real footprints coloured by `feature-state` (amber intensity by sections, green = optimizer-freed, grays = context). Cinematic orbit until interaction. Use `import type { FeatureCollection } from 'geojson'` (the `GeoJSON.` global trips eslint no-undef).
- **`components/CampusMap3D/CampusMapPanel.tsx`** — reusable panel: weekday tabs + hour slider (7am–10pm) + Play + Current/Optimized toggle, mission-control HUD (mono readout, legend, corner brackets), hover tooltip, click→drawer (week heat strip + classes relocated out), and a "not on map" note for footprint-less schedule buildings.
- **`shared/campusModel.ts`** — `buildWeek(rows)` → `CampusWeek`; `stateForHour`, `hourCounts`, `weekMetrics`, `buildingsNotOnMap`. Fed by `energyApi.fetchAllBuildingHours()`.
- Rendered as the Overview hero (~60vh) AND the dedicated **`/campus-map`** page (`pages/CampusMap/CampusMap.tsx`, nav item "Campus Map").

## Overview headline metrics (live, from `fetchOverviewStats` + `fetchAllBuildingHours`)

Order under the map hero: (a) hero **$ saved/yr** + range (count-up via `hooks/useCountUp.ts`); (b) **Buildings that power down early** (≥1 freed hr/wk, out of N); (c) **Wasteful hours eliminated/week** (building-hours running only 1–2 classes, current→optimized); (d) **Tons CO₂ avoided/yr** + range. One line: "X classes change rooms. 0 class times change." Secondary weekday chart relabeled "Hours with HVAC off".

## Frontend (`ui/react/src/`)

- **Shell:** `App.tsx` picks a shell by viewport via `useIsMobile()`:
  - **Desktop (≥ md / 768px):** `DesktopShell` — unchanged original chrome: `TopNav` (top bar) + `SideNav` (left `SideNavPanelV2` rail) + `<main>` with routes.
  - **Mobile (< md):** `components/MobileNav/MobileShell.tsx` — touch-first: top app bar with hamburger → slide-in drawer (full nav list), plus a fixed **bottom tab bar** (primary destinations + "More" overflow → drawer).
- **Routes:** single source of truth in `components/AppRoutes/AppRoutes.tsx` (shared by both shells). Pages: `/` Overview, `/campus-map` CampusMap, `/heatmap` (+`/heatmap/:buildingId` BuildingDetail), `/study-spots` StudySpots, `/moves`, `/assumptions`, `/assistant`, `/data-source`.
- **Nav config:** `config/navigation.ts` (8 items incl. Campus Map + Study Spots). Drives both SideNav and the mobile shell. (SideNav theme toggle removed — app is dark-only.)
- **Study Spots** (`pages/StudySpots/StudySpots.tsx`, nav "Study Spots", `BookOpen` icon): energy-neutral open-room finder. Day pills + hour `<select>` + Optimized/Current scenario toggle → `energyApi.ts#fetchStudySpots` → `Room.findStudySpots(day, hour, scenario)`. Lists empty rooms ONLY in buildings already occupied that block (ranked quietest-occupied first), so a recommendation never wakes a dark building.
- **Breakpoint hook:** `hooks/useIsMobile.ts` (reactive `matchMedia`, `MOBILE_MAX_WIDTH` = 899px → desktop SideNav shell kicks in at ≥900px). Prefer over raw `window.innerWidth`.
- **Backend data:** pages fetch via `c3Action` (e.g. `OptimizationRun/overviewStats`). shared/ has `api.ts`, `energyApi.ts`, `savings.ts`, `format.ts`.

## Backend types (`src/`)

- Entities: `Building`, `Room`, `Section`, `BuildingHour` (Mon–Fri × hours 7..21; `sectionsCurrent`/`sectionsOptimized`), `OptimizationRun` (+`runOptimization`/`overviewStats`), `MoveRecommendation`, `SavingsAssumptions`, `EnergyAssistant`. Value types: `OverviewStats`, `WeekdayStat`, `SavingsResult`, `StudySpot`.
- **`Room.findStudySpots(day, hour, scenario)`** (`Room.py`) → `[StudySpot]`: empty rooms in buildings with `sectionsOptimized>=1` (scenario `'optimized'`, default) or `sectionsCurrent>=1` (`'current'`); applies accepted `MoveRecommendation`s to room schedules in the optimized case. Smoke-verified: 298 spots for M/10 optimized, 0 leaks from dark buildings, invalid day/hour → [].

## Key decisions

- Mobile navigation was added **without changing desktop code**: desktop JSX in `App.tsx` is preserved verbatim (now delegating its route table to the shared `AppRoutes`); mobile is a separate additive shell. Both render identical pages.

## Frontend NEXT PASS (2026-10, visual polish — frontend only, backend untouched)

- **Palette finalized (supersedes the amber/green note above).** Two data colours ONLY, defined in `styles/campus-theme.css`: **energy-on** Illini orange (ramp `#5a2206→#ff5f05→#ffb37a`, `--energy-on`) and **powered-down / saved** ice blue `#6ec1ff` (`--powered-down`). Amber/green rejected; `--data-amber`/`--data-green` kept only as aliases repointed to the two sanctioned tokens. UI chrome is strictly grayscale. `shared/format.ts` is FROZEN (`COLOR_RUNNING`/`COLOR_SAVED`, `ENERGY_ON_RGB`, `POWERED_DOWN_RGB`, `energyRampRgb`). `campus-theme.css` + `useCampusGeojson.ts` also treated as frozen foundation.
- **Map data v2.** `public/campus_buildings_v2.geojson` (2,115 footprints, 94 schedule-matched) + `public/building_centroids.json`; `useCampusGeojson` exposes `data`, `matched`, `centroids`.
- **deck.gl energy flow** (`@deck.gl/mapbox` MapboxOverlay in `CampusMap3D.tsx`): ArcLayer `moves` (orange→ice-blue), animated TripsLayer `flow`, pulsing ScatterplotLayer rings on powered-down buildings. `highlightArcId` dims all but one corridor (Moves mini-map). `campusModel.ts` adds `arcsForMoves`/`buildMoveArcs`, `poweredDownAt`, `centroidBounds`.
- **Camera (real-preview fix):** `centroidBounds` filters centroids to within 1.3 km of core `[-88.2272,40.1075]` (falls back to all if <2). `CampusMap3D` consts MIN_ZOOM 14.6 / MAX_ZOOM 16.2 / FIT_PITCH 60 / FIT_BEARING -18; `fitCore()` fits with maxZoom clamp + low-end `setZoom`; **Reset view** button lives in the bottom-right control stack (above the zoom buttons).
- **Collision-aware labels** (`CampusMap3D/labels.css` + imperative manager): priority-sorted (busiest first via `week.sectionsPerWeek`), screen-box packed on every move/zoom, ≤6 labels when zoom <15.5 else ≤15, 11px semi-transparent pill + leader line, hovered/selected building (`focusLabel` prop) always shown.
- **Heatmap 3D skyline** (`components/Skyline3D/Skyline3D.tsx`, OrbitView ColumnLayer): classic isometric three-quarter view (rotationOrbit/rotationX 35°), footprint normalised to ~square (`FOOT`), bar height capped `HEIGHT_FRAC 0.6`, subtle ground plane + grid, slow ±15° auto-rotate until drag. Building labels are a **top-most HTML overlay** (`skyline-labels.css`) positioned from live projected coords (never occluded by bars): right-aligned to end 10px before the first bar column, truncated to 22 chars, thinned to every 2nd row below 14px on-screen spacing. The `fit()` reserves a left pixel gutter sized to the widest label (worst case across the swing) so labels stay fully inside the canvas with 12px padding; re-fits on resize/row-set change. `pages/Heatmap/Heatmap.tsx` canvas height `clamp(420px,62vh,760px)`, colour legend + pinned hover readout; **2D / 3D / On map** toggle (On-map renders the shared `CampusMapPanel`), sortable top-40, click→`/heatmap/:id`.
- **Map-backbone pass (DONE):** shared 3D campus map now threads through every data page. (1) **Study Spots** has a `mode="study"` map at the top — ice-blue ramp by free-room count, click a building → popup of its open rooms, list ↔ map linked by hover/click + "Map" chip + selected-building filter chip. (2) desktop SideNav shell at ≥900px + full-content-width map on `/campus-map` (`md:px-0`). (3) Heatmap "On map" toggle (above). (4) **Moves** — checking table rows draws only those corridors' arcs on the inset map (select-all + per-row checkboxes, selected-row highlight, "N selected · Clear"). (5) **Assumptions** inset "Where the savings come from" (study-mode map, ice brightness = freed building-hours/week per building, from `fetchAllBuildingHours`) and **Assistant** shared inset that flies to + highlights the building named in the latest answer (study mode, single-building highlight, "Open full map" link).
- **CampusMap3D study mode:** `mode='study'` + `studyByBuilding` (name→count) + `maxFree` colours footprints on the ice ramp `#1b394d→#3f93d6→#6ec1ff`; `ExpressionSpecification` is a NAMED import from `maplibre-gl`.
- **Interactivity:** Overview "Play the day" cinematic (`playNonce`/`onCinematicEnd`) + clickable KPI drawers; Moves row-hover highlights arc on embedded mini-map + weekday/building filter chips; Assumptions live tween numbers + range-band chart; Assistant suggested chips + **"Show on map"** button on answers naming a building (deep-links `#/campus-map?building=&day=&hour=`, parsed by `CampusMap.tsx`); DataSource animated CSV→C3 pipeline (`pages/DataSource/pipeline.css`, staged reveal + flowing connectors) with live `fetchDataCounts()` record counts.
- **Verification note:** runtime map render / deck.gl animation / live `c3Action` data are only fully verifiable in the authenticated preview (local Playwright session is unauthenticated → `BuildingHour/fetch` 302s to Okta). Every step keeps `VITE_C3_PKG=pkg4cb7180d npm run build` green.
