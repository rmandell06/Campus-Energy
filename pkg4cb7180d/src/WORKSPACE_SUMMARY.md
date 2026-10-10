# Workspace Summary

Campus Energy Optimizer — a C3 app over the real UIUC Fall 2026 class schedule that consolidates
movable sections to free building-hours for HVAC setback.

## Packages
- `pkg4cb7180d` (main) — the whole app.

## Backend types (`src/`)
- **Building** (id = name): sectionsPerWeek, isSpecialtyVenue, grossSqFt?, hvacKwhPerHour?; rooms[], buildingHours[].
- **Room** (id = "Building Room"): roomName, typesHosted[string], sectionCount; building→Building; sections[].
- **Section** (id = sid): crn, subject, number, section, **sectionType** (NOT `type` — reserved), days, startMin, endMin, startTime, endTime, movable; room→Room.
- **BuildingHour** (id = "building|day|hour"): building→Building, day, hour, sectionsCurrent, sectionsOptimized.
- **MoveRecommendation**: section, fromRoom, toRoom, buildingHoursFreed, status (proposed/accepted/rejected; optimizer sets **accepted**), optimizationRun; denormalized courseLabel/sectionLabel/typeCode/days/timeLabel.
- **OptimizationRun** (id): timestamp, paramsJson, emptyHoursBefore/After, movesCount; moves[].
- **SavingsAssumptions** (singleton id="default"): low/mid/high kwhPerFreedHour, electricityPrice, emissionFactor; weeksPerSemester=15, semestersPerYear=2.
- Value types: **WeekdayStat**, **SavingsResult**, **OverviewStats**.

### Backend methods (Python)
- `OptimizationRun.runOptimization(hourStart,hourEnd,maxOccupancyToEvacuate,days[],excludeBuildings[])` → persists run, clears+creates MoveRecommendations (status accepted), overwrites BuildingHour.sectionsOptimized. Greedy consolidation heuristic. Verified: 4630→5313 empty, 683 freed, 361 moves (ref 662/358, within ±15%).
- `OptimizationRun.latest()`, `OptimizationRun.overviewStats()` → OverviewStats (KPIs + per-weekday + savings from accepted moves).
- `SavingsAssumptions.getOrCreate()`, `.compute(freedHoursPerWeek)` → SavingsResult.
- **EnergyAssistant** (`ask(question)`): grounded assistant. Builds factual context from overviewStats + assumptions + top donor/receiver buildings, asks `GenaiCore.Llm.Completion.Client.forConfigKey("default-completions")` (options `{returnJson:true}`), falls back to deterministic grounded answer if no LLM. Verified on all 4 reference questions.

## Data (`data/`, `seed/`)
- `data/Building|Room|Section|BuildingHour/*.json` loaded from attached CSVs (106 / 790 / 7010 / 7950). `data/SavingsAssumptions/default.json`.
- Loaded via `upsertSeedData`. Baseline empty building-hours = 4630 (verified).

## UI pages / routes
- `/` **Overview** (`pages/Overview`): title/subtitle, problem statement, empty-hours before→after, KPI range cards (MWh/$/CO2), per-weekday current-vs-optimized bar chart, Run optimizer dialog (`components/RunOptimizerDialog`).
- `/heatmap` **Heatmap** (`pages/Heatmap/Heatmap`): buildings × hour grid, weekday selector, current/optimized toggle, click building → detail.
- `/heatmap/:buildingId` **BuildingDetail** (`pages/Heatmap/BuildingDetail`): week grid for one building + sections moved out.
- `/moves` **Moves** (`pages/Moves`): filterable table, accept/reject (single + bulk), KPIs from accepted only (live via `shared/savings.ts`), CSV export.
- `/assumptions` **Assumptions** (`pages/Assumptions`): editable low/mid/high table, live KPI update, Save (merge), setback note.
- `/assistant` **AI Assistant** (`pages/Assistant`): chat UI, 4 suggested questions → `EnergyAssistant.ask`.
- `/data-source` **Data Source** (`pages/DataSource`): live counts + Course Explorer refresh pipeline.
- Shared: `shared/energyApi.ts` (c3Action wrappers), `shared/format.ts` (colors/formatters), `shared/savings.ts` (client mirror of compute). Nav in `config/navigation.ts`.

## Key decisions
- `Section.type` renamed `sectionType` (C3 reserves `type`).
- Moves default to **accepted** so Overview shows the optimized scenario immediately.
- runPyCode quirk: keep the trailing result expression on ONE line.
- Optimizer occupancy recomputation exactly matches the CSV baseline (verified 0 cell mismatches).
