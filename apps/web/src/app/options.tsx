import { TASK_PRIORITIES, type Department, type Member, type MemberRole, type TaskPriority } from '@delegate/shared';
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

export const roleOptions: Array<SelectOption<MemberRole>> = [
  { value: 'owner', label: 'Owner', description: 'Billing, roles, everything' },
  { value: 'manager', label: 'Manager', description: 'Assigns and audits work' },
  { value: 'member', label: 'Staff', description: 'Does the work, submits proof' },
];
