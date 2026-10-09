/*
 * Copyright 2009-2026 C3 AI (www.c3.ai). All Rights Reserved.
 * Confidential and Proprietary C3 Materials.
 * This material, including without limitation any software, is the confidential trade secret and proprietary
 * information of C3 and its licensors. Reproduction, use and/or distribution of this material in any form is
 * strictly prohibited except as set forth in a written license agreement with C3 and/or its authorized distributors.
 * This material may be covered by one or more patents or pending patent applications.
 */

import { LayoutDashboard, Map, Grid3x3, BookOpen, ArrowLeftRight, SlidersHorizontal, Bot, Database } from 'lucide-react';

import { NavigationItem } from '@/types/navigation';

/**
 * Navigation configuration for the application
 * To add a new page:
 * 1. Add a new item to this array
 * 2. Make sure the path matches your route in App.tsx
 * 3. Add the corresponding page component
 */
export const navigationConfig: NavigationItem[] = [
  {
    id: 'overview',
    path: '/',
    icon: LayoutDashboard,
    iconActive: LayoutDashboard,
    label: 'Overview',
    tooltip: 'Campus energy overview',
  },
  {
    id: 'campus-map',
    path: '/campus-map',
    icon: Map,
    iconActive: Map,
    label: 'Campus Map',
    tooltip: 'Interactive 3D campus map',
  },
  {
    id: 'heatmap',
    path: '/heatmap',
    icon: Grid3x3,
    iconActive: Grid3x3,
    label: 'Heatmap',
    tooltip: 'Building occupancy heatmap',
  },
  {
    id: 'study-spots',
    path: '/study-spots',
    icon: BookOpen,
    iconActive: BookOpen,
    label: 'Study Spots',
    tooltip: 'Energy-neutral open study rooms',
  },
  {
    id: 'moves',
    path: '/moves',
    icon: ArrowLeftRight,
    iconActive: ArrowLeftRight,
    label: 'Moves',
    tooltip: 'Relocation recommendations',
  },
  {
    id: 'assumptions',
    path: '/assumptions',
    icon: SlidersHorizontal,
    iconActive: SlidersHorizontal,
    label: 'Assumptions',
    tooltip: 'Savings assumptions',
  },
  {
    id: 'assistant',
    path: '/assistant',
    icon: Bot,
    iconActive: Bot,
    label: 'AI Assistant',
    tooltip: 'Ask the energy assistant',
  },
  {
    id: 'data-source',
    path: '/data-source',
    icon: Database,
    iconActive: Database,
    label: 'Data Source',
    tooltip: 'Data provenance & refresh',
  },
];

/**
 * Helper function to add navigation item dynamically
 */
export const addNavigationItem = (item: NavigationItem) => {
  navigationConfig.push(item);
};

/**
 * Helper function to remove navigation item
 */
export const removeNavigationItem = (id: string) => {
  const index = navigationConfig.findIndex((item) => item.id === id);
  if (index > -1) {
    navigationConfig.splice(index, 1);
  }
};

/**
 * Helper function to update badge count
 */
export const updateNavigationBadge = (id: string, badge?: number) => {
  const item = navigationConfig.find((item) => item.id === id);
  if (item) {
    item.badge = badge;
  }
};
