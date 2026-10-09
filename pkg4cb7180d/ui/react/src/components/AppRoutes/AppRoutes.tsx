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
import Assistant from '@/pages/Assistant/Assistant';
import DataSource from '@/pages/DataSource/DataSource';

/** Wrap a page element in its own render-error boundary (see PageErrorBoundary). */
function guard(element: React.ReactNode): React.ReactNode {
  return <PageErrorBoundary>{element}</PageErrorBoundary>;
}

/**
 * The single source of truth for the application's route table.
 *
 * Extracted so both the desktop shell ({@link App}) and the mobile shell
 * ({@link MobileShell}) render the exact same routes without duplicating the
 * list. The route definitions here are identical to those previously inlined in
 * `App.tsx`, so desktop rendering is unchanged.
 */
export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={guard(<Overview />)} />
      <Route path="/campus-map" element={guard(<CampusMap />)} />
      <Route path="/heatmap" element={guard(<Heatmap />)} />
      <Route path="/heatmap/:buildingId" element={guard(<BuildingDetail />)} />
      <Route path="/study-spots" element={guard(<StudySpots />)} />
      <Route path="/moves" element={guard(<Moves />)} />
      <Route path="/assumptions" element={guard(<Assumptions />)} />
      <Route path="/assistant" element={guard(<Assistant />)} />
      <Route path="/data-source" element={guard(<DataSource />)} />
      <Route
        path="*"
        element={
          import.meta.env.MODE === 'development' ? (
            <div className="flex h-full items-center justify-center p-8 text-center text-[var(--c3-style-basic-fg-neutral)]">
              <p>No route matched. Add routes in AppRoutes.tsx.</p>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-[var(--c3-style-basic-fg-neutral)]">
              <p>Page not found.</p>
            </div>
          )
        }
      />
    </Routes>
  );
}
