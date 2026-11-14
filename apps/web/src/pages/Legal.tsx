import { motion } from 'motion/react';
import { useEffect, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { cx, EASE, Logo } from '../components/ui';
import { SITE } from '../lib/site';

/**
 * Privacy Policy and Terms of Service. Plain-language starting points written for how Delegate
 * actually works (Supabase, Vercel, Stripe/Paystack, optional integrations). Have them reviewed by
 * a lawyer before relying on them; set VITE_COMPANY_NAME / VITE_SUPPORT_EMAIL / VITE_LEGAL_COUNTRY.
 */

const UPDATED = '14 November 2026';

function LegalPage({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · Delegate`;
    window.scrollTo(0, 0);
  }, [title]);
  return (
    <div className="min-h-dvh bg-milk">
      <header className="sticky top-0 z-10 border-b border-line bg-milk/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-5">
          <Link to="/" aria-label="Delegate home">
            <Logo />
          </Link>
          <nav className="flex gap-1 text-sm" aria-label="Legal">
            {[
              ['/privacy', 'Privacy'],
              ['/terms', 'Terms'],
            ].map(([to, label]) => (
              <NavLink key={to} to={to!} className={({ isActive }) => cx('rounded-full px-3 py-1.5 transition-colors', isActive ? 'bg-ink text-milk' : 'text-mute hover:text-ink')}>
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <motion.main className="mx-auto max-w-3xl px-5 pb-24 pt-12" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-faint">Last updated {UPDATED}</p>
        <h1 className="mt-3 text-[clamp(2.2rem,5vw,3.2rem)] font-medium leading-none tracking-display">{title}</h1>
        <p className="mt-5 text-[17px] leading-relaxed text-ink-2">{intro}</p>
        <div className="legal mt-10 space-y-10 text-[15px] leading-relaxed text-ink-2 [&_h2]:text-xl [&_h2]:font-medium [&_h2]:tracking-[-0.02em] [&_h2]:text-ink [&_li]:mt-1.5 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </div>
      </motion.main>
    </div>
  );
}

function Contact() {
  return SITE.email ? (
    <p>
      Email{' '}
      <a href={`mailto:${SITE.email}`} className="font-medium text-ink underline underline-offset-4">
        {SITE.email}
      </a>
      . We reply within a few working days.
    </p>
  ) : (
    <p>Contact the {SITE.company} team through the support address shown on our website.</p>
  );
}

export function PrivacyPage() {
  const c = SITE.company;
  return (
    <LegalPage title="Privacy Policy" intro={`This policy explains what ${c} collects when you use Delegate, why, who helps us run it, and the choices you have. We keep it short and specific.`}>
      <section>
        <h2>1. Who we are</h2>
        <p>
          {c === 'Delegate' ? 'We (“Delegate”, “we”, “us”) provide' : `${c} (“we”, “us”) provides`} Delegate, a task accountability tool for teams, at this website. When a company
          creates a workspace, that company decides what goes into it; we process that information on its behalf to provide the service.
        </p>
      </section>
      <section>
        <h2>2. What we collect</h2>
        <ul>
          <li>
            <b className="text-ink">Account details:</b> your name, email address and, if you sign in with Google, your profile photo. If you sign up with a password, it is stored only as a
            secure hash by our authentication provider; we never see it.
          </li>
          <li>
            <b className="text-ink">Workspace content:</b> tasks, briefs, comments, proof of work (links, notes and files), the activity history, playbooks, departments, roles and invite codes.
          </li>
          <li>
            <b className="text-ink">Connected tools, only if your workspace switches them on:</b> Slack or Microsoft Teams channel and user identifiers, your WhatsApp number when you link it,
            GitHub pull-request and commit events, and details of Google Drive files you choose to attach (we only see files you pick).
          </li>
          <li>
            <b className="text-ink">Billing:</b> your plan, number of seats and subscription status. Card and bank details are collected by Stripe or Paystack; we never see full card numbers.
          </li>
          <li>
            <b className="text-ink">Technical data:</b> IP address and request logs, used for security and to prevent abuse, and your browser’s local storage, used to keep you signed in and
            remember your light or dark theme. We don’t use advertising or tracking cookies.
          </li>
        </ul>
      </section>
      <section>
        <h2>3. How we use it</h2>
        <ul>
          <li>To run Delegate: show boards, move tasks through their states, keep the activity history and produce reports such as Velocity and the morning brief.</li>
          <li>To send the notifications you or your workspace switch on, by email, Slack, Microsoft Teams or WhatsApp.</li>
          <li>To bill paid plans, keep the service secure, prevent abuse and answer support requests.</li>
          <li>
            AI proof checks, if your workspace has them: the task brief and the submitted proof text are sent to Anthropic to produce an advisory verdict. Under Anthropic’s commercial API
            terms, that data is not used to train its models by default.
          </li>
        </ul>
        <p>We do not sell personal data, and we do not use it for advertising.</p>
      </section>
      <section>
        <h2>4. Who helps us run Delegate</h2>
        <p>We share data only with providers that need it to deliver the service, under their own security and privacy commitments:</p>
        <ul>
          <li>Supabase: database, sign-in and file storage</li>
          <li>Vercel: hosting</li>
          <li>Google: sign-in with Google and, if you use it, the Drive file picker</li>
          <li>Stripe and Paystack: payments</li>
          <li>Resend: sending emails</li>
          <li>Slack, Microsoft, Meta (WhatsApp) and GitHub: only when your workspace connects them</li>
          <li>Anthropic: only when AI proof checks are on</li>
        </ul>
        <p>We may also disclose information if the law requires it, or to protect people’s safety or our rights.</p>
      </section>
      <section>
        <h2>5. Where data is processed</h2>
        <p>Our providers may process data outside your country. When that happens, we rely on their contractual and technical safeguards to protect it.</p>
      </section>
      <section>
        <h2>6. How long we keep it</h2>
        <p>
          We keep your data while your account or workspace is active. When a workspace owner asks us to delete a workspace, or you ask us to delete your account, we delete the data within 30
          days. The exception is records we must keep for legal or billing reasons. Backups roll over within a further 30 days.
        </p>
      </section>
      <section>
        <h2>7. Your rights</h2>
        <p>
          You can ask us to access, correct, export or delete your personal data, or object to how we use it. If your data is in a company’s workspace, we may involve that company’s owner. You
          also have the right to complain to your data protection authority, for example under Nigeria’s Data Protection Act 2023 or the EU GDPR.
        </p>
      </section>
      <section>
        <h2>8. Security</h2>
        <p>
          Connections are encrypted (HTTPS), connection secrets for third-party tools are encrypted at rest, database access is limited by row-level security, and every task change is recorded in
          an activity log that can’t be edited. No system is perfectly secure; if a breach affects you, we’ll tell you without undue delay.
        </p>
      </section>
      <section>
        <h2>9. Children</h2>
        <p>Delegate is a work tool and isn’t meant for anyone under 16.</p>
      </section>
      <section>
        <h2>10. Changes</h2>
        <p>If we change this policy, we’ll update the date at the top. If the changes are significant, we’ll also tell workspace owners.</p>
      </section>
      <section id="contact">
        <h2>11. Contact</h2>
        <Contact />
      </section>
    </LegalPage>
  );
}

export function TermsPage() {
  const c = SITE.company;
  return (
    <LegalPage title="Terms of Service" intro={`These terms are the agreement between you and ${c} for using Delegate. By creating an account or using Delegate, you accept them.`}>
      <section>
        <h2>1. Using Delegate</h2>
        <p>
          You must be at least 16 and able to enter into this agreement. If you use Delegate for a company, you confirm that you’re allowed to accept these terms for it; “you” then also means
          that company.
        </p>
      </section>
      <section>
        <h2>2. Accounts and workspaces</h2>
        <ul>
          <li>Keep your sign-in details safe. You’re responsible for what happens under your account.</li>
          <li>A workspace’s owner controls who joins, their roles and the plan, and is responsible for how the workspace is used.</li>
          <li>Give accurate information, and tell us if you think your account has been misused.</li>
        </ul>
      </section>
      <section>
        <h2>3. Your content</h2>
        <p>
          Tasks, comments, proof of work and files stay yours. You give us permission to store, process and display them only as needed to run Delegate for you, including sending them to the
          tools your workspace connects. You confirm you have the right to upload what you upload.
        </p>
      </section>
      <section>
        <h2>4. Acceptable use</h2>
        <p>Don’t use Delegate to:</p>
        <ul>
          <li>break the law, or harass, deceive or harm anyone;</li>
          <li>upload malware, or try to get around security or access limits;</li>
          <li>overload the service, scrape it, or copy it to build a competing product;</li>
          <li>send spam or unwanted messages through Slack, Teams, WhatsApp or email.</li>
        </ul>
        <p>We may remove content or suspend access that breaks these rules.</p>
      </section>
      <section>
        <h2>5. Plans, trials and payment</h2>
        <ul>
          <li>New workspaces get a 14-day trial of the Team plan. After it, the workspace keeps working on the free Starter plan unless you upgrade.</li>
          <li>The Team plan is charged per member per month through Stripe or Paystack, and renews automatically each month until it is cancelled.</li>
          <li>Prices are shown before you pay and may exclude taxes. We’ll give notice before any price change applies to you.</li>
          <li>If a payment fails, paid features may pause until it’s fixed. When you cancel, the plan stays active until the end of the period you paid for.</li>
          <li>Payments aren’t refundable for partial months, except where the law requires it.</li>
        </ul>
      </section>
      <section>
        <h2>6. Other services and AI</h2>
        <p>
          Integrations such as Google, Slack, Microsoft Teams, WhatsApp, GitHub, Stripe and Paystack are provided by those companies under their own terms. AI proof checks are advisory: people,
          not the AI, decide whether work is approved.
        </p>
      </section>
      <section>
        <h2>7. Availability and changes</h2>
        <p>
          We work to keep Delegate fast and available, but we can’t promise it will always be uninterrupted or error-free. We may improve, change or retire features; if a change significantly
          reduces what a paid plan includes, we’ll tell workspace owners in advance.
        </p>
      </section>
      <section>
        <h2>8. Ending the agreement</h2>
        <p>
          You can stop using Delegate at any time. We may suspend or end access if these terms are seriously or repeatedly broken, or if the law requires it. If a workspace is closed, its owner
          can ask us for an export within 30 days.
        </p>
      </section>
      <section>
        <h2>9. Disclaimers and liability</h2>
        <p>
          Delegate is provided “as is”. To the extent the law allows, we disclaim implied warranties, and we aren’t liable for indirect or consequential losses such as lost profits or data. Our
          total liability for any claim is limited to the amount you paid us in the 12 months before the claim. Nothing here limits liability that can’t legally be limited.
        </p>
      </section>
      <section>
        <h2>10. Changes to these terms</h2>
        <p>If we update these terms, we’ll change the date at the top and tell workspace owners about significant changes. Continuing to use Delegate means you accept the new terms.</p>
      </section>
      <section>
        <h2>11. Governing law</h2>
        <p>These terms are governed by the laws of {SITE.country}. Disputes go to the courts there, unless the law where you live gives you other rights.</p>
      </section>
      <section>
        <h2>12. Contact</h2>
        <Contact />
      </section>
    </LegalPage>
  );
}
