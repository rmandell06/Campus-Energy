import * as React from 'react';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

export interface PageLoaderProps {
  /** Short, page-specific status line, e.g. "Loading campus map…". */
  message?: string;
  /** Optional secondary line for extra context. */
  hint?: string;
  /**
   * Sizing / layout classes for the centering container. Pass the same height
   * the loaded content will occupy (e.g. "h-64", "h-[60vh]") so the page does
   * not jump when the data arrives.
   */
  className?: string;
}

/**
 * Shared, clearly-visible loading status used by every page while its data is
 * being fetched. A large spinner plus a page-specific message so an in-flight
 * load reads as "loading", not as an empty screen. Announces politely to screen
 * readers via `role="status"` + `aria-live`.
 */
export function PageLoader({ message = 'Loading…', hint, className }: PageLoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex min-h-[240px] w-full flex-col items-center justify-center gap-3 text-center',
        className,
      )}
    >
      <Spinner size="xl" tone="primary" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{message}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}

export default PageLoader;
