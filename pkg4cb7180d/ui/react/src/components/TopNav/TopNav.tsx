/*
 * Copyright 2009-2026 C3 AI (www.c3.ai). All Rights Reserved.
 * Confidential and Proprietary C3 Materials.
 * This material, including without limitation any software, is the confidential trade secret and proprietary
 * information of C3 and its licensors. Reproduction, use and/or distribution of this material in any form is
 * strictly prohibited except as set forth in a written license agreement with C3 and/or its authorized distributors.
 * This material may be covered by one or more patents or pending patent applications.
 */

import React from 'react';
import { Link, useLocation } from 'react-router-dom';

import { TopNavBar } from '@/components/ui/top-nav-bar';
import BlockILogo from '@/components/BlockILogo/BlockILogo';

/** A single tab in the {@link TopNav} section-navigation strip. */
export interface TopNavTab {
  title: string;
  path: string;
}

/**
 * The Illinois Block I logomark — the single spot of orange in the UI. Sized by
 * the {@link TopNavBar} brand slot (`size-5`).
 */
const DefaultLogo = <BlockILogo />;

interface TopNavProps {
  /** Application (or section) name shown at the far left of the bar. */
  title?: string;
  /** Small muted strapline shown beneath the title. */
  subtitle?: string;
  /**
   * Brand mark rendered in the bar's 20px logo slot. Defaults to the Block I
   * mark; pass `null` to hide it, or your own node to override.
   */
  logo?: React.ReactNode;
  /** Optional section-navigation tabs rendered in the bar's center slot. */
  tabs?: TopNavTab[];
  /** Optional right-aligned actions (icon buttons, avatar, …). */
  actions?: React.ReactNode;
}

/**
 * Application top bar, built on the C3 Design System {@link TopNavBar}.
 *
 * `logo` fills the 20px brand mark (defaults to the C3 logomark) and `title`
 * the app name beside it; when `tabs` are supplied they render as a router-aware
 * section-nav strip in the center slot (active tab derived from the current
 * path). `actions` flows into the right-aligned action group.
 */
export default function TopNav({ title, subtitle, logo = DefaultLogo, tabs, actions }: TopNavProps) {
  const location = useLocation();
  const hasTabs = Boolean(tabs && tabs.length > 0);

  // The logo + name are the app's "home" affordance: clicking either returns to the landing page
  // from anywhere in the app. Rendered as a single Link so the whole brand lockup is one target.
  const brand = (
    <Link
      to="/"
      aria-label="Go to the Illini I/O landing page"
      className="flex min-w-0 items-center gap-3 rounded-[var(--c3-style-border-radius-4)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--c3-style-basic-border-accent)]"
    >
      {logo ? (
        <span className="inline-flex shrink-0 items-center text-[var(--c3-style-basic-fg-primary)] [&_svg]:size-5">
          {logo}
        </span>
      ) : null}
      {title ? (
        <span className="flex min-w-0 flex-col justify-center leading-none">
          <span className="text-c3-bold-heading-h6 truncate text-[var(--c3-style-basic-fg-primary)]">
            {title}
          </span>
          {subtitle ? (
            <span className="mt-0.5 truncate text-[11px] font-normal tracking-tight text-[var(--c3-style-basic-fg-neutral)]">
              {subtitle}
            </span>
          ) : null}
        </span>
      ) : null}
    </Link>
  );

  return (
    <TopNavBar
      logo={null}
      appName={brand}
      actions={actions}
      center={
        hasTabs && tabs ? (
          <nav className="flex flex-wrap items-center gap-4" aria-label="Section navigation">
            {tabs.map((tab) => {
              const active = location.pathname === tab.path;
              return (
                <Link
                  key={tab.path}
                  to={tab.path}
                  aria-current={active ? 'page' : undefined}
                  className={
                    active
                      ? 'text-c3-bold-label-l2 border-b-2 border-[var(--c3-style-basic-border-accent)] pb-1 text-[var(--c3-style-basic-fg-primary)]'
                      : 'text-c3-regular-label-l2 border-b-2 border-transparent pb-1 text-[var(--c3-style-basic-fg-neutral)] hover:text-[var(--c3-style-basic-fg-primary)]'
                  }
                >
                  {tab.title}
                </Link>
              );
            })}
          </nav>
        ) : undefined
      }
    />
  );
}
