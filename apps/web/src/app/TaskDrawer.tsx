import { availableActions, isManagerRole, taskRef, TRANSITIONS, type LedgerEvent, type TaskProof, type TransitionAction } from '@delegate/shared';
import { Download, FileText, HardDrive, Link2, Paperclip, Send, ShieldCheck, Sparkles, StickyNote, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useToast } from '../components/Toast';
import { Avatar, Button, cx, Drawer, EASE, Field, Input, Modal, Select, Spinner, StatusBadge, Textarea } from '../components/ui';
import { api, request } from '../lib/api';
import { pickDriveFile } from '../lib/google';
import { getSupabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { clock, dueLabel, timeAgo, toLocalInput } from '../lib/format';
import { memberName, useComment, useTaskDetail, useTransition, useUpdateTask, type WorkspaceData } from './data';
import { memberOptions, priorityOptions } from './options';

export function TaskDrawer({ taskId, intent, onClose, ws }: { taskId: string | null; intent: string | null; onClose: () => void; ws: WorkspaceData }) {
  return (
    <Drawer open={!!taskId} onClose={onClose} label="Task details">
      {taskId && <DrawerBody key={taskId} taskId={taskId} intent={intent} onClose={onClose} ws={ws} />}
    </Drawer>
  );
}

function DrawerBody({ taskId, intent, onClose, ws }: { taskId: string; intent: string | null; onClose: () => void; ws: WorkspaceData }) {
  const { data, isLoading, error } = useTaskDetail(taskId);
  const transition = useTransition();
  const update = useUpdateTask();
  const toast = useToast();
  const [modal, setModal] = useState<'submit' | 'block' | 'request_changes' | null>(intent === 'submit' ? 'submit' : null);

  if (isLoading) {
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-8">
        <p className="text-sm text-mute">This task could not be loaded.</p>
        <Button className="mt-4" variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  const { task, proofs, comments, events } = data;
  const actions = availableActions(task, { userId: ws.me.userId, role: ws.me.role });
  const isManager = isManagerRole(ws.me.role);
  const canEdit = (isManager || task.createdById === ws.me.userId) && task.status !== 'approved';
  const due = dueLabel(task.dueAt);
  const dept = ws.departments.find((d) => d.id === task.departmentId);

  const run = async (action: TransitionAction) => {
    if (action === 'submit' || action === 'block' || action === 'request_changes') return setModal(action);
    try {
      await transition.mutateAsync({ id: task.id, action });
      toast.success(action === 'approve' ? 'Audited — sealed in the ledger' : `${TRANSITIONS[action].label} ✓`);
    } catch (e) {
      toast.error(e);
    }
  };

  const edit = async (patch: Record<string, unknown>) => {
    try {
      await update.mutateAsync({ id: task.id, ...patch });
      toast.success('Task updated');
    } catch (e) {
      toast.error(e);
    }
  };

  const latestAi = [...proofs].reverse().find((p) => p.aiVerdict);

  return (
    <>
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <div className="flex items-center gap-2">
          <StatusBadge status={task.status} />
          <button
            onClick={() => navigator.clipboard?.writeText(taskRef(task.seq)).then(() => toast.success(`${taskRef(task.seq)} copied — put it in a PR title to close this task from GitHub`))}
            className="rounded-full border border-line px-2.5 py-0.5 font-mono text-xs text-mute hover:border-ink hover:text-ink"
            title="Copy reference (use it in GitHub, Slack, Teams or WhatsApp)"
            data-testid="drawer-ref"
          >
            {taskRef(task.seq)}
          </button>
        </div>
        <button onClick={onClose} className="grid size-9 place-items-center rounded-full hover:bg-ink/5" aria-label="Close">
          <X className="size-[18px]" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-6 pb-6 pt-5">
          <h2 className="text-2xl font-medium leading-tight tracking-[-0.03em]" data-testid="drawer-title">
            {task.title}
          </h2>
          {task.description && <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-ink-2">{task.description}</p>}

          {/* Action bar */}
          {actions.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2" data-testid="drawer-actions">
              {actions.map((a) => (
                <Button
                  key={a}
                  size="md"
                  variant={a === 'approve' || a === 'submit' || a === 'start' ? 'primary' : a === 'block' ? 'ghost' : 'outline'}
                  className={cx(a === 'block' && 'border-line bg-paper')}
                  onClick={() => run(a)}
                  loading={transition.isPending && transition.variables?.action === a}
                  data-testid={`action-${a}`}
                >
                  {a === 'approve' ? 'Approve ✓' : TRANSITIONS[a].label}
                </Button>
              ))}
            </div>
          )}

          {task.status === 'blocked' && (
            <div className="mt-5 rounded-2xl border border-s-active/40 bg-s-active-soft px-4 py-3 text-sm text-s-active-ink">
              <p className="font-medium">Blocked{task.waitingOnId ? ` — waiting on ${memberName(ws.members, task.waitingOnId)}` : ''}</p>
              <p className="mt-0.5">{task.blockedReason}</p>
            </div>
          )}

          {/* Meta grid */}
          <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line text-sm">
            <Meta label="Assignee">
              {canEdit && isManager ? (
                <Select size="inline" value={task.assigneeId} onChange={(v) => edit({ assigneeId: v })} options={memberOptions(ws.members, { departments: ws.departments })} aria-label="Assignee" className="max-w-full" />
              ) : (
                <span className="flex items-center gap-2 font-medium">
                  <Avatar name={memberName(ws.members, task.assigneeId)} size={20} />
                  {memberName(ws.members, task.assigneeId)}
                </span>
              )}
            </Meta>
            <Meta label="Assigned by">{memberName(ws.members, task.createdById)}</Meta>
            <Meta label="Priority">
              {canEdit ? (
                <Select size="inline" value={task.priority} onChange={(v) => edit({ priority: v })} options={priorityOptions} aria-label="Priority" />
              ) : (
                <span className="font-medium capitalize">{task.priority}</span>
              )}
            </Meta>
            <Meta label="Due">
              {canEdit ? (
                <input
                  type="datetime-local"
                  className={cx('w-full bg-transparent font-medium outline-none', due.overdue && 'text-s-open-ink')}
                  defaultValue={task.dueAt ? toLocalInput(new Date(task.dueAt)) : ''}
                  onBlur={(e) => e.target.value && edit({ dueAt: new Date(e.target.value).toISOString() })}
                  aria-label="Due date"
                />
              ) : (
                <span className={cx('font-medium', due.overdue && 'text-s-open-ink')}>{due.text}</span>
              )}
            </Meta>
            <Meta label="Department">
              <span className="flex items-center gap-2 font-medium">
                {dept && <span className="size-2 rounded-full" style={{ background: dept.color }} />}
                {dept?.name ?? '—'}
              </span>
            </Meta>
            <Meta label="Time to green">
              <span className="font-medium">
                {task.submittedAt ? `${((new Date(task.submittedAt).getTime() - new Date(task.createdAt).getTime()) / 3_600_000).toFixed(1)}h` : task.startedAt ? 'In motion' : 'Not started'}
              </span>
            </Meta>
          </dl>

          {/* Proof of work */}
          <Section title="Proof of work" count={proofs.length}>
            {latestAi && (
              <div
                className={cx(
                  'mb-3 flex items-start gap-2.5 rounded-2xl px-3.5 py-3 text-sm',
                  latestAi.aiVerdict === 'pass' ? 'bg-s-done-soft text-s-done-ink' : latestAi.aiVerdict === 'review' ? 'bg-s-active-soft text-s-active-ink' : 'bg-s-open-soft text-s-open-ink',
                )}
              >
                <Sparkles className="mt-0.5 size-4 shrink-0" />
                <p>
                  <span className="font-medium">AI check: {latestAi.aiVerdict === 'pass' ? 'looks complete' : latestAi.aiVerdict === 'review' ? 'needs a human look' : 'doesn’t match the brief'}.</span> {latestAi.aiReason}
                </p>
              </div>
            )}
            {proofs.length === 0 ? (
              <p className="text-sm text-faint">No proof yet. The assignee attaches it when they mark the task executed.</p>
            ) : (
              <ul className="space-y-2" data-testid="proof-list">
                {proofs.map((p) => (
                  <ProofItem key={p.id} proof={p} taskId={task.id} author={memberName(ws.members, p.authorId)} />
                ))}
              </ul>
            )}
          </Section>

          {/* Micro-chat */}
          <Section title="Discussion" count={comments.length}>
            <Chat taskId={task.id} comments={comments} ws={ws} />
          </Section>

          {/* Activity ledger */}
          <Section title="Activity" count={events.length}>
            <ol className="relative space-y-3 border-l border-line pl-5">
              {events.map((e) => (
                <li key={e.id} className="relative text-sm">
                  <span className="absolute -left-[25px] top-1.5 size-2 rounded-full bg-line-2 ring-4 ring-milk" />
                  <span className="text-ink-2">{describeEvent(e, ws)}</span>
                  <span className="ml-2 text-xs text-faint">{clock(e.createdAt)} · {timeAgo(e.createdAt)}</span>
                </li>
              ))}
            </ol>
          </Section>
        </div>
      </div>

      <SubmitProofModal open={modal === 'submit'} onClose={() => setModal(null)} taskId={task.id} />
      <BlockModal open={modal === 'block'} onClose={() => setModal(null)} taskId={task.id} ws={ws} assigneeId={task.assigneeId} />
      <RequestChangesModal open={modal === 'request_changes'} onClose={() => setModal(null)} taskId={task.id} />
    </>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-paper px-4 py-3">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-1 truncate">{children}</dd>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
        {title}
        {count !== undefined && <span className="rounded-full bg-milk-2 px-2 text-xs text-mute">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

function ProofItem({ proof, taskId, author }: { proof: TaskProof; taskId: string; author: string }) {
  const toast = useToast();
  const download = async () => {
    try {
      const res = await request<Blob | { url: string }>(`/tasks/${taskId}/proofs/${proof.id}/file`);
      const href = res instanceof Blob ? URL.createObjectURL(res) : res.url;
      const a = document.createElement('a');
      a.href = href;
      a.download = proof.fileName ?? 'proof';
      a.target = '_blank';
      a.rel = 'noopener';
      a.click();
      if (res instanceof Blob) setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch (e) {
      toast.error(e);
    }
  };
  const Icon = proof.kind === 'link' ? Link2 : proof.kind === 'file' ? FileText : StickyNote;
  return (
    <li className="flex items-start gap-3 rounded-2xl border border-line bg-paper px-3.5 py-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-milk">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        {proof.kind === 'link' && proof.url && (
          <a href={proof.url} target="_blank" rel="noopener noreferrer nofollow" className="block truncate font-medium underline-offset-2 hover:underline">
            {proof.url.replace(/^https?:\/\//, '')}
          </a>
        )}
        {proof.kind === 'file' && (
          <button onClick={download} className="inline-flex items-center gap-1.5 font-medium hover:underline">
            {proof.fileName} <Download className="size-3.5" />
          </button>
        )}
        {proof.note && <p className={cx('text-ink-2', proof.kind !== 'note' && 'mt-0.5')}>{proof.note}</p>}
        {proof.source !== 'manual' && (
          <span className={cx('mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', proof.verified ? 'bg-s-approved-soft text-s-approved-ink' : 'bg-milk text-mute')}>
            {proof.verified ? <ShieldCheck className="size-3" /> : null}
            {proof.verified ? 'Verified by' : 'From'} {proof.source === 'gdrive' ? 'Google Drive' : proof.source === 'github' ? 'GitHub' : 'WhatsApp'}
          </span>
        )}
        <p className="mt-1 text-xs text-faint">
          {author} · {timeAgo(proof.createdAt)}
        </p>
      </div>
    </li>
  );
}

function Chat({ taskId, comments, ws }: { taskId: string; comments: Array<{ id: string; authorId: string; body: string; createdAt: string }>; ws: WorkspaceData }) {
  const [body, setBody] = useState('');
  const comment = useComment();
  const toast = useToast();
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [comments.length]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    try {
      await comment.mutateAsync({ id: taskId, body });
      setBody('');
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div>
      <div className="space-y-3" data-testid="chat-list">
        <AnimatePresence initial={false}>
          {comments.map((c) => {
            const mine = c.authorId === ws.me.userId;
            return (
              <motion.div key={c.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }} className={cx('flex gap-2.5', mine && 'flex-row-reverse')}>
                <Avatar name={memberName(ws.members, c.authorId)} size={26} />
                <div className={cx('max-w-[78%] rounded-2xl px-3.5 py-2 text-sm', mine ? 'rounded-tr-md bg-ink text-milk' : 'rounded-tl-md border border-line bg-paper')}>
                  <p className="whitespace-pre-wrap">{c.body}</p>
                  <p className={cx('mt-1 text-[11px]', mine ? 'text-milk/50' : 'text-faint')}>
                    {mine ? 'You' : memberName(ws.members, c.authorId).split(' ')[0]} · {timeAgo(c.createdAt)}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        <div ref={endRef} />
      </div>
      <form onSubmit={send} className="mt-3 flex items-center gap-2">
        <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Reply on this task…" className="h-10 rounded-full" maxLength={2000} aria-label="Message" data-testid="chat-input" />
        <Button type="submit" size="md" className="size-10 p-0" loading={comment.isPending} aria-label="Send" disabled={!body.trim()}>
          {!comment.isPending && <Send className="size-4" />}
        </Button>
      </form>
    </div>
  );
}

type ProofDraft = { kind: 'link' | 'note' | 'file'; url?: string; note?: string; filePath?: string; fileName?: string; attestation?: string };

function SubmitProofModal({ open, onClose, taskId }: { open: boolean; onClose: () => void; taskId: string }) {
  const { config } = useAuth();
  const transition = useTransition();
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [drive, setDrive] = useState<{ attestation: string; preview: { fileName: string; note: string; verified: boolean } } | null>(null);
  const [stage, setStage] = useState<'idle' | 'uploading' | 'drive' | 'verifying'>('idle');

  const fromDrive = async () => {
    if (!config?.integrations.googleDrive) return;
    setStage('drive');
    try {
      const picked = await pickDriveFile(config.integrations.googleDrive);
      if (picked) setDrive(await api.post(`/tasks/${taskId}/drive-proof`, { fileId: picked.fileId, accessToken: picked.accessToken }));
    } catch (err) {
      toast.error(err);
    } finally {
      setStage('idle');
    }
  };

  /** Supabase: browser → Storage directly (no serverless body limits). Demo: through the API. */
  const uploadFile = async (f: File): Promise<ProofDraft> => {
    const prep = await api.post<{ mode: 'direct' | 'api'; filePath?: string; fileName?: string; token?: string; bucket?: string }>(`/tasks/${taskId}/proof-uploads`, { fileName: f.name, size: f.size });
    if (prep.mode === 'direct' && config?.supabaseUrl && config.supabaseAnonKey) {
      const sb = await getSupabase(config.supabaseUrl, config.supabaseAnonKey);
      const { error } = await sb.storage.from(prep.bucket ?? 'proofs').uploadToSignedUrl(prep.filePath!, prep.token!, f, { contentType: f.type || 'application/octet-stream' });
      if (error) throw new Error(`Upload failed: ${error.message}`);
      return { kind: 'file', filePath: prep.filePath, fileName: prep.fileName };
    }
    const form = new FormData();
    form.append('file', f);
    const uploaded = await api.post<{ filePath: string; fileName: string }>(`/tasks/${taskId}/proof-files`, form);
    return { kind: 'file', ...uploaded };
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const proofs: ProofDraft[] = [];
    if (url.trim()) proofs.push({ kind: 'link', url: url.trim() });
    if (note.trim()) proofs.push({ kind: 'note', note: note.trim() });
    if (drive) proofs.push({ kind: 'link', attestation: drive.attestation });
    try {
      if (file) {
        setStage('uploading');
        proofs.push(await uploadFile(file));
      }
      if (proofs.length === 0) {
        toast.error('Add a link, a note or a file as proof');
        setStage('idle');
        return;
      }
      setStage('verifying');
      const detail = await transition.mutateAsync({ id: taskId, action: 'submit', proofs });
      const verdict = detail.proofs.at(-1)?.aiVerdict;
      toast.success(verdict === 'pass' ? 'Executed — AI check passed' : drive?.preview.verified ? 'Executed — verified with Google Drive' : 'Executed — sent for audit');
      setUrl('');
      setNote('');
      setFile(null);
      setDrive(null);
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setStage('idle');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Submit proof of work" description="Green needs evidence. Add at least one: a link, a note, a file or a Google Drive file.">
      <form onSubmit={submit} className="space-y-4" data-testid="proof-form">
        <Field label="Link" hint="Pull request, doc, recording, dashboard…">
          <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" data-testid="proof-url" />
        </Field>
        <Field label="What did you deliver?">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Shipped the v2 sequence, 5 emails live, UTM tags verified." maxLength={2000} data-testid="proof-note" />
        </Field>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-line-2 bg-milk px-4 py-3 text-sm text-mute hover:border-ink">
            <Paperclip className="size-4 shrink-0" />
            <span className="truncate">{file ? file.name : 'Attach a file (max 25 MB)'}</span>
            <input type="file" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {config?.integrations.googleDrive ? (
            <button type="button" onClick={fromDrive} disabled={stage !== 'idle'} className="flex items-center gap-3 rounded-2xl border border-dashed border-line-2 bg-milk px-4 py-3 text-left text-sm text-mute hover:border-ink disabled:opacity-60" data-testid="proof-drive">
              <HardDrive className="size-4 shrink-0" />
              <span className="truncate">{stage === 'drive' ? 'Opening Google Drive…' : drive ? drive.preview.fileName : 'Pick from Google Drive'}</span>
            </button>
          ) : (
            <p className="flex items-center gap-3 rounded-2xl border border-dashed border-line px-4 py-3 text-xs text-faint">
              <HardDrive className="size-4 shrink-0" /> Google Drive proof switches on when your admin adds Google keys.
            </p>
          )}
        </div>
        {drive && (
          <p className={cx('flex items-start gap-2 rounded-2xl px-3.5 py-2.5 text-sm', drive.preview.verified ? 'bg-s-approved-soft text-s-approved-ink' : 'bg-s-active-soft text-s-active-ink')}>
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="font-medium">{drive.preview.verified ? 'Verified with Google Drive.' : 'Attached, not verified.'}</span> {drive.preview.note}
            </span>
          </p>
        )}
        <AnimatePresence>
          {stage === 'verifying' && config?.aiVerification && (
            <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex items-center gap-2 text-sm text-mute">
              <Sparkles className="size-4 animate-pulse" /> Checking your proof against the brief…
            </motion.p>
          )}
        </AnimatePresence>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={stage === 'uploading' || stage === 'verifying'} disabled={stage === 'drive'} data-testid="proof-submit">
            Submit &amp; turn green
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function BlockModal({ open, onClose, taskId, ws, assigneeId }: { open: boolean; onClose: () => void; taskId: string; ws: WorkspaceData; assigneeId: string }) {
  const transition = useTransition();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [waitingOnId, setWaitingOnId] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await transition.mutateAsync({ id: taskId, action: 'block', reason, waitingOnId: waitingOnId || null });
      toast.success(waitingOnId ? `Blocker flagged — ${memberName(ws.members, waitingOnId).split(' ')[0]} has been pinged` : 'Blocker flagged on the heartbeat');
      setReason('');
      setWaitingOnId('');
      onClose();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Flag a blocker" description="It shows on everyone’s heartbeat, and the teammate you’re waiting on gets a nudge on their board.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="What’s blocking you?">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Waiting on the signed volume forecast before the courier call." required minLength={3} data-testid="block-reason" />
        </Field>
        <Field label="Waiting on (optional)">
          <Select
            value={waitingOnId}
            onChange={setWaitingOnId}
            options={[{ value: '', label: 'Nobody specific', description: 'Just flag it' }, ...memberOptions(ws.members.filter((m) => m.userId !== assigneeId), { departments: ws.departments })]}
            aria-label="Waiting on"
            data-testid="block-waiting-on"
          />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={transition.isPending} data-testid="block-submit">
            Flag blocker
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RequestChangesModal({ open, onClose, taskId }: { open: boolean; onClose: () => void; taskId: string }) {
  const transition = useTransition();
  const toast = useToast();
  const [comment, setComment] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await transition.mutateAsync({ id: taskId, action: 'request_changes', comment });
      toast.success('Sent back with your notes');
      setComment('');
      onClose();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Request changes" description="The task goes back to amber with your note in its discussion.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="What needs to change?">
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} required placeholder="Use the restated September revenue on slide 4." />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={transition.isPending}>
            Send back
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const SOURCE_NAMES: Record<string, string> = { github: 'GitHub', slack: 'Slack', teams: 'Teams', whatsapp: 'WhatsApp', playbook: 'Playbook', gdrive: 'Google Drive' };

export function describeEvent(e: LedgerEvent, ws: WorkspaceData, withTitle = false): string {
  const source = typeof e.meta.source === 'string' ? SOURCE_NAMES[e.meta.source] : undefined;
  const who = e.actorId ? memberName(ws.members, e.actorId) : (source ?? 'Automation');
  const via = e.actorId && source && source !== 'App' ? ` via ${source}` : '';
  const title = withTitle && typeof e.meta.title === 'string' ? ` “${e.meta.title}”` : '';
  switch (e.type) {
    case 'task.created':
      return `${who} assigned${title} to ${memberName(ws.members, e.meta.assigneeId as string)}${via}`;
    case 'task.started':
      return `${who} started${title}${via}`;
    case 'task.blocked':
      return `${who} flagged a blocker${title}${e.meta.waitingOnId ? ` — waiting on ${memberName(ws.members, e.meta.waitingOnId as string)}` : ''}${via}`;
    case 'task.unblocked':
      return `${who} unblocked${title}${via}`;
    case 'task.submitted':
      return `${who} submitted proof${title}${e.meta.verified ? ' · verified' : ''}${e.meta.aiVerdict === 'pass' ? ' · AI check passed' : ''}${via}`;
    case 'task.approved':
      return `${who} audited and closed${title}`;
    case 'task.changes_requested':
      return `${who} requested changes${title}`;
    case 'task.commented':
      return `${who} replied${title}`;
    case 'task.updated':
      return `${who} edited${title} (${((e.meta.fields as string[]) ?? []).join(', ')})`;
    case 'task.escalated':
      return `Escalated${title} to ${e.meta.level === 2 ? 'the owner' : 'managers'} — blocked ${e.meta.hours}h`;
    case 'task.proof_attached':
      return `${who} attached proof${title}`;
    case 'member.joined':
      return `${who} joined the workspace`;
    case 'member.role_changed':
      return `${who} made ${e.meta.name} a ${e.meta.to}`;
    case 'org.created':
      return `${who} created the workspace`;
    case 'playbook.ran':
      return `Playbook “${e.meta.name}” created ${e.meta.tasks} task(s)`;
    case 'billing.updated':
      return `Billing updated: ${e.meta.plan} · ${String(e.meta.status).replace('_', ' ')}`;
    case 'integration.connected':
      return `${who} connected ${SOURCE_NAMES[String(e.meta.provider)] ?? e.meta.provider}`;
    case 'integration.disconnected':
      return `${who} disconnected ${SOURCE_NAMES[String(e.meta.provider)] ?? e.meta.provider}`;
    default:
      return `${who} ${e.type}`;
  }
}
