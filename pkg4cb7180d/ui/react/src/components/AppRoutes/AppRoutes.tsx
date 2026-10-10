/*
 * Copyright 2009-2026 C3 AI (www.c3.ai). All Rights Reserved.
 * Confidential and Proprietary C3 Materials.
 * This material, including without limitation any software, is the confidential trade secret and proprietary
 * information of C3 and its licensors. Reproduction, use and/or distribution of this material in any form is
 * strictly prohibited except as set forth in a written license agreement with C3 and/or its authorized distributors.
 * This material may be covered by one or more patents or pending patent applications.
 */

import React from 'react';
import { Route, Routes } from 'react-router-dom';

import PageErrorBoundary from '@/components/ErrorBoundary/PageErrorBoundary';
import Overview from '@/pages/Overview/Overview';
import CampusMap from '@/pages/CampusMap/CampusMap';
import Heatmap from '@/pages/Heatmap/Heatmap';
import BuildingDetail from '@/pages/Heatmap/BuildingDetail';
import StudySpots from '@/pages/StudySpots/StudySpots';
import Moves from '@/pages/Moves/Moves';
import Assumptions from '@/pages/Assumptions/Assumptions';
import DataSource from '@/pages/DataSource/DataSource';

/** Wrap a page element in its own render-error boundary (see PageErrorBoundary). */
function guard(element: React.ReactNode): React.ReactNode {
  return <PageErrorBoundary>{element}</PageErrorBoundary>;
}

/**
 * The single source of truth for the application's route table.
 *
 * The landing page (`/`) is rendered chrome-free by {@link App} and is deliberately NOT listed here,
 * so it never inherits the shell. Everything below renders inside the shell (top bar + side nav).
 *
 * The two audience homes are `/student` (find a room) and `/facilities` (the campus plan). The
 * remaining facilities pages hang off `/facilities/*`. The legacy paths are kept as working aliases
 * so in-page links and deep links from the previous structure still resolve while the audience-first
 * pages are being finished.
 */
export default function AppRoutes() {
  return (
    <Routes>
      {/* Student */}
      <Route path="/student" element={guard(<StudySpots />)} />

      {/* Facilities */}
      <Route path="/facilities" element={guard(<CampusMap />)} />
      <Route path="/facilities/swaps" element={guard(<Moves />)} />
      <Route path="/facilities/setback" element={guard(<Assumptions />)} />

      {/* Shared */}
      <Route path="/about-data" element={guard(<DataSource />)} />

      {/* Legacy aliases — kept resolving while the new pages are finished */}
      <Route path="/overview" element={guard(<Overview />)} />
      <Route path="/campus-map" element={guard(<CampusMap />)} />
      <Route path="/heatmap" element={guard(<Heatmap />)} />
      <Route path="/heatmap/:buildingId" element={guard(<BuildingDetail />)} />
      <Route path="/study-spots" element={guard(<StudySpots />)} />
      <Route path="/moves" element={guard(<Moves />)} />
      <Route path="/assumptions" element={guard(<Assumptions />)} />
      <Route path="/data-source" element={guard(<DataSource />)} />

      <Route
        path="*"
        element={
          <div className="flex h-full items-center justify-center p-8 text-center text-[var(--c3-style-basic-fg-neutral)]">
            <p>Page not found.</p>
          </div>
        }
      />
    </Routes>
  );
}
