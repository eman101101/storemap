/**
 * Opening hours: stored on the store record as a `hours` string. New maps
 * write structured JSON ({ v: 1, days: { mon: { open, close, closed } … } })
 * so the editor can offer day-by-day inputs with a closed toggle; legacy
 * free-text hours still display untouched. formatStoreHours turns either
 * shape into a short human line for the viewer's store pill.
 */
export type WeekDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export interface DayHours {
  open: string;
  close: string;
  closed: boolean;
}
export type WeekHours = Record<WeekDay, DayHours>;

export const WEEK_DAYS: WeekDay[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABEL: Record<WeekDay, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

export function defaultWeek(): WeekHours {
  return {
    mon: { open: '08:00', close: '21:00', closed: false },
    tue: { open: '08:00', close: '21:00', closed: false },
    wed: { open: '08:00', close: '21:00', closed: false },
    thu: { open: '08:00', close: '21:00', closed: false },
    fri: { open: '08:00', close: '21:00', closed: false },
    sat: { open: '08:00', close: '20:00', closed: false },
    sun: { open: '09:00', close: '18:00', closed: false },
  };
}

/** Structured hours from the stored string, or null when it's legacy text. */
export function parseStoreHours(hours?: string): WeekHours | null {
  if (!hours || !hours.trim().startsWith('{')) return null;
  try {
    const raw = JSON.parse(hours) as { v?: number; days?: Partial<Record<WeekDay, DayHours>> };
    if (raw.v !== 1 || !raw.days) return null;
    const out = defaultWeek();
    for (const d of WEEK_DAYS) {
      const day = raw.days[d];
      if (day && typeof day === 'object') {
        out[d] = {
          open: String(day.open ?? out[d].open),
          close: String(day.close ?? out[d].close),
          closed: !!day.closed,
        };
      }
    }
    return out;
  } catch {
    return null;
  }
}

export function serializeWeek(week: WeekHours): string {
  return JSON.stringify({ v: 1, days: week });
}

/** Short human line ("Mon–Fri 8:00–21:00 · Sat 9:00–18:00 · Sun closed").
 *  Legacy free-text hours pass through unchanged; empty → null. */
export function formatStoreHours(hours?: string): string | null {
  if (!hours || !hours.trim()) return null;
  const week = parseStoreHours(hours);
  if (!week) return hours.trim();

  // group consecutive days with identical hours into ranges (Mon–Fri …)
  const groups: { days: WeekDay[]; text: string }[] = [];
  for (const d of WEEK_DAYS) {
    const day = week[d];
    const text = day.closed
      ? 'closed'
      : `${fmtTime(day.open)}–${fmtTime(day.close)}`;
    const last = groups[groups.length - 1];
    if (last && last.text === text) last.days.push(d);
    else groups.push({ days: [d], text });
  }
  const parts = groups.map((g) =>
    g.days.length === 1
      ? `${DAY_LABEL[g.days[0]]} ${g.text}`
      : `${DAY_LABEL[g.days[0]]}–${DAY_LABEL[g.days[g.days.length - 1]]} ${g.text}`
  );
  return parts.join(' · ') || null;
}

function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  if (Number.isNaN(h)) return hhmm;
  return m ? `${h}:${String(m).padStart(2, '0')}` : `${h}:00`;
}
