import { isManagerRole, isSettledByRecall, STATUS_META, taskRef, type Member, type Task, type TaskPriority, type TransitionAction } from '@delegate/shared';
import { HttpError } from '../lib/errors.js';
import type { Store } from '../store/types.js';
import { startOfDayInTz } from './metrics.js';
import type { Ctx, WorkspaceService } from './workspace.js';

/**
 * One command language for Slack, Teams and WhatsApp:
 *   new <title> [@person] [today|tomorrow|fri|due:2026-12-01] [!urgent|!high|!low]
 *   list · start DLG-12 · done DLG-12 <link or note> · block DLG-12 <reason> · unblock DLG-12 · approve DLG-12 · help
 */

export type Channel = 'slack' | 'teams' | 'whatsapp';

export interface ParsedCommand {
  verb: 'help' | 'list' | 'create' | 'start' | 'done' | 'block' | 'unblock' | 'approve' | 'unknown';
  ref: number | null;
  rest: string;
}

const VERBS: Record<string, ParsedCommand['verb']> = {
  help: 'help',
  '?': 'help',
  list: 'list',
  tasks: 'list',
  mine: 'list',
  new: 'create',
  add: 'create',
  create: 'create',
  start: 'start',
  begin: 'start',
  done: 'done',
  submit: 'done',
  finished: 'done',
  block: 'block',
  blocked: 'block',
  unblock: 'unblock',
  approve: 'approve',
  audit: 'approve',
};

export function parseCommand(text: string, channel: Channel): ParsedCommand {
  const clean = text.replace(/\s+/g, ' ').trim();
  const [first = '', ...restWords] = clean.split(' ');
  const verb = VERBS[first.toLowerCase()];
  if (!verb) {
    // In Slack/Teams a bare sentence creates a task; on WhatsApp we don't guess ("hi" ≠ a task).
    return clean && channel !== 'whatsapp' ? { verb: 'create', ref: null, rest: clean } : { verb: clean ? 'unknown' : 'help', ref: null, rest: clean };
  }
  let rest = restWords.join(' ');
  let ref: number | null = null;
  if (['start', 'done', 'block', 'unblock', 'approve'].includes(verb)) {
    const m = rest.match(/^(?:DLG-|#)?(\d{1,7})\b\s*(.*)$/i);
    if (m) {
      ref = Number(m[1]);
      rest = m[2] ?? '';
    }
  }
  return { verb, ref, rest: rest.trim() };
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Pulls due date + priority tokens out of a task sentence. Due = 18:00 local on that day. */
export function extractTaskHints(text: string, timezone: string, now = new Date()): { title: string; dueAt: string | null; priority: TaskPriority | null } {
  let dueDay: Date | null = null;
  let priority: TaskPriority | null = null;
  const words: string[] = [];
  const today = startOfDayInTz(now, timezone);
  const dayIndex = new Date(today.getTime() + 12 * 3_600_000).getUTCDay();
  const all = text.split(/\s+/).filter(Boolean);
  for (const [index, word] of all.entries()) {
    const w = word.toLowerCase().replace(/[.,;]$/, '');
    const pr = w.match(/^!(urgent|high|medium|low)$/);
    if (pr) {
      priority = pr[1] as TaskPriority;
      continue;
    }
    if (w === 'today' || w === 'eod') {
      dueDay = today;
      continue;
    }
    if (w === 'tomorrow' || w === 'tmrw') {
      dueDay = new Date(today.getTime() + 86_400_000);
      continue;
    }
    const iso = w.match(/^due:(\d{4}-\d{2}-\d{2})$/);
    if (iso) {
      dueDay = startOfDayInTz(new Date(`${iso[1]}T12:00:00Z`), timezone);
      continue;
    }
    // Full weekday names anywhere ("friday"); short forms ("fri") only as the last word,
    // so a title like "Clean the sun lounge" doesn't become due on Sunday.
    const isLast = index === all.length - 1;
    const wd = WEEKDAYS.findIndex((full) => w === full || (isLast && w.length >= 3 && full.startsWith(w)));
    if (wd >= 0) {
      const ahead = (wd - dayIndex + 7) % 7 || 7;
      dueDay = new Date(today.getTime() + ahead * 86_400_000);
      continue;
    }
    words.push(word);
  }
  return {
    title: words.join(' ').trim(),
    dueAt: dueDay ? new Date(dueDay.getTime() + 18 * 3_600_000).toISOString() : null,
    priority,
  };
}

export interface CommandEnv {
  ctx: Ctx;
  channel: Channel;
  timezone: string;
  appUrl: string;
  /** Channel-specific mention tokens already resolved to Delegate user ids. */
  mentionedUserIds?: string[];
}

export class CommandService {
  constructor(
    private store: Store,
    private workspace: WorkspaceService,
  ) {}

  help(channel: Channel): string {
    const slash = channel === 'slack' ? '/delegate ' : channel === 'teams' ? '@Delegate ' : '';
    return [
      'Delegate commands:',
      `• ${slash}new Fix checkout timeout @person tomorrow !high`,
      `• ${slash}list — your open tasks`,
      `• ${slash}start DLG-12`,
      `• ${slash}done DLG-12 https://link-to-proof (or a short note)`,
      `• ${slash}block DLG-12 waiting on finance`,
      `• ${slash}unblock DLG-12`,
      `• ${slash}approve DLG-12 (managers)`,
    ].join('\n');
  }

  async execute(env: CommandEnv, text: string): Promise<string> {
    const cmd = parseCommand(text, env.channel);
    try {
      switch (cmd.verb) {
        case 'help':
          return this.help(env.channel);
        case 'unknown':
          return `I didn't catch that.\n\n${this.help(env.channel)}`;
        case 'list':
          return this.list(env);
        case 'create':
          return this.create(env, cmd.rest);
        default:
          return this.transition(env, cmd);
      }
    } catch (error) {
      if (error instanceof HttpError) return `⚠️ ${error.message}`;
      console.error('[commands] failed', error);
      return '⚠️ Something went wrong. Try again in the app.';
    }
  }

  private link(env: CommandEnv, task: Task) {
    return `${env.appUrl}/app?task=${task.id}`;
  }

  private async list(env: CommandEnv) {
    const tasks = (await this.store.listTasks({ orgId: env.ctx.orgId, statuses: ['open', 'in_progress', 'blocked', 'done'] }))
      .filter((t) => t.assigneeId === env.ctx.userId && !isSettledByRecall(t))
      .sort((a, b) => a.seq - b.seq);
    if (!tasks.length) return 'Nothing on your plate. 🎉';
    return [`Your tasks (${tasks.length}):`, ...tasks.slice(0, 15).map((t) => `• ${taskRef(t.seq)} ${t.title} — ${STATUS_META[t.status].label}`), '', 'Reply e.g. "start DLG-12" or "done DLG-12 <link>".'].join('\n');
  }

  private async create(env: CommandEnv, text: string) {
    const hints = extractTaskHints(text.replace(/<@[^>]+>|@\S+/g, ' '), env.timezone);
    if (hints.title.length < 3) return 'Give the task a title, e.g. "new Send the Q4 invoice to Acme tomorrow".';
    const assigneeId = env.mentionedUserIds?.[0] ?? env.ctx.userId;
    const task = await this.workspace.createTask(env.ctx, { title: hints.title, assigneeId, dueAt: hints.dueAt, priority: hints.priority ?? undefined }, env.channel);
    const members = await this.store.listMembers(env.ctx.orgId);
    const who = assigneeId === env.ctx.userId ? 'you' : (members.find((m: Member) => m.userId === assigneeId)?.fullName ?? 'them');
    return `✅ Created ${taskRef(task.seq)} “${task.title}” for ${who}.\n${this.link(env, task)}`;
  }

  private async transition(env: CommandEnv, cmd: ParsedCommand) {
    if (!cmd.ref) return `Which task? Use its number, e.g. "${cmd.verb} DLG-12". Reply "list" to see yours.`;
    const task = await this.workspace.findByRef(env.ctx.orgId, cmd.ref);
    if (!task) return `I can't find DLG-${cmd.ref} in your workspace.`;
    const action: TransitionAction = cmd.verb === 'done' ? 'submit' : (cmd.verb as TransitionAction);
    if (action === 'approve' && !isManagerRole(env.ctx.role)) return 'Only managers can audit tasks.';
    const input =
      action === 'block'
        ? { reason: cmd.rest || 'Blocked (no reason given)' }
        : action === 'submit'
          ? { proofs: [/^https?:\/\//i.test(cmd.rest) ? { kind: 'link' as const, url: cmd.rest.split(' ')[0]!, note: cmd.rest.split(' ').slice(1).join(' ') || null } : { kind: 'note' as const, note: cmd.rest }] }
          : {};
    if (action === 'submit' && !cmd.rest) return `Add proof: "done DLG-${cmd.ref} https://link" or a short note of what you delivered.`;
    // "done" on an open task: start it first so the ledger stays truthful.
    if (action === 'submit' && task.status === 'open') await this.workspace.transition(env.ctx, task.id, 'start', {});
    const detail = await this.workspace.transition(env.ctx, task.id, action, input);
    const label = STATUS_META[detail.task.status].label;
    return `${taskRef(task.seq)} → ${label}${detail.task.status === 'approved' ? ' ✓' : ''}\n${this.link(env, task)}`;
  }
}
