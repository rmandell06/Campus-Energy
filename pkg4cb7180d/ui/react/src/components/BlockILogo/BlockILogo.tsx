import React from 'react';

/**
 * The Illinois "Block I" logomark — a slab-serif capital I rendered as a single
 * crisp inline SVG path. This is the ONE spot of orange (#FF5F05) in the whole
 * Block I/O UI; everything else is grayscale with amber/green reserved for data.
 *
 * Sized by the surrounding element's font-size via `1em` width/height, so it
 * lines up with the wordmark beside it. Decorative — the accessible name lives
 * on the wordmark text, so this is marked `aria-hidden`.
 */
export default function BlockILogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      width="1em"
      height="1em"
      className={className}
      aria-hidden="true"
      role="img"
      focusable="false"
    >
      <path
        fill="#FF5F05"
        d="M12 6 H88 V32 H64 V68 H88 V94 H12 V68 H36 V32 H12 Z"
      />
    </svg>
  );
}
