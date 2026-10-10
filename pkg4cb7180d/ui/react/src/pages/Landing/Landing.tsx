/*
 * Copyright 2009-2026 C3 AI (www.c3.ai). All Rights Reserved.
 * Confidential and Proprietary C3 Materials.
 * This material, including without limitation any software, is the confidential trade secret and proprietary
 * information of C3 and its licensors. Reproduction, use and/or distribution of this material in any form is
 * strictly prohibited except as set forth in a written license agreement with C3 and/or its authorized distributors.
 * This material may be covered by one or more patents or pending patent applications.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FeatureCollection } from 'geojson';
import { ArrowRight, GraduationCap, Wrench } from 'lucide-react';

import CampusMap3D from '@/components/CampusMap3D/CampusMap3D';
import { useCampusGeojson } from '@/hooks/useCampusGeojson';
import { useRole, ROLE_HOME } from '@/contexts/RoleProvider';
import { useAssumptions } from '@/contexts/AssumptionsProvider';
import { fetchAllBuildingHours } from '@/shared/energyApi';
import { buildWeek, stateForHour, type CampusWeek } from '@/shared/campusModel';

/** The "powered down with Illini I/O" slice of the week shown spinning behind the hero. */
const HERO_DAY = 'W';
const HERO_HOUR = 19; // 7pm — many buildings are dark under the optimized plan.

/** Format a dollar amount compactly: $1.2M, $340K, $900. */
function money(amount: number): string {
  const a = Math.max(0, amount || 0);
  if (a >= 1_000_000) return `$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `$${Math.round(a / 1_000)}K`;
  return `$${Math.round(a)}`;
}

/**
 * Landing page (chrome-free, route `/`).
 *
 * The first screen a visitor sees: the real campus slowly orbiting behind a left-aligned pitch, the
 * two audiences as dark glass cards, and three live numbers — dollars, buildings powered down, and
 * tons of CO₂ — pulled straight from the shared assumptions store so they match the rest of the app.
 */
export default function Landing() {
  const navigate = useNavigate();
  const { setRole } = useRole();
  const { savings } = useAssumptions();
  const geo = useCampusGeojson();

  const [week, setWeek] = useState<CampusWeek | null>(null);
  const [poweredDown, setPoweredDown] = useState(0);
  const [totalBuildings, setTotalBuildings] = useState(0);

  useEffect(() => {
    let alive = true;
    fetchAllBuildingHours()
      .then((hours) => {
        if (!alive) return;
        setWeek(buildWeek(hours));
        // Buildings that power down early = buildings with ≥1 hour lit today but dark under the plan.
        const down = new Set<string>();
        const all = new Set<string>();
        for (const h of hours) {
          const bid = h.building?.id;
          if (!bid) continue;
          all.add(bid);
          if ((h.sectionsCurrent ?? 0) > 0 && (h.sectionsOptimized ?? 0) === 0) down.add(bid);
        }
        setPoweredDown(down.size);
        setTotalBuildings(all.size);
      })
      .catch(() => {
        if (alive) {
          setWeek(null);
          setPoweredDown(0);
          setTotalBuildings(0);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const heroState = useMemo(
    () => (week ? stateForHour(week, HERO_DAY, HERO_HOUR, 'optimized') : {}),
    [week],
  );

  const choose = (role: 'student' | 'facilities') => {
    setRole(role);
    navigate(ROLE_HOME[role]);
  };

  const showMap = Boolean(geo.data) && week !== null;

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#070a14]">
      {/* Fallback glow — a navy-to-black field with a subtle orange ember, always behind the map. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_28%_18%,rgba(255,95,5,0.20),transparent_55%)]"
      />

      {/* Full-bleed campus map: non-interactive, slowly orbiting in the optimized ("powered down")
          view. On-canvas controls are hidden so it reads as pure backdrop. */}
      {showMap ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [&_.io-chip]:hidden [&_.maplibregl-ctrl]:hidden [&_.maplibregl-control-container]:hidden"
        >
          <CampusMap3D
            geojson={geo.data as FeatureCollection}
            stateByBuilding={heroState}
            maxSections={week?.maxPerHour ?? 1}
            mode="energy"
            autoOrbit
          />
        </div>
      ) : null}

      {/* Dark gradient overlay for legibility over the moving map. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/90 via-black/60 to-black/30"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/40"
      />

      {/* Content */}
      <div className="relative z-10 flex min-h-screen w-full flex-col justify-center px-6 py-12 sm:px-10 lg:px-16">
        <div className="w-full max-w-2xl">
          {/* Hero */}
          <h1 className="font-display text-5xl font-bold leading-none tracking-tight text-white sm:text-6xl lg:text-[64px]">
            Illini <span className="text-[#FF5F05]">I/O</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-white/80 sm:text-xl">
            Find a room to study. Help campus waste less energy.
          </p>
          <p className="mt-3 text-xs tracking-wide text-white/45">
            Built on C3 AI · Real UIUC Fall 2026 schedule · 7,010 classes
          </p>

          {/* Role cards */}
          <div className="mt-9 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <RoleCard
              icon={<GraduationCap className="size-6" />}
              title="I'm a student"
              body="Find an open, class-free room right now — in a building that's already heated and lit."
              cta="Find a room"
              accent="#7CC0FF"
              onClick={() => choose('student')}
            />
            <RoleCard
              icon={<Wrench className="size-6" />}
              title="I'm in Facilities"
              body="See which buildings can power down early, and plan the room swaps that make it happen."
              cta="See the plan"
              accent="#FF5F05"
              onClick={() => choose('facilities')}
            />
          </div>

          {/* Live stats */}
          <div className="mt-10 grid grid-cols-3 gap-4 sm:gap-8">
            <Stat
              value={`${money(savings.dollarsMid)}/yr`}
              label="Estimated energy saved"
              className="text-[#FF5F05]"
            />
            <Stat
              value={totalBuildings ? `${poweredDown} of ${totalBuildings}` : '—'}
              label="Buildings power down early"
              className="text-white"
            />
            <Stat
              value={`${Math.round(savings.co2TonsMid).toLocaleString()} t`}
              label="CO₂ avoided per year"
              className="text-[#34C77B]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** A dark glass audience card that lifts and shows its accent border on hover. */
function RoleCard({
  icon,
  title,
  body,
  cta,
  accent,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  cta: string;
  accent: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ '--accent': accent } as React.CSSProperties}
      className="group flex flex-col items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-6 text-left backdrop-blur-md transition-all duration-200 hover:-translate-y-1 hover:border-[var(--accent)] hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      <span
        className="inline-flex size-11 items-center justify-center rounded-xl bg-white/10 text-[var(--accent)]"
      >
        {icon}
      </span>
      <span className="text-lg font-semibold text-white">{title}</span>
      <span className="text-sm leading-relaxed text-white/65">{body}</span>
      <span className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent)]">
        {cta}
        <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-1" />
      </span>
    </button>
  );
}

/** A single big live number with a small muted label. */
function Stat({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className: string;
}) {
  return (
    <div className="flex flex-col">
      <span
        className={`font-display text-2xl font-bold leading-none tabnums sm:text-4xl ${className}`}
      >
        {value}
      </span>
      <span className="mt-2 text-[11px] leading-tight text-white/50 sm:text-xs">{label}</span>
    </div>
  );
}
