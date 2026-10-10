import { useEffect, useRef, useState } from 'react';

/**
 * Animate a number from 0 up to `target` once, on mount or whenever `target`
 * changes. Uses requestAnimationFrame with an expo-out ease so the headline
 * KPIs "count up" on load. Honors prefers-reduced-motion (snaps to the final
 * value) and always lands exactly on `target`.
 *
 * @param target     Final value to count up to.
 * @param duration   Animation length in ms (default 1200).
 * @param restartKey Change this to replay the count-up even if `target` is
 *                   unchanged (e.g. at the end of a "Play the day" sequence).
 * @returns The current animated value (re-rendered each frame).
 */
export function useCountUp(target: number, duration = 1200, restartKey?: unknown): number {
  const [value, setValue] = useState(0);
  const frameRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced || !Number.isFinite(target) || target === 0) {
      setValue(target || 0);
      return;
    }

    startRef.current = null;

    const tick = (now: number): void => {
      if (startRef.current == null) startRef.current = now;
      const elapsed = now - startRef.current;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3); // expo/cubic-out
      setValue(target * eased);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        setValue(target);
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, [target, duration, restartKey]);

  return value;
}
