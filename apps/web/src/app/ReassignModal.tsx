import { taskRef, type Task } from '@delegate/shared';
import { ArrowRight, ArrowRightLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useToast } from '../components/Toast';
import { Avatar, Button, Field, Modal, Select, StatusBadge, Textarea } from '../components/ui';
import { memberName, useReassign, type WorkspaceData } from './data';
import { memberOptions } from './options';

/**
 * "Reassign": an unfinished task changes hands and stays on its day (Recall is the one that brings
 * a copy to today). Pick anyone on the team; an optional note becomes the first message they see.
 */
export function ReassignModal({ task, ws, onClose }: { task: Task | null; ws: WorkspaceData; onClose: () => void }) {
  const reassign = useReassign();
  const toast = useToast();
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    setTo('');
    setNote('');
  }, [task?.id]);

  if (!task) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;

  const from = memberName(ws.members, task.assigneeId);
  const toName = to ? memberName(ws.members, to).split(' ')[0] : '';
  // What changes besides the name (the API does the same).
  const effect =
    task.status === 'in_progress'
      ? `It goes back to Open, so ${toName || 'they'} can start it.`
      : task.status === 'blocked' && task.waitingOnId && task.waitingOnId === to
        ? `It was waiting on ${toName}, so the blocker is cleared and it goes back to Open.`
        : task.status === 'blocked'
          ? 'It stays blocked until the blocker is cleared.'
          : null;

  const submit = async () => {
    try {
      await reassign.mutateAsync({ id: task.id, assigneeId: to, ...(note.trim() ? { note: note.trim() } : {}) });
      toast.success(`Reassigned to ${memberName(ws.members, to)}`);
      onClose();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Modal open={!!task} onClose={onClose} title="Reassign task" description={`${from} is told it’s off their list; the new person gets it like a new assignment.`}>
      <div className="space-y-4" data-testid="reassign-modal">
        <div className="surface rounded-2xl p-4">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[0.6875rem] text-faint">{taskRef(task.seq)}</span>
            <StatusBadge status={task.status} />
          </div>
          <p className="mt-2 font-medium">{task.title}</p>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-2">
            <Avatar name={from} size={20} />
            <span>{from}</span>
            <ArrowRight className="size-4 text-faint" />
            {to ? (
              <>
                <Avatar name={memberName(ws.members, to)} size={20} />
                <span className="font-medium text-ink">{memberName(ws.members, to)}</span>
              </>
            ) : (
              <span className="text-faint">choose someone</span>
            )}
          </p>
        </div>

        <Field label="Give it to">
          <Select
            value={to}
            onChange={setTo}
            options={memberOptions(
              ws.members.filter((m) => m.userId !== task.assigneeId),
              { meId: ws.me.userId, departments: ws.departments },
            )}
            placeholder="Choose a team member"
            aria-label="Give it to"
            data-testid="reassign-to"
          />
        </Field>
        {effect && <p className="text-sm text-mute" data-testid="reassign-effect">{effect}</p>}
        <Field label="Note (optional)" hint="Becomes the first message they see on the task.">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} placeholder="Anything they should know?" data-testid="reassign-note" />
        </Field>

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={reassign.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!to} loading={reassign.isPending} data-testid="reassign-confirm">
            <ArrowRightLeft className="size-4" /> Reassign{toName ? ` to ${toName}` : ''}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
