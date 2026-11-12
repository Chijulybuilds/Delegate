import { useSearchParams } from 'react-router';
import { Spinner } from '../components/ui';
import { PageHeader } from './AppShell';
import { useWorkspace } from './data';
import { AccountTab } from './settings/AccountTab';
import { AutomationsTab } from './settings/AutomationsTab';
import { BillingTab } from './settings/BillingTab';
import { IntegrationsTab } from './settings/IntegrationsTab';
import { WorkspaceTab } from './settings/WorkspaceTab';

const TABS = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'billing', label: 'Billing' },
  { id: 'automations', label: 'Automations' },
  { id: 'account', label: 'Account' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export default function SettingsPage() {
  const ws = useWorkspace();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'workspace') as TabId;
  if (!ws.data) return <Spinner className="m-8" />;

  return (
    <div>
      <PageHeader title="Settings" />
      <div className="scrollbar-none mb-6 flex gap-1 overflow-x-auto border-b border-line px-4 sm:px-8" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setParams({ tab: t.id }, { replace: true })}
            className={`relative h-10 shrink-0 px-3 text-sm transition-colors ${tab === t.id ? 'font-medium text-ink' : 'text-mute hover:text-ink'}`}
          >
            {t.label}
            {tab === t.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-ink" />}
          </button>
        ))}
      </div>
      <div className="px-4 pb-12 sm:px-8">
        {tab === 'workspace' && <WorkspaceTab ws={ws.data} />}
        {tab === 'integrations' && <IntegrationsTab ws={ws.data} />}
        {tab === 'billing' && <BillingTab ws={ws.data} />}
        {tab === 'automations' && <AutomationsTab ws={ws.data} />}
        {tab === 'account' && <AccountTab ws={ws.data} />}
      </div>
    </div>
  );
}
