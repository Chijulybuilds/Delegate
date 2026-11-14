import { useQueryClient } from '@tanstack/react-query';
import { describeCadence, isManagerRole, type Playbook, type PlaybookCadence, type TaskPriority } from '@delegate/shared';
import { Briefcase, CalendarDays, CalendarRange, Pencil, Play, Plus, Repeat, Repeat2, Trash2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useToast } from '../components/Toast';
import { Avatar, Button, Card, cx, EmptyState, Field, Input, Modal, Select, Spinner, TimePicker, type SelectOption } from '../components/ui';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { PageHeader } from './AppShell';
import { memberName, usePlaybooks, useWorkspace, type WorkspaceData } from './data';
import { memberOptions, priorityOptions } from './options';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const CADENCE_OPTIONS: Array<SelectOption<PlaybookCadence>> = [
  { value: 'daily', label: 'Every day', description: 'Including weekends', icon: <Repeat className="size-4 text-mute" /> },
  { value: 'weekdays', label: 'Weekdays', description: 'Monday to Friday', icon: <Briefcase className="size-4 text-mute" /> },
  { value: 'weekly', label: 'Weekly', description: 'Once a week, on a day you pick', icon: <CalendarDays className="size-4 text-mute" /> },
  { value: 'monthly', label: 'Monthly', description: 'Once a month, on a date you pick', icon: <CalendarRange className="size-4 text-mute" /> },
];

/** Recurring checklists: "every weekday at 08:00, these 3 tasks land on these people". */
export default function PlaybooksPage() {
  const ws = useWorkspace();
  const { data, isLoading } = usePlaybooks();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Playbook | 'new' | null>(null);

  if (!ws.data || isLoading) return <Spinner className="m-8" />;
  const canEdit = isManagerRole(ws.data.me.role);
  const playbooks = data?.playbooks ?? [];
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['playbooks'] }), qc.invalidateQueries({ queryKey: ['tasks'] })]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      await refresh();
      toast.success(ok);
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div>
      <PageHeader
        title="Playbooks"
        subtitle="Routines that assign themselves: daily checklists, weekly reports, month-end close."
        actions={
          canEdit && (
            <Button onClick={() => setEditing('new')} data-testid="new-playbook">
              <Plus className="size-4" /> New playbook
            </Button>
          )
        }
      />
      <div className="grid gap-3 px-4 pb-12 sm:px-8 lg:grid-cols-2">
        {playbooks.length === 0 && (
          <div className="lg:col-span-2">
            <EmptyState
              title="No playbooks yet"
              body="Create one for the work that repeats — it lands on the right people's boards on schedule, with proof required like any task."
              action={canEdit ? <Button onClick={() => setEditing('new')}>Create a playbook</Button> : undefined}
            />
          </div>
        )}
        {playbooks.map((pb) => (
          <Card key={pb.id} className="p-5" data-testid="playbook-card">
            <div className="flex items-start gap-3">
              <span className={cx('grid size-10 shrink-0 place-items-center rounded-full', pb.active ? 'bg-ink text-milk' : 'bg-milk-2 text-faint')}>
                <Repeat2 className="size-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[16px] font-medium tracking-[-0.02em]">{pb.name}</h2>
                <p className="text-sm text-mute">
                  {describeCadence(pb)} · {pb.items.length} task{pb.items.length === 1 ? '' : 's'}
                  {!pb.active && ' · paused'}
                </p>
              </div>
              {canEdit && (
                <div className="flex gap-1">
                  <button onClick={() => setEditing(pb)} className="grid size-8 place-items-center rounded-full text-mute hover:bg-ink/5 hover:text-ink" aria-label={`Edit ${pb.name}`}>
                    <Pencil className="size-4" />
                  </button>
                  <button
                    onClick={() => confirm(`Delete “${pb.name}”? Tasks it already created stay.`) && act(() => api.del(`/playbooks/${pb.id}`), 'Playbook deleted')}
                    className="grid size-8 place-items-center rounded-full text-mute hover:bg-ink/5 hover:text-ink"
                    aria-label={`Delete ${pb.name}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              )}
            </div>
            <ul className="mt-4 space-y-2">
              {pb.items.map((item) => (
                <li key={item.id} className="flex items-center gap-2.5 text-sm">
                  <Avatar name={memberName(ws.data!.members, item.assigneeId)} size={22} />
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  <span className="shrink-0 text-xs text-faint">due +{item.dueInHours}h</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
              <span className="text-xs text-faint">{pb.lastRunOn ? `Last ran ${pb.lastRunOn}` : 'Not run yet'} · updated {timeAgo(pb.updatedAt)}</span>
              {canEdit && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => act(() => api.put(`/playbooks/${pb.id}`, { ...toInput(pb), active: !pb.active }), pb.active ? 'Playbook paused' : 'Playbook resumed')}
                  >
                    {pb.active ? 'Pause' : 'Resume'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => act(() => api.post(`/playbooks/${pb.id}/run`), `“${pb.name}” ran — tasks are on the board`)} data-testid="playbook-run">
                    <Play className="size-3.5" /> Run now
                  </Button>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
      {editing && <PlaybookEditor ws={ws.data} playbook={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  );
}

type Draft = {
  name: string;
  active: boolean;
  cadence: PlaybookCadence;
  weekday: number | null;
  monthDay: number | null;
  timeOfDay: string;
  items: Array<{ id?: string; title: string; description: string; assigneeId: string; priority: TaskPriority; dueInHours: number }>;
};

function toInput(pb: Playbook): Draft {
  return { name: pb.name, active: pb.active, cadence: pb.cadence, weekday: pb.weekday, monthDay: pb.monthDay, timeOfDay: pb.timeOfDay, items: pb.items.map((i) => ({ ...i })) };
}

function PlaybookEditor({ ws, playbook, onClose, onSaved }: { ws: WorkspaceData; playbook: Playbook | null; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const toast = useToast();
  const blank = (): Draft['items'][number] => ({ title: '', description: '', assigneeId: ws.members[0]?.userId ?? '', priority: 'medium', dueInHours: 8 });
  const [draft, setDraft] = useState<Draft>(() =>
    playbook ? toInput(playbook) : { name: '', active: true, cadence: 'weekdays', weekday: 1, monthDay: 1, timeOfDay: '08:00', items: [blank()] },
  );
  const [busy, setBusy] = useState(false);

  const setItem = (i: number, patch: Partial<Draft['items'][number]>) => setDraft((d) => ({ ...d, items: d.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...draft, weekday: draft.cadence === 'weekly' ? draft.weekday : null, monthDay: draft.cadence === 'monthly' ? draft.monthDay : null };
      if (playbook) await api.put(`/playbooks/${playbook.id}`, body);
      else await api.post('/playbooks', body);
      await onSaved();
      toast.success(playbook ? 'Playbook saved' : 'Playbook created — it runs on schedule');
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={playbook ? 'Edit playbook' : 'New playbook'} description="Times use your workspace time zone." width="max-w-2xl">
      <form onSubmit={save} className="space-y-4" data-testid="playbook-form">
        <Field label="Name">
          <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Daily ops checklist" required minLength={2} maxLength={80} autoFocus data-testid="playbook-name" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Repeats">
            <Select value={draft.cadence} onChange={(v) => setDraft({ ...draft, cadence: v })} options={CADENCE_OPTIONS} aria-label="Repeats" data-testid="playbook-cadence" />
          </Field>
          {draft.cadence === 'weekly' && (
            <Field label="On">
              <Select value={String(draft.weekday ?? 1)} onChange={(v) => setDraft({ ...draft, weekday: Number(v) })} options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))} aria-label="On" />
            </Field>
          )}
          {draft.cadence === 'monthly' && (
            <Field label="Day of month">
              <Input type="number" min={1} max={28} value={draft.monthDay ?? 1} onChange={(e) => setDraft({ ...draft, monthDay: Number(e.target.value) })} />
            </Field>
          )}
          <Field label="At">
            <TimePicker value={draft.timeOfDay} onChange={(v) => setDraft({ ...draft, timeOfDay: v })} aria-label="At" data-testid="playbook-time" />
          </Field>
        </div>

        <div>
          <p className="mb-2 text-[13px] font-medium text-ink-2">Tasks it creates</p>
          <div className="space-y-2">
            {draft.items.map((item, i) => (
              <div key={i} className="grid gap-2 rounded-2xl border border-line bg-milk p-3 sm:grid-cols-[1fr_170px_110px_92px_32px]">
                <Input value={item.title} onChange={(e) => setItem(i, { title: e.target.value })} placeholder="Reconcile yesterday's payments" required minLength={3} className="h-10" aria-label="Task title" data-testid="playbook-item-title" />
                <Select value={item.assigneeId} onChange={(v) => setItem(i, { assigneeId: v })} options={memberOptions(ws.members, { departments: ws.departments })} className="h-10!" aria-label="Assignee" />
                <Select value={item.priority} onChange={(v) => setItem(i, { priority: v })} options={priorityOptions} className="h-10!" aria-label="Priority" />
                <Input type="number" min={0.5} max={744} step={0.5} value={item.dueInHours} onChange={(e) => setItem(i, { dueInHours: Number(e.target.value) })} className="h-10" aria-label="Due in hours" title="Due this many hours after it runs" />
                <button type="button" onClick={() => setDraft({ ...draft, items: draft.items.filter((_, j) => j !== i) })} disabled={draft.items.length === 1} className="grid size-10 place-items-center rounded-full text-mute hover:bg-ink/5 disabled:opacity-30" aria-label="Remove task">
                  <X className="size-4" />
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setDraft({ ...draft, items: [...draft.items, blank()] })} className="mt-2 inline-flex items-center gap-1.5 text-sm text-mute hover:text-ink">
            <Plus className="size-4" /> Add a task
          </button>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} data-testid="playbook-save">
            {playbook ? 'Save playbook' : 'Create playbook'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
