import { Navigate, useSearchParams } from 'react-router';
import { Segmented } from '../components/ui';
import { PageHeader } from './AppShell';
import { useWorkspace } from './data';
import StandupPage from './StandupPage';
import VelocityPage from './VelocityPage';

/** Velocity Pulse + Standup-in-a-Box in one place. */
export default function InsightsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'standup' ? 'standup' : 'velocity';
  const ws = useWorkspace().data;
  // Insights compare teammates, so they're for the owner only.
  if (ws && ws.me.role !== 'owner') return <Navigate to="/app" replace />;
  return (
    <div>
      <PageHeader
        title="Insights"
        actions={
          <Segmented
            value={tab}
            onChange={(v) => setParams({ tab: v }, { replace: true })}
            options={[
              { value: 'velocity', label: 'Velocity' },
              { value: 'standup', label: 'Standup' },
            ]}
          />
        }
      />
      {tab === 'velocity' ? <VelocityPage embedded /> : <StandupPage embedded />}
    </div>
  );
}
