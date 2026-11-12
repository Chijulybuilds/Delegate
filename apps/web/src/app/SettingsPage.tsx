import { isManagerRole } from '@delegate/shared';
import { useSearchParams } from 'react-router';
import { Spinner } from '../components/ui';
import { PageHeader } from './AppShell';
import { useWorkspace } from './data';
import { AccountTab } from './settings/AccountTab';
import { AutomationsTab } from './settings/AutomationsTab';
import { BillingTab } from './settings/BillingTab';
import { IntegrationsTab } from './settings/IntegrationsTab';
import { WorkspaceTab } from './settings/WorkspaceTab';

/** Staff only see what they can act on; managers see the whole control panel. */
const TABS = [
  { id: 'workspace', label: 'Workspace', managers: false },
  { id: 'integrations', label: 'Integrations', managers: true },
  { id: 'billing', label: 'Billing', managers: true },
  { id: 'automations', label: 'Automations', managers: true },
  { id: 'account', label: 'Account', managers: false },
] as const;
type TabId = (typeof TABS)[number]['id'];

export default function SettingsPage() {
  const ws = useWorkspace();
  const [params, setParams] = useSearchParams();
  if (!ws.data) return <Spinner className="m-8" />;
  const manager = isManagerRole(ws.data.me.role);
  const tabs = TABS.filter((t) => manager || !t.managers);
  const tab = (tabs.find((t) => t.id === params.get('tab'))?.id ?? (manager ? 'workspace' : 'account')) as TabId;

  return (
    <div>
      <PageHeader title="Settings" />
      <div className="scrollbar-none mb-6 flex gap-1 overflow-x-auto border-b border-line px-4 sm:px-8" role="tablist">
        {tabs.map((t) => (
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
