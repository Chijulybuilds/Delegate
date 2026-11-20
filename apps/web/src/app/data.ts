import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AuditFilters,
  AuditsResponse,
  BillingOverview,
  BoardResponse,
  HistoryResponse,
  NotificationsResponse,
  TaskFilters,
  Department,
  Entitlements,
  IntegrationsOverview,
  LedgerEvent,
  Playbook,
  ProofSource,
  Member,
  MemberRole,
  Organization,
  StandupBrief,
  Task,
  TaskDetail,
  TaskProof,
  TransitionAction,
  VelocityResponse,
} from '@delegate/shared';
import { useEffect } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { getSupabase } from '../lib/supabase';

export interface WorkspaceData {
  org: Organization;
  members: Member[];
  departments: Department[];
  entitlements: Entitlements;
  me: { userId: string; role: MemberRole; departmentId: string | null };
}

export type BoardData = BoardResponse;

const LIVE_MS = 5_000;

export function useWorkspace() {
  return useQuery({ queryKey: ['workspace'], queryFn: () => api.get<WorkspaceData>('/workspace'), staleTime: 30_000 });
}

export function useBoard() {
  return useQuery({
    queryKey: ['tasks'],
    queryFn: () => api.get<BoardData>('/tasks'),
    refetchInterval: LIVE_MS,
  });
}

export function useTaskDetail(id: string | null) {
  return useQuery({
    queryKey: ['task', id],
    queryFn: () => api.get<TaskDetail>(`/tasks/${id}`),
    enabled: !!id,
    refetchInterval: id ? LIVE_MS : false,
  });
}

export function useFeed(limit = 60) {
  return useQuery({
    queryKey: ['feed', limit],
    queryFn: () => api.get<{ events: LedgerEvent[] }>(`/feed?limit=${limit}`),
    refetchInterval: LIVE_MS,
  });
}

export function useVelocity(days: number) {
  return useQuery({ queryKey: ['velocity', days], queryFn: () => api.get<VelocityResponse>(`/metrics/velocity?days=${days}`) });
}

export function useStandup() {
  return useQuery({ queryKey: ['standup'], queryFn: () => api.get<{ brief: StandupBrief; text: string }>('/standup') });
}

function useInvalidateWork() {
  const qc = useQueryClient();
  return (taskId?: string) => {
    qc.invalidateQueries({ queryKey: ['tasks'] });
    qc.invalidateQueries({ queryKey: ['feed'] });
    qc.invalidateQueries({ queryKey: ['velocity'] });
    qc.invalidateQueries({ queryKey: ['standup'] });
    qc.invalidateQueries({ queryKey: ['history'] });
    qc.invalidateQueries({ queryKey: ['audits'] });
    if (taskId) qc.invalidateQueries({ queryKey: ['task', taskId] });
  };
}

export interface TransitionVars {
  id: string;
  action: TransitionAction;
  reason?: string;
  waitingOnId?: string | null;
  comment?: string;
  proofs?: Array<{ kind: 'link' | 'note' | 'file'; url?: string; note?: string; filePath?: string; fileName?: string; attestation?: string }>;
}

export function useTransition() {
  const qc = useQueryClient();
  const invalidate = useInvalidateWork();
  return useMutation({
    mutationFn: ({ id, ...body }: TransitionVars) => api.post<TaskDetail>(`/tasks/${id}/transitions`, body),
    // Optimistic: move the card immediately; the server is the source of truth on settle.
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ['tasks'] });
      const prev = qc.getQueryData<BoardData>(['tasks']);
      const to: Partial<Record<TransitionAction, Task['status']>> = {
        start: 'in_progress',
        block: 'blocked',
        unblock: 'in_progress',
        approve: 'approved',
        request_changes: 'in_progress',
      };
      const next = to[vars.action];
      if (prev && next) {
        qc.setQueryData(['tasks'], { ...prev, tasks: prev.tasks.map((t) => (t.id === vars.id ? { ...t, status: next } : t)) });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['tasks'], ctx.prev);
    },
    onSuccess: (detail) => qc.setQueryData(['task', detail.task.id], detail),
    onSettled: (_d, _e, vars) => invalidate(vars.id),
  });
}

export function useCreateTask() {
  const invalidate = useInvalidateWork();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<{ task: Task }>('/tasks', body),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateTask() {
  const invalidate = useInvalidateWork();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) => api.patch<{ task: Task }>(`/tasks/${id}`, body),
    onSuccess: (_d, vars) => invalidate(vars.id),
  });
}

export function useComment() {
  const invalidate = useInvalidateWork();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => api.post(`/tasks/${id}/comments`, { body }),
    onSuccess: (_d, vars) => invalidate(vars.id),
  });
}

/**
 * When Supabase is connected, Realtime pushes "something changed" pings for this workspace
 * (RLS-scoped) so the board updates instantly; polling remains as the fallback.
 */
export function useRealtimeHeartbeat(orgId: string | undefined) {
  const { config, token } = useAuth();
  const invalidate = useInvalidateWork();
  useEffect(() => {
    if (!orgId || !token || config?.authMode !== 'supabase' || !config.supabaseUrl || !config.supabaseAnonKey) return;
    let cleanup: (() => void) | null = null;
    let active = true;
    getSupabase(config.supabaseUrl, config.supabaseAnonKey).then((sb) => {
      if (!active) return;
      sb.realtime.setAuth(token);
      const channel = sb
        .channel(`org-${orgId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_events', filter: `org_id=eq.${orgId}` }, (payload) => {
          invalidate((payload.new as { task_id?: string }).task_id ?? undefined);
        })
        .subscribe();
      cleanup = () => sb.removeChannel(channel);
    });
    return () => {
      active = false;
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, token, config]);
}

export function memberName(members: Member[] | undefined, id: string | null | undefined): string {
  if (!id) return 'Someone';
  return members?.find((m) => m.userId === id)?.fullName ?? 'Former member';
}

/* ------------------------------------------------------------------ SaaS: billing, integrations, notifications, playbooks */

export function useBilling() {
  return useQuery({ queryKey: ['billing'], queryFn: () => api.get<BillingOverview>('/billing'), staleTime: 15_000 });
}

export function useIntegrations() {
  return useQuery({ queryKey: ['integrations'], queryFn: () => api.get<IntegrationsOverview>('/integrations'), refetchInterval: 15_000 });
}

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<NotificationsResponse>('/notifications'),
    refetchInterval: 8_000,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[] | 'all') => api.post('/notifications/read', { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

/** Opening a task clears the red badge on its card (its unread messages and updates). */
export function useMarkTaskRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.post('/notifications/read', { taskId }),
    onMutate: (taskId) => {
      qc.setQueryData<NotificationsResponse>(['notifications'], (old) => {
        if (!old?.tasks[taskId]) return old;
        const tasks = { ...old.tasks };
        delete tasks[taskId];
        return { ...old, tasks };
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

const toQuery = (f: Record<string, string | number | boolean | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '') q.set(k, String(v));
  return q.toString();
};

/** Earlier days for the owner's History board (up to 500 tasks per view). */
/** Recall one earlier task to today (optionally to someone else, with a due time and a note). */
export function useRecall() {
  const invalidate = useInvalidateWork();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; assigneeId?: string; dueAt?: string | null; note?: string }) => api.post<{ task: Task; from: Task }>(`/tasks/${id}/recall`, body),
    onSuccess: (r) => invalidate(r.from.id),
  });
}

/** Recall several earlier tasks at once (the Recall page). */
export function useRecallMany() {
  const invalidate = useInvalidateWork();
  return useMutation({
    mutationFn: (taskIds: string[]) => api.post<{ recalled: Array<{ fromId: string; task: Task }>; skipped: Array<{ id: string; reason: string }> }>('/recall', { taskIds }),
    onSuccess: () => invalidate(),
  });
}

export function useHistory(f: TaskFilters, enabled = true, pageSize = 500) {
  return useQuery({
    queryKey: ['history', f, pageSize],
    queryFn: () => api.get<HistoryResponse>(`/history?${toQuery({ ...f, pageSize })}`),
    placeholderData: (prev) => prev,
    refetchInterval: 15_000,
    enabled,
  });
}

export function useAudits(f: AuditFilters, page: number, enabled = true) {
  return useQuery({
    queryKey: ['audits', f, page],
    queryFn: () => api.get<AuditsResponse>(`/audits?${toQuery({ ...f, page })}`),
    placeholderData: (prev) => prev,
    enabled,
  });
}

export const auditsExportPath = (f: AuditFilters) => `/audits/export?${toQuery({ ...f })}`;

export function usePlaybooks() {
  return useQuery({ queryKey: ['playbooks'], queryFn: () => api.get<{ playbooks: Playbook[] }>('/playbooks') });
}
