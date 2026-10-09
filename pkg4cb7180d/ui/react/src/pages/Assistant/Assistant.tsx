import React, { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, Bot, User, Sparkles, MapPin } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useCampusGeojson } from '@/hooks/useCampusGeojson';
import { askAssistant } from '@/shared/energyApi';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

interface MapLink {
  building: string;
  day: string | null;
  hour: number | null;
}

const DAY_PATTERNS: [RegExp, string][] = [
  [/\bmon(day)?\b/i, 'M'],
  [/\btues?(day)?\b/i, 'T'],
  [/\bwed(nesday)?\b/i, 'W'],
  [/\bthur?s?(day)?\b/i, 'R'],
  [/\bfri(day)?\b/i, 'F'],
];

function detectDay(text: string): string | null {
  for (const [re, d] of DAY_PATTERNS) if (re.test(text)) return d;
  return null;
}

function detectHour(text: string): number | null {
  const m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/i);
  if (m) {
    let h = Number(m[1]) % 12;
    if (/p/i.test(m[3])) h += 12;
    if (h >= 7 && h <= 22) return h;
  }
  const m24 = text.match(/\b(\d{1,2}):00\b/);
  if (m24) {
    const h = Number(m24[1]);
    if (h >= 7 && h <= 22) return h;
  }
  return null;
}

/** First building name (longest/most-specific) that appears in the answer. */
function detectBuilding(text: string, names: string[]): string | null {
  const lower = text.toLowerCase();
  for (const n of names) {
    if (n.length >= 4 && lower.includes(n.toLowerCase())) return n;
  }
  return null;
}

function buildMapLink(text: string, names: string[]): MapLink | null {
  const building = detectBuilding(text, names);
  if (!building) return null;
  return { building, day: detectDay(text), hour: detectHour(text) };
}

function mapHref({ building, day, hour }: MapLink): string {
  const params = new URLSearchParams({ building });
  if (day) params.set('day', day);
  if (hour != null) params.set('hour', String(hour));
  return `/campus-map?${params.toString()}`;
}

const SUGGESTED: string[] = [
  'How many building-hours does the optimizer free per week, and what does that save per year?',
  'Which weekday has the most empty building-hours after optimization?',
  'What assumptions drive the cost and CO₂ savings estimates?',
  'Which buildings give up the most sections in the optimized plan?',
];

export default function Assistant() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const geo = useCampusGeojson();

  // Building names, longest first so the most specific name wins when scanning
  // an answer (e.g. "Materials Science & Eng Bld" before "Eng").
  const names = useMemo(
    () => Object.keys(geo.centroids).sort((a, b) => b.length - a.length),
    [geo.centroids],
  );

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || loading) return;
    setInput('');
    setError(null);
    setTurns((t) => [...t, { role: 'user', text: q }]);
    setLoading(true);
    try {
      const answer = await askAssistant(q);
      setTurns((t) => [...t, { role: 'assistant', text: answer }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The assistant could not answer.');
    } finally {
      setLoading(false);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Energy assistant"
        description="Ask grounded questions about the UIUC Fall 2026 schedule and the latest optimization. Answers are computed from the loaded data and savings assumptions."
      />

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6">
        <Card variant="elevated" className="flex min-h-0 flex-1 flex-col">
          <CardContent className="flex min-h-0 flex-1 flex-col gap-4 pt-5">
            <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-auto pr-1">
              {turns.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                  <div className="flex size-12 items-center justify-center rounded-full bg-[var(--c3-style-basic-bg-accent)] text-[var(--c3-style-basic-fg-accent)]">
                    <Sparkles className="size-6" />
                  </div>
                  <p className="max-w-md text-sm text-muted-foreground">
                    Ask about freed building-hours, savings, the busiest or emptiest
                    buildings, or how a parameter changes the result. Try one of these:
                  </p>
                  <div className="grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
                    {SUGGESTED.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => send(s)}
                        className="rounded-md border border-[var(--c3-style-basic-border-border)] bg-[var(--c3-style-basic-bg-page)] px-3 py-2 text-left text-sm text-foreground transition-colors hover:border-[var(--c3-style-basic-border-accent)] hover:bg-[var(--c3-style-basic-bg-secondary)]"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                turns.map((t, i) => {
                  const link =
                    t.role === 'assistant' ? buildMapLink(t.text, names) : null;
                  return (
                    <div
                      key={i}
                      className={
                        'flex gap-3 ' + (t.role === 'user' ? 'justify-end' : 'justify-start')
                      }
                    >
                      {t.role === 'assistant' ? (
                        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--c3-style-basic-bg-accent)] text-[var(--c3-style-basic-fg-accent)]">
                          <Bot className="size-4" />
                        </div>
                      ) : null}
                      <div className="flex max-w-[75%] flex-col items-start gap-2">
                        <div
                          className={
                            'whitespace-pre-wrap rounded-lg px-4 py-2.5 text-sm leading-relaxed ' +
                            (t.role === 'user'
                              ? 'bg-[var(--c3-style-basic-bg-accent-inverse)] text-[var(--c3-style-basic-fg-inverse)]'
                              : 'bg-[var(--c3-style-basic-bg-secondary)] text-foreground')
                          }
                        >
                          {t.text}
                        </div>
                        {link ? (
                          <Link
                            to={mapHref(link)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--c3-style-basic-border-border)] bg-[var(--c3-style-basic-bg-page)] px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-[var(--c3-style-basic-border-accent)] hover:bg-[var(--c3-style-basic-bg-secondary)]"
                          >
                            <MapPin className="size-3.5" />
                            Show {link.building} on map
                          </Link>
                        ) : null}
                      </div>
                      {t.role === 'user' ? (
                        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--c3-style-basic-bg-neutral-inverse)] text-[var(--c3-style-basic-fg-inverse)]">
                          <User className="size-4" />
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
              {loading ? (
                <div className="flex justify-start gap-3">
                  <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--c3-style-basic-bg-accent)] text-[var(--c3-style-basic-fg-accent)]">
                    <Bot className="size-4" />
                  </div>
                  <div className="flex items-center gap-1 rounded-lg bg-[var(--c3-style-basic-bg-secondary)] px-4 py-3">
                    <span className="io-typing-dot size-1.5 rounded-full bg-[var(--mono-ink-2)]" />
                    <span
                      className="io-typing-dot size-1.5 rounded-full bg-[var(--mono-ink-2)]"
                      style={{ animationDelay: '0.2s' }}
                    />
                    <span
                      className="io-typing-dot size-1.5 rounded-full bg-[var(--mono-ink-2)]"
                      style={{ animationDelay: '0.4s' }}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            {error ? (
              <div className="rounded-md bg-[var(--c3-style-basic-bg-danger)] px-3 py-2 text-sm text-[var(--c3-style-basic-fg-danger)]">
                {error}
              </div>
            ) : null}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="flex items-center gap-2 border-t border-[var(--c3-style-basic-border-border)] pt-3"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about the schedule or optimization…"
                className="h-10 flex-1 rounded-md border border-[var(--c3-style-basic-border-border)] bg-[var(--c3-style-basic-bg-page)] px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--c3-style-basic-border-accent)]"
              />
              <Button type="submit" variant="solid" appearance="accent" disabled={loading || !input.trim()}>
                <Send className="size-4" />
                Ask
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
