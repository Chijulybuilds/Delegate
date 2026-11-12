import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import type { AiVerdict } from '@delegate/shared';
import type { AppConfig } from '../config.js';

export interface ProofCheckInput {
  title: string;
  description: string;
  proofs: Array<{ kind: string; url: string | null; note: string | null; fileName: string | null }>;
}

export interface ProofCheckResult {
  verdict: AiVerdict;
  reason: string;
}

export interface ProofVerifier {
  readonly enabled: boolean;
  check(input: ProofCheckInput): Promise<ProofCheckResult | null>;
}

const VerdictSchema = z.object({
  verdict: z.enum(['pass', 'review', 'fail']),
  reason: z.string(),
});

const SYSTEM_PROMPT = `You review "proof of work" that a team member attached when marking a task as done.
Decide whether the proof plausibly shows the task was completed as described.

- "pass": the proof directly addresses the task and contains specific evidence (a relevant link, concrete numbers, a deliverable).
- "review": the proof is related but vague, partial, or impossible to judge from text alone — a human should look.
- "fail": the proof is unrelated to the task, empty of substance, or contradicts completion.

You cannot open links; judge a link only by its domain and path. Be fair: short proofs can still pass if they are specific.
The reason is shown to the manager next to the task. Write one sentence, at most 25 words, plain language, no preamble.`;

/** Advisory AI check of proof-of-work. Managers still make the final call. */
export class ClaudeProofVerifier implements ProofVerifier {
  readonly enabled = true;
  private client: Anthropic;

  constructor(
    apiKey: string,
    private model: string,
  ) {
    this.client = new Anthropic({ apiKey, timeout: 15_000, maxRetries: 1 }); // worst case ~30 s, inside the 60 s function limit
  }

  async check(input: ProofCheckInput): Promise<ProofCheckResult | null> {
    const proofText = input.proofs
      .map((p, i) => {
        const parts = [`#${i + 1} (${p.kind})`];
        if (p.url) parts.push(`url: ${p.url}`);
        if (p.fileName) parts.push(`file: ${p.fileName}`);
        if (p.note) parts.push(`note: ${p.note}`);
        return parts.join(' | ');
      })
      .join('\n');

    try {
      const response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 1024,
        // Route policy declines to the model's default fallback instead of failing the check.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low', format: betaZodOutputFormat(VerdictSchema) },
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `<task>\n<title>${input.title}</title>\n<description>${input.description || '(no description)'}</description>\n</task>\n<proof>\n${proofText}\n</proof>`,
          },
        ],
      });

      if (response.stop_reason === 'refusal' || !response.parsed_output) return null;
      return { verdict: response.parsed_output.verdict, reason: response.parsed_output.reason.slice(0, 300) };
    } catch (error) {
      // Verification is advisory: never block a submission because the AI call failed.
      if (error instanceof Anthropic.RateLimitError) console.warn('[ai] proof check rate limited');
      else if (error instanceof Anthropic.APIError) console.warn(`[ai] proof check failed (${error.status}): ${error.message}`);
      else console.warn('[ai] proof check failed', error);
      return null;
    }
  }
}

export const disabledVerifier: ProofVerifier = { enabled: false, check: async () => null };

export function createVerifier(config: AppConfig): ProofVerifier {
  return config.ai ? new ClaudeProofVerifier(config.ai.apiKey, config.ai.model) : disabledVerifier;
}
