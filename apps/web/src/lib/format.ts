const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function clock(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function dueLabel(iso: string | null | undefined): { text: string; overdue: boolean } {
  if (!iso) return { text: 'No due date', overdue: false };
  const due = new Date(iso);
  const now = new Date();
  const overdue = due.getTime() < now.getTime();
  const sameDay = due.toDateString() === now.toDateString();
  const text = sameDay
    ? `Due ${clock(iso)}`
    : `Due ${due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  return { text: overdue ? `Overdue · ${text.replace('Due ', '')}` : text, overdue };
}

export function hours(h: number | null | undefined): string {
  if (h === null || h === undefined) return '—';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

export function pct(x: number | null | undefined): string {
  return x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

/** Local datetime-input value (yyyy-MM-ddTHH:mm) for a Date. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
