import { useQueryClient } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../../components/Toast';
import { Avatar, Button, Card } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useIntegrations, type WorkspaceData } from '../data';
import { DangerZone } from './LeaveOrDelete';

export function AccountTab({ ws }: { ws: WorkspaceData }) {
  const { me, signOut, config } = useAuth();
  const { data } = useIntegrations();
  const qc = useQueryClient();
  const toast = useToast();
  const [code, setCode] = useState<{ code: string; link: string | null } | null>(null);
  if (!me) return null;
  const phone = data?.me.phone ?? null;
  const whatsappOn = data?.integrations.find((i) => i.provider === 'whatsapp')?.connected;
  const number = config?.integrations.whatsapp.businessNumber;

  const generate = async () => {
    try {
      setCode(await api.post('/integrations/whatsapp/link-code'));
    } catch (e) {
      toast.error(e);
    }
  };

  const unlink = async () => {
    try {
      await api.post('/integrations/whatsapp/unlink');
      await qc.invalidateQueries({ queryKey: ['integrations'] });
      toast.success('WhatsApp unlinked');
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="grid max-w-5xl gap-4 lg:grid-cols-2">
      <Card className="p-6">
        <h2 className="text-[15px] font-medium">Your account</h2>
        <div className="mt-5 flex items-center gap-3">
          <Avatar name={me.profile.fullName} src={me.profile.avatarUrl} size={48} />
          <div>
            <p className="font-medium">{me.profile.fullName}</p>
            <p className="text-sm text-mute">{me.profile.email}</p>
          </div>
        </div>
        <p className="mt-5 text-sm text-mute">
          {config?.authMode === 'demo' ? 'Demo session' : 'Signed in'} · {ws.org.name}
        </p>
        <Button variant="outline" className="mt-5" onClick={() => signOut()}>
          Sign out
        </Button>
      </Card>

      <Card className="p-6" data-testid="whatsapp-link">
        <div className="flex items-center gap-2">
          <MessageCircle className="size-[18px]" />
          <h2 className="text-[15px] font-medium">WhatsApp</h2>
        </div>
        {phone ? (
          <>
            <p className="mt-3 text-sm">
              Linked to <span className="font-medium">+{phone}</span>. New tasks, blocker pings and the morning brief arrive there.
            </p>
            <p className="mt-2 rounded-xl bg-milk px-3 py-2 text-xs text-ink-2">Reply: list · start DLG-12 · done DLG-12 https://proof · block DLG-12 reason</p>
            <Button variant="ghost" className="mt-4" onClick={unlink}>
              Unlink this number
            </Button>
          </>
        ) : !whatsappOn ? (
          <p className="mt-3 text-sm text-mute">A manager needs to switch WhatsApp on for {ws.org.name} (Settings → Integrations).</p>
        ) : (
          <>
            <p className="mt-3 text-sm text-mute">Link your phone in one message — no app to install.</p>
            {code ? (
              <div className="mt-4 space-y-3">
                <p className="text-sm">
                  Send <code className="rounded bg-milk px-1.5 py-0.5 font-mono text-[13px]">LINK {code.code}</code> {number ? <>to <span className="font-medium">+{number}</span></> : 'to the Delegate business number'} on WhatsApp. It expires in 30 minutes.
                </p>
                {code.link && (
                  <a href={code.link} target="_blank" rel="noreferrer">
                    <Button>Open WhatsApp</Button>
                  </a>
                )}
              </div>
            ) : (
              <Button className="mt-4" onClick={generate} data-testid="whatsapp-generate">
                Link WhatsApp
              </Button>
            )}
          </>
        )}
      </Card>

      <DangerZone members={ws.members} orgName={ws.org.name} />
    </div>
  );
}
