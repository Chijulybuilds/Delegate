import { isManagerRole, type TaskPriority } from '@delegate/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useToast } from '../components/Toast';
import { Button, Field, Input, Modal, Select, Textarea } from '../components/ui';
import { toLocalInput } from '../lib/format';
import { useCreateTask, type WorkspaceData } from './data';
import { departmentOptions, memberOptions, priorityOptions } from './options';

function defaultDue(): string {
  const d = new Date();
  d.setHours(18, 0, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  return toLocalInput(d);
}

export function NewTaskModal({ open, onClose, ws }: { open: boolean; onClose: () => void; ws: WorkspaceData }) {
  const create = useCreateTask();
  const toast = useToast();
  const isManager = isManagerRole(ws.me.role);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState(ws.me.userId);
  const [departmentId, setDepartmentId] = useState<string>('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [due, setDue] = useState(defaultDue);

  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setAssigneeId(isManager ? (ws.members.find((m) => m.userId !== ws.me.userId)?.userId ?? ws.me.userId) : ws.me.userId);
      setDepartmentId('');
      setPriority('medium');
      setDue(defaultDue());
    }
  }, [open, isManager, ws.members, ws.me.userId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await create.mutateAsync({
        title,
        description,
        assigneeId,
        priority,
        dueAt: due ? new Date(due).toISOString() : null,
        ...(departmentId ? { departmentId } : {}),
      });
      const name = ws.members.find((m) => m.userId === assigneeId)?.fullName.split(' ')[0];
      toast.success(assigneeId === ws.me.userId ? 'Task added to your board' : `Assigned to ${name} — it’s on their board`);
      onClose();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={isManager ? 'Assign a task' : 'Add a task for yourself'} description="It lands red on the board and on everyone’s heartbeat.">
      <form onSubmit={submit} className="space-y-4" data-testid="new-task-form">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Finalize Q4 board deck" required minLength={3} maxLength={160} autoFocus data-testid="task-title" />
        </Field>
        <Field label="Brief" hint="What does done look like? AI uses this to check the proof.">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="12 slides, final numbers from finance, sent to the board by 5 PM." maxLength={4000} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Assignee">
            <Select value={assigneeId} onChange={setAssigneeId} disabled={!isManager} options={memberOptions(ws.members, { meId: ws.me.userId, departments: ws.departments })} aria-label="Assignee" data-testid="task-assignee" />
          </Field>
          <Field label="Department">
            <Select value={departmentId} onChange={setDepartmentId} options={departmentOptions(ws.departments, { value: '', label: 'Assignee’s department' })} aria-label="Department" />
          </Field>
          <Field label="Priority">
            <Select value={priority} onChange={setPriority} options={priorityOptions} aria-label="Priority" />
          </Field>
          <Field label="Due">
            <Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending} data-testid="task-submit">
            {isManager ? 'Assign task' : 'Add task'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
