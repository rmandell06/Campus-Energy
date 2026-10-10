/*
 * Copyright 2009-2026 C3 AI (www.c3.ai). All Rights Reserved.
 * Confidential and Proprietary C3 Materials.
 * This material, including without limitation any software, is the confidential trade secret and proprietary
 * information of C3 and its licensors. Reproduction, use and/or distribution of this material in any form is
 * strictly prohibited except as set forth in a written license agreement with C3 and/or its authorized distributors.
 * This material may be covered by one or more patents or pending patent applications.
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * The two audiences the app is built for. A student is looking for somewhere to sit; facilities is
 * looking for buildings to switch off. They never share a page, because the same map means two
 * different things to them.
 */
export type Role = 'student' | 'facilities';

/** Where the chosen role is remembered, so a returning visitor keeps their side of the app. */
const ROLE_KEY = 'blockio.role';

/** Home route for each role — also the route the landing-page cards navigate to. */
export const ROLE_HOME: Record<Role, string> = {
  student: '/student',
  facilities: '/facilities',
};

/** Human label for each role, used by the header switch and the landing cards. */
export const ROLE_LABEL: Record<Role, string> = {
  student: 'Student',
  facilities: 'Facilities',
};

interface RoleContextValue {
  /** The remembered role, or null when the visitor has never picked one. */
  role: Role | null;
  /** Remember a role (persisted). */
  setRole: (role: Role) => void;
  /** The role to treat as active for chrome purposes; falls back to `student`. */
  activeRole: Role;
}

const RoleContext = createContext<RoleContextValue | null>(null);

const readStoredRole = (): Role | null => {
  try {
    const stored = window.localStorage.getItem(ROLE_KEY);
    return stored === 'student' || stored === 'facilities' ? stored : null;
  } catch {
    // Private mode / blocked storage: the app still works, it just forgets the choice.
    return null;
  }
};

/**
 * Remembers which audience the visitor said they were.
 *
 * The role drives three things: which pages the sidebar and bottom tab bar list, which suggested
 * chips the agent offers, and where the header's switch sends you. It is deliberately stored in
 * `localStorage` rather than the URL so that a refresh or a shared link does not silently put a
 * student into the facilities console.
 */
export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<Role | null>(readStoredRole);

  const setRole = useCallback((next: Role) => {
    setRoleState(next);
    try {
      window.localStorage.setItem(ROLE_KEY, next);
    } catch {
      // Ignore storage failures — the choice still holds for this session.
    }
  }, []);

  const value = useMemo<RoleContextValue>(
    () => ({ role, setRole, activeRole: role ?? 'student' }),
    [role, setRole],
  );

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

/** Access the remembered role. Throws if used outside {@link RoleProvider}. */
export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error('useRole must be used inside a RoleProvider');
  return ctx;
}

/**
 * The role implied by a pathname, independent of what is remembered.
 *
 * The chrome needs this because a visitor can land directly on `/facilities/swaps` from a link or a
 * refresh: the route is the authority on which side of the app is on screen, and the remembered
 * role is only the fallback for routes that belong to neither (the landing page, About the data).
 */
export function roleForPath(pathname: string): Role | null {
  if (pathname === '/student' || pathname.startsWith('/student/')) return 'student';
  if (pathname === '/facilities' || pathname.startsWith('/facilities/')) return 'facilities';
  return null;
}
