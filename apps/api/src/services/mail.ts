import type { AppConfig } from '../config.js';

export interface Mailer {
  readonly enabled: boolean;
  send(input: { to: string[]; subject: string; text: string }): Promise<boolean>;
}

/** Transactional email via Resend's HTTP API. No-ops (and logs) when RESEND_API_KEY is unset. */
export function createMailer(config: AppConfig): Mailer {
  if (!config.mail) {
    return {
      enabled: false,
      async send({ to, subject }) {
        console.info(`[mail] (disabled) would send "${subject}" to ${to.length} recipient(s)`);
        return false;
      },
    };
  }
  const { apiKey, from } = config.mail;
  return {
    enabled: true,
    async send({ to, subject, text }) {
      if (to.length === 0) return false;
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, subject, text }),
      });
      if (!res.ok) {
        console.warn(`[mail] send failed (${res.status}): ${await res.text().catch(() => '')}`);
        return false;
      }
      return true;
    },
  };
}
