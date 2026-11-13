/** Tiny shared helpers (kept apart from ui.tsx so components can import them without cycles). */
export const EASE = [0.22, 1, 0.36, 1] as const;

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}
