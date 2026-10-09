/*
 * Copyright 2009-2026 C3 AI (www.c3.ai). All Rights Reserved.
 * Confidential and Proprietary C3 Materials.
 * This material, including without limitation any software, is the confidential trade secret and proprietary
 * information of C3 and its licensors. Reproduction, use and/or distribution of this material in any form is
 * strictly prohibited except as set forth in a written license agreement with C3 and/or its authorized distributors.
 * This material may be covered by one or more patents or pending patent applications.
 */

import { useEffect, useState } from 'react';

// Shell breakpoint — the left SideNav shell needs ~900px to sit beside the
// content without crowding it (and to let the campus map span the full content
// width), so anything narrower gets the touch-first shell. Kept in one place so
// the shell switch and any future responsive logic agree on the same threshold.
export const MOBILE_MAX_WIDTH = 899;

const QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`;

/**
 * Reactive viewport hook.
 *
 * Returns `true` while the viewport is narrower than the `md` breakpoint
 * (≤ {@link MOBILE_MAX_WIDTH}px). Backed by `matchMedia` and subscribed to its
 * change event, so it updates on resize / orientation change / responsive dev
 * tools — no manual `window.innerWidth` polling. SSR-safe: defaults to `false`
 * when `window` is unavailable.
 *
 * Used by {@link App} to pick the mobile shell without touching the desktop
 * chrome; prefer this over raw width checks everywhere else too.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(QUERY);
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    // Sync immediately in case the viewport changed before the listener attached.
    setIsMobile(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
