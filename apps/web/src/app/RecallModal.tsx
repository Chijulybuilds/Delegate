import { isManagerRole, STATUS_META, taskRef, type Task } from '@delegate/shared';
import { RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useToast } from '../components/Toast';
import { Avatar, Button, DateTimePicker, Field, Modal, Select, StatusBadge, Textarea } from '../components/ui';
import { toLocalInput } from '../lib/format';
import { memberName, useRecall, type WorkspaceData } from './data';
import { memberOptions } from './options';

/**
 * "Recall to today": an earlier task comes back onto today's board as a new task, linked to the
 * original (which stays as it was). Managers can hand it to someone else; everyone can set the due
 * time and leave a note that becomes the first message on it.
 */
export function RecallModal({ task, ws, onClose, onDone }: { task: Task | null; ws: WorkspaceData; onClose: () => void; onDone?: (newTask: Task) => void }) {
  const recall = useRecall();
  const toast = useToast();
  const manager = isManagerRole(ws.me.role);
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!task) return;
    setAssignee(manager ? task.assigneeId : ws.me.userId);
    setDue(toLocalInput(defaultDue(task)));
    setNote('');
  }, [task, manager, ws.me.userId]);

  if (!task) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;

  const submit = async () => {
    try {
      const r = await recall.mutateAsync({
        id: task.id,
        ...(manager ? { assigneeId: assignee } : {}),
        dueAt: due ? new Date(due).toISOString() : null,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast.success(`Recalled to today as ${taskRef(r.task.seq)}`);
      onDone?.(r.task);
      onClose();
    } catch (e) {
      toast.error(e);
    }
  };

  const day = new Date(task.createdAt).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <Modal open={!!task} onClose={onClose} title="Recall to today" description="It comes back onto today’s board as a new task. The original stays in History, linked to it.">
      <div className="space-y-4" data-testid="recall-modal">
        <div className="surface rounded-2xl p-4">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[0.6875rem] text-faint">{taskRef(task.seq)}</span>
            <StatusBadge status={task.status} />
            <span className="ml-auto text-xs text-mute">Given {day}</span>
          </div>
          <p className="mt-2 font-medium">{task.title}</p>
          <p className="mt-1 flex items-center gap-2 text-xs text-mute">
            <Avatar name={memberName(ws.members, task.assigneeId)} size={18} />
            {memberName(ws.members, task.assigneeId)}
            {task.status === 'approved' && ' · audited, the record stays as it is'}
          </p>
        </div>

        {manager ? (
          <Field label="Give it to">
            <Select value={assignee} onChange={setAssignee} options={memberOptions(ws.members, { meId: ws.me.userId, departments: ws.departments })} aria-label="Give it to" data-testid="recall-assignee" />
          </Field>
        ) : (
          <p className="text-sm text-mute">It comes back to you. {STATUS_META[task.status].label === 'Blocked' ? 'It starts fresh (not blocked).' : ''}</p>
        )}
        <Field label="Due">
          <DateTimePicker value={due} onChange={setDue} aria-label="Due" data-testid="recall-due" />
        </Field>
        <Field label="Note (optional)" hint="Becomes the first message on the recalled task.">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} placeholder="What still needs doing?" data-testid="recall-note" />
        </Field>

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={recall.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={recall.isPending} data-testid="recall-confirm">
            <RotateCcw className="size-4" /> Recall to today
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** The original's due time of day, today, if it's still ahead; otherwise 18:00 today (or in 2 hours if that's passed). */
function defaultDue(task: Task): Date {
  const now = new Date();
  const at = (h: number, m: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  if (task.dueAt) {
    const d = new Date(task.dueAt);
    const same = at(d.getHours(), d.getMinutes());
    if (same.getTime() > now.getTime() + 15 * 60_000) return same;
  }
  const six = at(18, 0);
  return six.getTime() > now.getTime() + 15 * 60_000 ? six : new Date(now.getTime() + 2 * 3_600_000);
}
