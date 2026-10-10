/*
 * Copyright 2009-2026 C3 AI (www.c3.ai). All Rights Reserved.
 * Confidential and Proprietary C3 Materials.
 * This material, including without limitation any software, is the confidential trade secret and proprietary
 * information of C3 and its licensors. Reproduction, use and/or distribution of this material in any form is
 * strictly prohibited except as set forth in a written license agreement with C3 and/or its authorized distributors.
 * This material may be covered by one or more patents or pending patent applications.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Sparkles,
  Send,
  X,
  MapPin,
  Clock,
  Footprints,
  TriangleAlert,
  Loader2,
} from 'lucide-react';

import { useRole, roleForPath, type Role } from '@/contexts/RoleProvider';
import { askAgent, fetchAgentSuggestions, currentDayHour } from '@/shared/blockIoApi';
import type { AgentCard, AgentReply } from '@/Interfaces';

/**
 * The Block I/O agent, docked into every role page.
 *
 * It is the one place a visitor talks to the app in plain language. On desktop it is a panel pinned
 * to the bottom-right; on a phone it is a full-width sheet that slides up. Either way it is opened
 * from a single floating "Ask Block I/O" button so it never competes with the map for space until
 * the visitor wants it.
 *
 * Everything it shows comes straight from {@code BlockIoAgent.ask} — the prose answer, the tool
 * steps it ran, the result cards, and the follow-up chips. There is no client-side guessing: if the
 * backend says it found nothing, we render that honestly rather than inventing a reply.
 */

/** One turn in the thread: what the visitor asked and what the agent replied (null while pending). */
interface Turn {
  question: string;
  reply: AgentReply | null;
  error?: string;
}

function roleLabel(role: Role): string {
  return role === 'student' ? 'find a place to study' : 'find buildings to switch off';
}

/** The role the agent is answering as, from the active route — shown in the header. */
function roleName(role: Role): string {
  return role === 'student' ? 'Student' : 'Facilities';
}

/** A single agent result card. */
function ResultCard({ card }: { card: AgentCard }) {
  return (
    <div className="rounded-lg border border-[var(--c3-style-basic-border-border)] bg-[var(--c3-style-basic-bg-primary)] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-c3-medium-label-l2 text-[var(--c3-style-basic-fg-primary)]">
            {card.isAssumption && (
              <TriangleAlert className="size-3.5 shrink-0 text-amber-500" aria-hidden />
            )}
            <span className="truncate">{card.title}</span>
          </div>
          {card.subtitle && (
            <div className="mt-0.5 text-c3-regular-label-l3 text-[var(--c3-style-basic-fg-neutral)]">
              {card.subtitle}
            </div>
          )}
        </div>
        {card.metricValue && (
          <div className="shrink-0 text-right">
            <div className="text-c3-medium-label-l1 text-[var(--c3-style-basic-fg-primary)]">
              {card.metricValue}
            </div>
            {card.metricLabel && (
              <div className="text-c3-regular-label-l3 text-[var(--c3-style-basic-fg-neutral)]">
                {card.metricLabel}
              </div>
            )}
          </div>
        )}
      </div>

      {card.lines && card.lines.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {card.lines.map((line, i) => (
            <li
              key={i}
              className="text-c3-regular-label-l3 text-[var(--c3-style-basic-fg-neutral)]"
            >
              {line}
            </li>
          ))}
        </ul>
      )}

      {(card.freeUntilLabel || typeof card.walkMinutes === 'number') && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-c3-regular-label-l3 text-[var(--c3-style-basic-fg-neutral)]">
          {card.freeUntilLabel && (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" aria-hidden />
              {card.freeUntilLabel}
            </span>
          )}
          {typeof card.walkMinutes === 'number' && (
            <span className="inline-flex items-center gap-1">
              <Footprints className="size-3.5" aria-hidden />
              {card.walkMinutes} min walk
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** The rendered reply beneath a question: steps (if any), prose, cards. */
function ReplyBlock({ reply }: { reply: AgentReply }) {
  return (
    <div className="space-y-2">
      {reply.steps && reply.steps.length > 0 && (
        <ul className="space-y-0.5">
          {reply.steps.map((step, i) => (
            <li
              key={i}
              className="flex items-center gap-1.5 text-c3-regular-label-l3 text-[var(--c3-style-basic-fg-neutral)]"
            >
              <span className="inline-block size-1.5 rounded-full bg-[var(--c3-style-chart-sequence-1,#6366f1)]" />
              {step}
            </li>
          ))}
        </ul>
      )}

      <p className="whitespace-pre-wrap text-c3-regular-label-l2 text-[var(--c3-style-basic-fg-primary)]">
        {reply.notFound && (
          <TriangleAlert className="mr-1 inline size-4 text-amber-500" aria-hidden />
        )}
        {reply.answer}
      </p>

      {reply.cards && reply.cards.length > 0 && (
        <div className="space-y-2">
          {reply.cards.map((card, i) => (
            <ResultCard key={i} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function AgentPanel() {
  const location = useLocation();
  const { activeRole } = useRole();
  const role: Role = roleForPath(location.pathname) ?? activeRole;

  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  // Role-specific suggested questions. Reloaded whenever the active role changes.
  useEffect(() => {
    let alive = true;
    fetchAgentSuggestions(role)
      .then((s) => {
        if (alive) setSuggestions(s);
      })
      .catch(() => {
        if (alive) setSuggestions([]);
      });
    return () => {
      alive = false;
    };
  }, [role]);

  // Keep the newest turn in view.
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [turns, busy]);

  const send = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || busy) return;
      setDraft('');
      setBusy(true);
      setTurns((prev) => [...prev, { question: q, reply: null }]);
      const { day, hour } = currentDayHour();
      try {
        const reply = await askAgent(q, role, day, hour, null);
        setTurns((prev) =>
          prev.map((t, i) => (i === prev.length - 1 ? { ...t, reply } : t)),
        );
      } catch {
        setTurns((prev) =>
          prev.map((t, i) =>
            i === prev.length - 1
              ? { ...t, error: 'The agent could not be reached. Try again.' }
              : t,
          ),
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, role],
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-[var(--c3-style-accent-1-bg,#4f46e5)] px-4 py-3 text-c3-medium-label-l2 text-white shadow-lg hover:brightness-110"
      >
        <Sparkles className="size-5" aria-hidden />
        Ask Illini I/O
      </button>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex max-h-[85vh] flex-col rounded-t-2xl border border-[var(--c3-style-basic-border-border)] bg-[var(--c3-style-basic-bg-secondary)] shadow-2xl md:inset-x-auto md:bottom-5 md:right-5 md:max-h-[80vh] md:w-[400px] md:rounded-2xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--c3-style-basic-border-border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-full bg-[var(--c3-style-accent-1-bg,#4f46e5)]">
            <Sparkles className="size-4 text-white" aria-hidden />
          </div>
          <div>
            <div className="text-c3-medium-label-l2 text-[var(--c3-style-basic-fg-primary)]">
              Ask Illini I/O · {roleName(role)}
            </div>
            <div className="text-c3-regular-label-l3 text-[var(--c3-style-basic-fg-neutral)]">
              Ask me to {roleLabel(role)}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close assistant"
          className="rounded-md p-1.5 text-[var(--c3-style-basic-fg-neutral)] hover:bg-[var(--c3-style-basic-bg-primary)]"
        >
          <X className="size-5" />
        </button>
      </div>

      {/* Thread */}
      <div ref={threadRef} className="flex-1 space-y-4 overflow-auto px-4 py-4">
        {turns.length === 0 && (
          <div className="rounded-lg border border-dashed border-[var(--c3-style-basic-border-border)] p-4 text-center">
            <MapPin className="mx-auto mb-2 size-6 text-[var(--c3-style-basic-fg-neutral)]" aria-hidden />
            <p className="text-c3-regular-label-l2 text-[var(--c3-style-basic-fg-neutral)]">
              Ask a question below, or tap a suggestion to get started. Every answer is pulled live
              from the campus plan.
            </p>
          </div>
        )}

        {turns.map((turn, i) => (
          <div key={i} className="space-y-2">
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--c3-style-accent-1-bg,#4f46e5)] px-3 py-2 text-c3-regular-label-l2 text-white">
                {turn.question}
              </div>
            </div>

            {turn.reply === null && !turn.error && (
              <div className="flex items-center gap-2 text-c3-regular-label-l2 text-[var(--c3-style-basic-fg-neutral)]">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Working on it…
              </div>
            )}
            {turn.error && (
              <div className="flex items-center gap-1.5 text-c3-regular-label-l2 text-red-500">
                <TriangleAlert className="size-4" aria-hidden />
                {turn.error}
              </div>
            )}
            {turn.reply && <ReplyBlock reply={turn.reply} />}

            {turn.reply?.followUps && turn.reply.followUps.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {turn.reply.followUps.map((f, j) => (
                  <button
                    key={j}
                    type="button"
                    onClick={() => send(f)}
                    className="rounded-full border border-[var(--c3-style-basic-border-border)] bg-[var(--c3-style-basic-bg-primary)] px-3 py-1 text-c3-regular-label-l3 text-[var(--c3-style-basic-fg-primary)] hover:bg-[var(--c3-style-basic-bg-tertiary)]"
                  >
                    {f}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Suggestions (only before the first question) */}
      {turns.length === 0 && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-2">
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => send(s)}
              className="rounded-full border border-[var(--c3-style-basic-border-border)] bg-[var(--c3-style-basic-bg-primary)] px-3 py-1.5 text-c3-regular-label-l3 text-[var(--c3-style-basic-fg-primary)] hover:bg-[var(--c3-style-basic-bg-tertiary)]"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
        className="flex items-center gap-2 border-t border-[var(--c3-style-basic-border-border)] px-3 py-3"
      >
        <label htmlFor="agent-input" className="sr-only">
          Ask Illini I/O
        </label>
        <input
          id="agent-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about the map…"
          autoComplete="off"
          className="min-h-[44px] flex-1 rounded-lg border border-[var(--c3-style-basic-border-border)] bg-[var(--c3-style-basic-bg-primary)] px-3 text-c3-regular-label-l2 text-[var(--c3-style-basic-fg-primary)] outline-none focus:border-[var(--c3-style-accent-1-bg,#4f46e5)]"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          aria-label="Send"
          className="inline-flex size-11 items-center justify-center rounded-lg bg-[var(--c3-style-accent-1-bg,#4f46e5)] text-white disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />}
        </button>
      </form>
    </div>
  );
}
