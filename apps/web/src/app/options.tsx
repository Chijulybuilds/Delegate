import { SIZE_META, TASK_PRIORITIES, TASK_SIZES, type Department, type Member, type MemberRole, type TaskPriority, type TaskSize } from '@delegate/shared';
import { Avatar, type SelectOption } from '../components/ui';

/** Ready-made dropdown options, so every list of people, priorities or teams looks the same. */

const ROLE: Record<MemberRole, string> = { owner: 'Owner', manager: 'Manager', member: 'Staff' };

export function memberOptions(members: Member[], opts: { meId?: string; departments?: Department[] } = {}): SelectOption[] {
  return members.map((m) => ({
    value: m.userId,
    label: m.fullName + (m.userId === opts.meId ? ' (you)' : ''),
    description: [ROLE[m.role], opts.departments?.find((d) => d.id === m.departmentId)?.name].filter(Boolean).join(' · '),
    icon: <Avatar name={m.fullName} src={m.avatarUrl} size={22} />,
  }));
}

export function departmentOptions(departments: Department[], none?: { value: string; label: string }): SelectOption[] {
  return [...(none ? [{ ...none, dot: 'var(--color-line-2)' }] : []), ...departments.map((d) => ({ value: d.id, label: d.name, dot: d.color }))];
}

const PRIORITY_DOT: Record<TaskPriority, string> = {
  urgent: 'var(--color-s-open)',
  high: 'var(--color-s-active)',
  medium: 'var(--color-mute)',
  low: 'var(--color-line-2)',
};
const PRIORITY_HINT: Record<TaskPriority, string> = {
  urgent: 'Drop everything',
  high: 'Today, before other work',
  medium: 'The normal pace',
  low: 'When there’s time',
};

export const priorityOptions: Array<SelectOption<TaskPriority>> = TASK_PRIORITIES.map((p) => ({
  value: p,
  label: p[0]!.toUpperCase() + p.slice(1),
  description: PRIORITY_HINT[p],
  dot: PRIORITY_DOT[p],
}));

export const sizeOptions: Array<SelectOption<TaskSize>> = TASK_SIZES.map((z) => ({ value: z, label: SIZE_META[z].label, description: SIZE_META[z].hint }));

/**
 * A fair deadline for a task of this size, from now (local time): Quick in 2 hours, Small in 4,
 * Medium by the end of today, Large by tomorrow evening, Huge in three days. Nothing lands at night.
 */
export function suggestDue(size: TaskSize, now = new Date()): Date {
  const at = (days: number, h: number, m = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, h, m);
  if (size === 'xs' || size === 's') {
    const d = new Date(now.getTime() + SIZE_META[size].suggestHours * 3_600_000);
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    if (d.getHours() >= 20 || d.getDate() !== now.getDate()) return at(1, size === 'xs' ? 10 : 12);
    return d;
  }
  if (size === 'm') return at(0, 18).getTime() - now.getTime() >= 3 * 3_600_000 ? at(0, 18) : at(1, 12);
  if (size === 'l') return at(1, 18);
  return at(3, 18);
}

export const roleOptions: Array<SelectOption<MemberRole>> = [
  { value: 'owner', label: 'Owner', description: 'Billing, roles, everything' },
  { value: 'manager', label: 'Manager', description: 'Assigns and audits work' },
  { value: 'member', label: 'Staff', description: 'Does the work, submits proof' },
];
