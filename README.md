# Illini I/O — Illini Campus Energy Optimizer

**Illini I/O** turns the University of Illinois class schedule into an energy-savings engine. It relocates *movable* class sections into buildings that are already occupied, so entire buildings can go dark during low-use hours — cutting HVAC and lighting energy **without changing a single class time**.

Built on the **C3 AI Platform** with a React + TypeScript frontend and a signature 3D campus map.

---

## What it does

- **Optimizes the schedule for energy, not convenience.** Only room assignments change; class *times* never move. The optimizer consolidates classes so whole buildings can be set back or powered down.
- **Quantifies the win.** Live headline metrics: dollars saved per year, buildings that power down early, wasteful building-hours eliminated per week, and tons of CO₂ avoided — each with a confidence range.
- **Shows it on a real 3D map.** A MapLibre GL + deck.gl campus map renders actual building footprints, animates classes relocating as energy-flow arcs, and pulses the buildings that get powered down.
- **Serves two audiences through one assistant ("Illini I/O"):**
  - **Students** — "find me a quiet room near HERE Champaign free for 2 hours" → energy-neutral open-room recommendations that never wake a dark building.
  - **Facilities** — "what's the impact of closing Noyes Lab on the least-used days?" → relocation feasibility, hours freed, and annualized savings.

## How the AI works

The Illini I/O assistant (`BlockIoAgent`) is an **LLM-intent-router over a deterministic engine**. The LLM only ever extracts a structured intent and slots (course, day, hour, place, duration) — it never produces a number the user sees. Every figure is copied from a grounded tool result (`AgentTools`, `OptimizationRun`), and course identity is resolved by exact schedule lookup, never fuzzy matching. If the LLM is unavailable, the router falls back to deterministic parsing, so the assistant still works. Role (student vs. facilities) is authoritative and decides which actions are even allowed.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Platform / backend | **C3 AI Platform**, Python type implementations, C3 `GenaiCore` LLM completions |
| Frontend | **React 18**, **TypeScript**, **Vite** |
| Maps & dataviz | **MapLibre GL**, **deck.gl**, ECharts, Recharts |
| Styling | Tailwind CSS v4, Radix UI, custom dark monochrome theme |
| Data | C3 entity types (`Building`, `Room`, `Section`, `BuildingHour`, `OptimizationRun`, …) seeded from real campus schedule data |

All UI pages fetch live data from the C3 backend via `c3Action` — no hardcoded data.

## Project structure

```
pkg4cb7180d/
  src/                  C3 types (.c3typ) + Python implementations
  ui/react/src/         React app (pages, components, 3D map, shared libs)
  data/                 Seed/reference data (buildings, rooms, sections, hours)
  resource/             Workspace documentation
```

## Authors

- **Yash Yardi**
- **Shrishant Hattarki**
- **Bobby Mandell**
