import { Router, type Request, type Response } from 'express';
import { HttpError } from '../lib/errors.js';
import type { BillingService } from '../services/billing.js';
import type { HookResult, IntegrationService } from '../services/integrations.js';

/**
 * Inbound webhooks. Mounted with express.raw() BEFORE the JSON parser: signatures are computed
 * over the exact bytes the provider sent, so the body must not be re-serialised.
 */

function raw(req: Request): Buffer {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  // The platform already consumed and parsed the body (Vercel's Node helpers), so the exact bytes
  // the signature covers are gone. Fail loudly with a 5xx: providers retry, nothing is lost once fixed.
  console.error('[hooks] raw body unavailable — set NODEJS_HELPERS=0 in the Vercel project environment variables');
  throw new HttpError(500, 'Webhook raw body unavailable: set NODEJS_HELPERS=0 in your Vercel environment variables', 'raw_body_unavailable');
}

function send(res: Response, r: HookResult) {
  res.status(r.status);
  if (r.contentType === 'text') res.type('text/plain').send(String(r.body ?? ''));
  else res.json(r.body);
}

export function hookRoutes(deps: { billing: BillingService; integrations: IntegrationService }) {
  const { billing, integrations } = deps;
  const r = Router();

  r.post('/stripe', async (req, res) => {
    const result = await billing.handleStripeWebhook(raw(req), req.header('stripe-signature'));
    res.json({ received: true, result });
  });

  r.post('/paystack', async (req, res) => {
    const result = await billing.handlePaystackWebhook(raw(req), req.header('x-paystack-signature'));
    res.json({ received: true, result });
  });

  r.post('/slack/commands', async (req, res) => send(res, await integrations.handleSlackCommand(raw(req).toString('utf8'), req.headers)));
  r.post('/slack/interactivity', async (req, res) => send(res, await integrations.handleSlackInteraction(raw(req).toString('utf8'), req.headers)));

  r.post('/teams/:id', async (req, res) => send(res, await integrations.handleTeamsOutgoing(String(req.params.id), raw(req), req.header('authorization'))));

  // Meta verifies the callback URL with a GET before sending events.
  r.get('/whatsapp', (req, res) => send(res, integrations.verifyWhatsAppSubscription(req.query as Record<string, unknown>)));
  r.post('/whatsapp', async (req, res) => send(res, await integrations.handleWhatsAppWebhook(raw(req), req.header('x-hub-signature-256'))));

  r.post('/github/:id', async (req, res) => send(res, await integrations.handleGitHubWebhook(String(req.params.id), raw(req), req.headers)));

  return r;
}
