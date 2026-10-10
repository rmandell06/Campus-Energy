/*
 * Copyright 2009-2026 C3 AI (www.c3.ai). All Rights Reserved.
 * Confidential and Proprietary C3 Materials.
 * This material, including without limitation any software, is the confidential trade secret and proprietary
 * information of C3 and its licensors. Reproduction, use and/or distribution of this material in any form is
 * strictly prohibited except as set forth in a written license agreement with C3 and/or its authorized distributors.
 * This material may be covered by one or more patents or pending patent applications.
 */

import { useEffect } from 'react';

export type ThemeType = 'light' | 'dark';

const STORAGE_KEY = 'ui-theme';

/**
 * Theme hook.
 *
 * The Campus Energy Optimizer ships a single bespoke "Campus after dark" theme
 * (see styles/campus-theme.css) — an immersive navy night scene is core to the
 * concept (a lit window = a building running), so the app is locked to dark
 * mode. The hook keeps its original signature for compatibility but always
 * reports `dark` and keeps the `.dark` class pinned on <html>.
 */
export const useTheme = (): { currentTheme: ThemeType; toggleTheme: () => void } => {
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('dark');
    localStorage.setItem(STORAGE_KEY, 'dark');
    localStorage.setItem('darkMode', 'true');
  }, []);

  // No-op toggle: the campus theme is intentionally dark-only.
  const toggleTheme = (): void => {
    document.documentElement.classList.add('dark');
  };

  return { currentTheme: 'dark', toggleTheme };
};
