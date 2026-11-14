/**
 * Public business details shown on the website and in the legal pages. Set them in Vercel →
 * Settings → Environment Variables (then redeploy), or in the root .env for local work:
 *
 *   VITE_COMPANY_NAME   legal/trading name, e.g. "Delegate Technologies Ltd"   (default: Delegate)
 *   VITE_SUPPORT_EMAIL  an inbox you read, for support, privacy and sales       (no default)
 *   VITE_LEGAL_COUNTRY  whose law governs the Terms                             (default: Nigeria)
 */
const env = import.meta.env as Record<string, string | undefined>;

export const SITE = {
  company: env.VITE_COMPANY_NAME?.trim() || 'Delegate',
  email: env.VITE_SUPPORT_EMAIL?.trim() || null,
  country: env.VITE_LEGAL_COUNTRY?.trim() || 'Nigeria',
};

/** A mailto: link to the support inbox, or null when none is configured (callers hide the link). */
export const mailto = (subject?: string) => (SITE.email ? `mailto:${SITE.email}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}` : null);
