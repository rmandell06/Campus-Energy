/*
 * Copyright 2009-2026 C3 AI (www.c3.ai). All Rights Reserved.
 * Confidential and Proprietary C3 Materials.
 * This material, including without limitation any software, is the confidential trade secret and proprietary
 * information of C3 and its licensors. Reproduction, use and/or distribution of this material in any form is
 * strictly prohibited except as set forth in a written license agreement with C3 and/or its authorized distributors.
 * This material may be covered by one or more patents or pending patent applications.
 */

import React from 'react';
import SideNav from './components/SideNav/SideNav';
import TopNav from './components/TopNav/TopNav';
import ErrorReporterProvider from './components/ErrorBoundary/ErrorBoundary';
import AppRoutes from './components/AppRoutes/AppRoutes';
import MobileShell from './components/MobileNav/MobileShell';
import { useIsMobile } from './hooks/useIsMobile';

const APP_TITLE = 'Block I/O';
const APP_SUBTITLE = 'Illini Campus Energy Optimizer';
const APP_FOOTER =
  'Student hackathon project built on C3 Code. Not an official University of Illinois product.';

/**
 * Desktop application shell.
 *
 * The chrome — {@link TopNav} across the top and {@link SideNav} down the left —
 * is rendered here, OUTSIDE the route table, so it is present on **every** page.
 * The router (via {@link AppRoutes}) only ever swaps the `<main>` content; the
 * top bar and side nav are part of the shell and cannot be dropped by an
 * individual page. Per the C3 Design System, the TopNavBar is expected on every
 * screen — keep it mounted here and do not move it inside a route.
 *
 * This markup is unchanged from the original shell; it now delegates the route
 * table to {@link AppRoutes} (which the mobile shell also uses) so there is a
 * single source of truth for routes.
 */
function DesktopShell() {
  return (
    <div className="h-screen flex flex-col max-w-full overflow-hidden">
      <TopNav title={APP_TITLE} subtitle={APP_SUBTITLE} />
      <div className="flex flex-1 min-h-0">
        <SideNav />
        <div className="flex-1 flex flex-col min-w-0">
          <main className="flex-1 overflow-auto bg-[var(--c3-style-basic-bg-page)]">
            <AppRoutes />
          </main>
          <footer className="shrink-0 border-t border-[var(--c3-style-basic-border-border)] bg-[var(--c3-style-basic-bg-primary)] px-6 py-2 text-[11px] text-[var(--c3-style-basic-fg-neutral)]">
            {APP_FOOTER}
          </footer>
        </div>
      </div>
    </div>
  );
}

/**
 * Application root.
 *
 * Picks the shell by viewport: the touch-first {@link MobileShell} below the
 * `md` breakpoint, and the unchanged {@link DesktopShell} at `md` and above.
 * Both render the shared {@link AppRoutes}, so the pages are identical — only
 * the navigation chrome differs.
 */
export default function App() {
  const isMobile = useIsMobile();

  return (
    <ErrorReporterProvider>
      {isMobile ? <MobileShell title={APP_TITLE} routes={<AppRoutes />} /> : <DesktopShell />}
    </ErrorReporterProvider>
  );
}
