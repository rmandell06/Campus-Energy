/*
 * Copyright 2009-2026 C3 AI (www.c3.ai). All Rights Reserved.
 * Confidential and Proprietary C3 Materials.
 * This material, including without limitation any software, is the confidential trade secret and proprietary
 * information of C3 and its licensors. Reproduction, use and/or distribution of this material in any form is
 * strictly prohibited except as set forth in a written license agreement with C3 and/or its authorized distributors.
 * This material may be covered by one or more patents or pending patent applications.
 */

import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeftRight } from 'lucide-react';

import SideNav from './components/SideNav/SideNav';
import TopNav from './components/TopNav/TopNav';
import ErrorReporterProvider from './components/ErrorBoundary/ErrorBoundary';
import AppRoutes from './components/AppRoutes/AppRoutes';
import MobileShell from './components/MobileNav/MobileShell';
import AgentPanel from './components/AgentPanel/AgentPanel';
import Landing from './pages/Landing/Landing';
import { useIsMobile } from './hooks/useIsMobile';
import { AssumptionsProvider } from './contexts/AssumptionsProvider';
import {
  RoleProvider,
  useRole,
  roleForPath,
  ROLE_HOME,
  ROLE_LABEL,
  type Role,
} from './contexts/RoleProvider';

const APP_TITLE = 'Illini I/O';
const APP_SUBTITLE = 'Illini Campus Energy Optimizer';
const APP_FOOTER =
  'Student hackathon project built on C3 Code. Not an official University of Illinois product.';

/**
 * Header control that flips between the two audiences.
 *
 * The label always names the *other* role ("Switch to Facilities" while a student is browsing), and
 * the active side is taken from the route so a deep link shows the right label. Switching remembers
 * the new role and jumps to its home page.
 */
function RoleToggle() {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeRole, setRole } = useRole();
  const current: Role = roleForPath(location.pathname) ?? activeRole;
  const other: Role = current === 'student' ? 'facilities' : 'student';

  return (
    <button
      type="button"
      onClick={() => {
        setRole(other);
        navigate(ROLE_HOME[other]);
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-[var(--c3-style-basic-border-border)] px-3 py-1.5 text-c3-regular-label-l2 text-[var(--c3-style-basic-fg-primary)] hover:bg-[var(--c3-style-basic-bg-secondary)]"
    >
      <ArrowLeftRight className="size-4" />
      Switch to {ROLE_LABEL[other]}
    </button>
  );
}

/**
 * Desktop application shell.
 *
 * The chrome — {@link TopNav} across the top and {@link SideNav} down the left — is rendered here,
 * OUTSIDE the route table, so it is present on every in-app page. The router (via {@link AppRoutes})
 * only ever swaps the `<main>` content.
 */
function DesktopShell() {
  return (
    <div className="h-screen flex flex-col max-w-full overflow-hidden">
      <TopNav title={APP_TITLE} subtitle={APP_SUBTITLE} actions={<RoleToggle />} />
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
 * Shell selector.
 *
 * The landing page (`/`) renders chrome-free — no top bar, no side nav — because it is where the
 * visitor chooses a role before any of that chrome would make sense. Every other route renders
 * inside the viewport-appropriate shell: the touch-first {@link MobileShell} below the `md`
 * breakpoint, the {@link DesktopShell} at and above it.
 */
function Shell() {
  const location = useLocation();
  const isMobile = useIsMobile();

  if (location.pathname === '/') {
    return <Landing />;
  }

  // The agent is docked on the two audience consoles — the pages that host the map it acts on.
  const showAgent = roleForPath(location.pathname) !== null;

  return (
    <>
      {isMobile ? <MobileShell title={APP_TITLE} routes={<AppRoutes />} /> : <DesktopShell />}
      {showAgent && <AgentPanel />}
    </>
  );
}

/**
 * Application root. Wraps the whole app in the {@link RoleProvider} (so the sidebar, the agent chips
 * and the header toggle all read the same remembered audience) and the error reporter.
 */
export default function App() {
  return (
    <ErrorReporterProvider>
      <RoleProvider>
        <AssumptionsProvider>
          <Shell />
        </AssumptionsProvider>
      </RoleProvider>
    </ErrorReporterProvider>
  );
}
