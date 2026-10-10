/*
 * Copyright 2009-2026 C3 AI (www.c3.ai). All Rights Reserved.
 * Confidential and Proprietary C3 Materials.
 * This material, including without limitation any software, is the confidential trade secret and proprietary
 * information of C3 and its licensors. Reproduction, use and/or distribution of this material in any form is
 * strictly prohibited except as set forth in a written license agreement with C3 and/or its authorized distributors.
 * This material may be covered by one or more patents or pending patent applications.
 */

import { ArrowLeftRight, Database, Home, Map, MoonStar, Search } from 'lucide-react';

import type { Role } from '@/contexts/RoleProvider';
import { NavigationItem } from '@/types/navigation';

/**
 * The one destination both roles share at the very top of the nav: back to the landing page, where a
 * visitor can switch roles or re-read the pitch. Prepended to every role's list.
 */
const HOME_NAV: NavigationItem = {
  id: 'home',
  path: '/',
  icon: Home,
  iconActive: Home,
  label: 'Home',
  tooltip: 'Back to the Illini I/O landing page',
};

/**
 * Navigation is scoped by audience rather than global.
 *
 * A student only ever needs to find a room, and a facilities manager only ever needs the campus
 * plan — showing either of them the other's pages is the fastest way to make the app
 * incomprehensible in the first five seconds. "About the data" is the one page both roles get,
 * because provenance matters to both.
 *
 * To add a page: add it here under the role that owns it, then register the same path in
 * {@link AppRoutes}.
 */
const STUDENT_NAV: NavigationItem[] = [
  HOME_NAV,
  {
    id: 'student-home',
    path: '/student',
    icon: Search,
    iconActive: Search,
    label: 'Find a room',
    tooltip: 'Open, class-free rooms in buildings that are already on',
  },
  {
    id: 'about-data-student',
    path: '/about-data',
    icon: Database,
    iconActive: Database,
    label: 'About the data',
    tooltip: 'Where the numbers come from',
  },
];

const FACILITIES_NAV: NavigationItem[] = [
  HOME_NAV,
  {
    id: 'facilities-home',
    path: '/facilities',
    icon: Map,
    iconActive: Map,
    label: 'Campus map',
    tooltip: 'Which buildings can power down this hour',
  },
  {
    id: 'facilities-swaps',
    path: '/facilities/swaps',
    icon: ArrowLeftRight,
    iconActive: ArrowLeftRight,
    label: 'Room swaps',
    tooltip: 'Same time, different room — approve or reject each swap',
  },
  {
    id: 'facilities-setback',
    path: '/facilities/setback',
    icon: MoonStar,
    iconActive: MoonStar,
    label: 'Setback schedule',
    tooltip: 'Per-building windows that are safe to set back',
  },
  {
    id: 'about-data-facilities',
    path: '/about-data',
    icon: Database,
    iconActive: Database,
    label: 'About the data',
    tooltip: 'Where the numbers come from',
  },
];

/** The pages the given role is allowed to see, in sidebar / tab-bar order. */
export function navForRole(role: Role): NavigationItem[] {
  return role === 'facilities' ? FACILITIES_NAV : STUDENT_NAV;
}

/**
 * Every navigable destination across both roles.
 *
 * Only for chrome that must resolve a path it did not render itself — deriving the active item when
 * a visitor deep-links into the other role's page, for instance. Never render this list directly;
 * use {@link navForRole} so a role never sees the other's pages.
 */
export const allNavigationItems: NavigationItem[] = [...STUDENT_NAV, ...FACILITIES_NAV];
