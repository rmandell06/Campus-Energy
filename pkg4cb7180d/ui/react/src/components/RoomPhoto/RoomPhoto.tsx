/*
 * Copyright 2009-2026 C3 AI (www.c3.ai). All Rights Reserved.
 * Confidential and Proprietary C3 Materials.
 * This material, including without limitation any software, is the confidential trade secret and proprietary
 * information of C3 and its licensors. Reproduction, use and/or distribution of this material in any form is
 * strictly prohibited except as set forth in a written license agreement with C3 and/or its authorized distributors.
 * This material may be covered by one or more patents or pending patent applications.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ImageOff } from 'lucide-react';

import { fetchBuildingPhotos } from '@/shared/blockIoApi';
import type { BuildingPhotoRec } from '@/Interfaces';

/**
 * Shows the best available photo for a room, with a strict three-tier fallback so a demo never hits
 * a broken image:
 *
 *  1. an exact photo of the room, when one exists;
 *  2. otherwise the building exterior, clearly labelled "Building photo" so it is never mistaken for
 *     the room itself;
 *  3. otherwise an illustrated placeholder.
 *
 * Whenever a real photo is shown, its attribution (credit, licence, source) is rendered beneath it —
 * these are Wikimedia images and the licences require it.
 */

/** Module-level cache so every photo on a page shares a single backend fetch. */
let photoCache: Promise<BuildingPhotoRec[]> | null = null;

function loadPhotos(): Promise<BuildingPhotoRec[]> {
  if (!photoCache) {
    photoCache = fetchBuildingPhotos().catch(() => {
      // Allow a later retry rather than caching the failure forever.
      photoCache = null;
      return [];
    });
  }
  return photoCache;
}

interface RoomPhotoProps {
  /** The building id the room belongs to (join key for both room and exterior photos). */
  building: string;
  /** The specific room id, when the photo should prefer a room-level image. */
  roomId?: string | null;
  /** Tailwind height class for the image frame. Defaults to a compact banner. */
  heightClass?: string;
  className?: string;
}

type Resolved =
  | { tier: 'room' | 'building'; rec: BuildingPhotoRec }
  | { tier: 'placeholder' };

export default function RoomPhoto({
  building,
  roomId,
  heightClass = 'h-40',
  className = '',
}: RoomPhotoProps) {
  const [photos, setPhotos] = useState<BuildingPhotoRec[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadPhotos().then((p) => {
      if (alive) setPhotos(p);
    });
    return () => {
      alive = false;
    };
  }, []);

  const resolved = useMemo<Resolved>(() => {
    if (!photos) return { tier: 'placeholder' };
    if (roomId) {
      const room = photos.find((p) => p.kind === 'room' && p.roomId === roomId);
      if (room) return { tier: 'room', rec: room };
    }
    const exterior = photos.find((p) => p.kind === 'building' && p.building === building);
    if (exterior) return { tier: 'building', rec: exterior };
    return { tier: 'placeholder' };
  }, [photos, building, roomId]);

  if (resolved.tier === 'placeholder' || failed) {
    return (
      <div
        className={`flex ${heightClass} w-full flex-col items-center justify-center gap-1 rounded-lg bg-gradient-to-br from-[var(--c3-style-basic-bg-tertiary)] to-[var(--c3-style-basic-bg-secondary)] text-[var(--c3-style-basic-fg-neutral)] ${className}`}
      >
        <ImageOff className="size-6" aria-hidden />
        <span className="text-c3-regular-label-l3">No photo yet</span>
      </div>
    );
  }

  const { rec, tier } = resolved;
  const attribution = [rec.credit, rec.license].filter(Boolean).join(' · ');

  return (
    <figure className={`overflow-hidden rounded-lg ${className}`}>
      <div className={`relative ${heightClass} w-full bg-[var(--c3-style-basic-bg-tertiary)]`}>
        <img
          src={rec.imageUrl}
          alt={rec.title ?? (tier === 'building' ? `${building} exterior` : 'Room photo')}
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
        {tier === 'building' && (
          <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-c3-regular-label-l3 text-white">
            Building photo
          </span>
        )}
      </div>
      {(attribution || rec.sourceUrl) && (
        <figcaption className="px-1 pt-1 text-[11px] leading-tight text-[var(--c3-style-basic-fg-neutral)]">
          {attribution}
          {rec.sourceUrl && (
            <>
              {attribution ? ' · ' : ''}
              <a
                href={rec.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-[var(--c3-style-basic-fg-primary)]"
              >
                {rec.sourceName ?? 'source'}
              </a>
            </>
          )}
        </figcaption>
      )}
    </figure>
  );
}
