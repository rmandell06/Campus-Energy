/*
 * Copyright 2009-2026 C3 AI (www.c3.ai). All Rights Reserved.
 * Confidential and Proprietary C3 Materials.
 * This material, including without limitation any software, is the confidential trade secret and proprietary
 * information of C3 and its licensors. Reproduction, use and/or distribution of this material in any form is
 * strictly prohibited except as set forth in a written license agreement with C3 and/or its authorized distributors.
 * This material may be covered by one or more patents or pending patent applications.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X, MoreHorizontal } from 'lucide-react';

import { navForRole } from '@/config/navigation';
import { useRole, roleForPath } from '@/contexts/RoleProvider';
import { NavigationItem } from '@/types/navigation';
import { cn } from '@/lib/utils';

// How many primary destinations get a dedicated slot in the bottom bar before
// the rest are folded behind the "More" button. Keeps the bar from crowding on
// narrow phones (max 5 slots total, including More).
const MAX_BOTTOM_SLOTS = 5;

/** True when `item` corresponds to the current route (mirrors SideNav logic). */
const isActiveRoute = (item: NavigationItem, pathname: string): boolean => {
  if (item.path === '/') return pathname === '/';
  return pathname === item.path || pathname.startsWith(`${item.path}/`);
};

/**
 * Mobile application shell — a touch-first alternative to the desktop
 * SideNav + TopNav chrome, used only when the viewport is below the `md`
 * breakpoint (see {@link useIsMobile}). The desktop shell is untouched.
 *
 * Navigation is offered two ways for maximum reachability:
 *   - a **bottom tab bar** with the primary destinations (thumb-friendly), and
 *   - a **slide-in drawer** (hamburger, top-left) listing every destination.
 *
 * The route table ({@link AppRoutes}) is shared with the desktop shell, so both
 * render exactly the same pages.
 */
export default function MobileShell({ title, routes }: { title: string; routes: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeRole } = useRole();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // The route wins over the remembered role (see SideNav for the rationale).
  const navItems = navForRole(roleForPath(location.pathname) ?? activeRole);

  // Split the nav into bottom-bar primaries + the overflow shown in the drawer.
  const { primaryItems, hasOverflow } = useMemo(() => {
    const fitsInBar = navItems.length <= MAX_BOTTOM_SLOTS;
    const primaryCount = fitsInBar ? navItems.length : MAX_BOTTOM_SLOTS - 1;
    return {
      primaryItems: navItems.slice(0, primaryCount),
      hasOverflow: !fitsInBar,
    };
  }, [navItems]);

  // Close the drawer whenever the route changes (e.g. after a drawer tap).
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // Prevent the page behind the drawer from scrolling while it is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  const go = useCallback(
    (path: string) => {
      navigate(path);
      setDrawerOpen(false);
    },
    [navigate],
  );

  const activeInDrawer = navItems.some(
    (item) => !primaryItems.includes(item) && isActiveRoute(item, location.pathname),
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--c3-style-basic-bg-page)]">
      {/* Top app bar */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--c3-style-basic-border-border)] bg-[var(--c3-style-basic-bg-primary)] px-3">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation menu"
          className="inline-flex size-10 items-center justify-center rounded-md text-[var(--c3-style-basic-fg-primary)] hover:bg-[var(--c3-style-basic-bg-secondary)]"
        >
          <Menu className="size-5" />
        </button>
        <Link
          to="/"
          aria-label="Go to the Illini I/O landing page"
          className="truncate text-c3-bold-label-l1 text-[var(--c3-style-basic-fg-primary)]"
        >
          {title}
        </Link>
      </header>

      {/* Routed page content */}
      <main className="flex-1 overflow-auto">{routes}</main>

      {/* Bottom tab bar */}
      <nav
        aria-label="Primary"
        className="flex shrink-0 items-stretch border-t border-[var(--c3-style-basic-border-border)] bg-[var(--c3-style-basic-bg-primary)]"
      >
        {primaryItems.map((item) => {
          const active = isActiveRoute(item, location.pathname);
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => go(item.path)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px]',
                active
                  ? 'text-[var(--c3-style-basic-fg-accent)]'
                  : 'text-[var(--c3-style-basic-fg-neutral)]',
              )}
            >
              <Icon className="size-5" />
              <span className="max-w-full truncate px-0.5">{item.label}</span>
              {active && (
                <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-[var(--c3-style-basic-bg-accent-inverse)]" />
              )}
            </button>
          );
        })}
        {hasOverflow && (
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="More destinations"
            aria-current={activeInDrawer ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px]',
              activeInDrawer
                ? 'text-[var(--c3-style-basic-fg-accent)]'
                : 'text-[var(--c3-style-basic-fg-neutral)]',
            )}
          >
            <MoreHorizontal className="size-5" />
            <span>More</span>
          </button>
        )}
      </nav>

      {/* Slide-in navigation drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          {/* Panel */}
          <div className="relative z-10 flex h-full w-[82%] max-w-[320px] flex-col border-r border-[var(--c3-style-basic-border-border)] bg-[var(--c3-style-basic-bg-primary)] shadow-[0_20px_25px_-5px_rgb(10_10_10/40%)]">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--c3-style-basic-border-border)] px-4">
              <span className="truncate text-c3-bold-label-l1 text-[var(--c3-style-basic-fg-primary)]">{title}</span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation menu"
                className="inline-flex size-9 items-center justify-center rounded-md text-[var(--c3-style-basic-fg-primary)] hover:bg-[var(--c3-style-basic-bg-secondary)]"
              >
                <X className="size-5" />
              </button>
            </div>
            <ul className="flex-1 overflow-y-auto p-2">
              {navItems.map((item) => {
                const active = isActiveRoute(item, location.pathname);
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={item.disabled}
                      onClick={() => go(item.path)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-md px-3 py-3 text-left text-c3-regular-label-l1 disabled:opacity-50',
                        active
                          ? 'bg-[var(--c3-style-basic-bg-accent)] text-[var(--c3-style-basic-fg-accent)]'
                          : 'text-[var(--c3-style-basic-fg-primary)] hover:bg-[var(--c3-style-basic-bg-secondary)]',
                      )}
                    >
                      <Icon className="size-5 shrink-0" />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge ? (
                        <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-[var(--c3-style-basic-bg-danger-inverse)] px-1 text-[11px] font-medium text-[var(--c3-style-basic-fg-inverse)]">
                          {item.badge}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
