import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BellRing,
  Check,
  FileCheck2,
  Gauge,
  Lock,
  Menu,
  Newspaper,
  X,
} from 'lucide-react';
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useTransform, type MotionValue } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Button, cx, EASE, Logo, Pill } from '../components/ui';
import { BoardPreview } from './BoardPreview';
import { CupStage, useHowStep } from './CupStage';

/* One reveal, used everywhere: the cup is the hero motion, content just settles in. */
function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.9, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

const NAV = [
  { href: '#product', label: 'Product' },
  { href: '#how', label: 'How it works' },
  { href: '#pricing', label: 'Pricing' },
];

function Nav() {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useMotionValueEvent(scrollY, 'change', (y) => setScrolled(y > 24));

  return (
    <header className={cx('fixed inset-x-0 top-0 z-50 transition-[background,border,backdrop-filter] duration-500', scrolled ? 'border-b border-line/70 bg-milk/75 backdrop-blur-xl' : 'border-b border-transparent')}>
      <nav className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-4 sm:px-6 lg:px-8" aria-label="Main">
        <Link to="/" aria-label="Delegate home">
          <Logo />
        </Link>
        <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 md:flex">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="text-[15px] text-ink-2 transition-colors hover:text-ink">
              {n.label}
            </a>
          ))}
        </div>
        <div className="hidden items-center gap-2 md:flex">
          <Link to="/login">
            <Button variant="outline" size="sm" className="h-8 border-ink/60">
              Log in
            </Button>
          </Link>
          <Link to="/login?intent=signup">
            <Button size="sm" className="h-8">
              Get started
            </Button>
          </Link>
        </div>
        <button className="grid size-10 place-items-center rounded-full md:hidden" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}>
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </nav>
      <AnimatePresence>
        {open && (
          <motion.div
            className="border-t border-line bg-milk px-4 pb-6 pt-2 md:hidden"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            {NAV.map((n) => (
              <a key={n.href} href={n.href} onClick={() => setOpen(false)} className="block border-b border-line py-3.5 text-lg tracking-[-0.02em]">
                {n.label}
              </a>
            ))}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Link to="/login">
                <Button variant="outline" className="w-full">
                  Log in
                </Button>
              </Link>
              <Link to="/login?intent=signup">
                <Button className="w-full">Get started</Button>
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

function Hero() {
  const { scrollY } = useScroll();
  const fade = useTransform(scrollY, [0, 420], [1, 0]);
  const lift = useTransform(scrollY, [0, 420], [0, -40]);
  return (
    <section id="top" className="relative h-[100svh] min-h-[640px]">
      <motion.div style={{ opacity: fade, y: lift }} className="relative px-4 pt-[17vh] text-center sm:pt-[15vh]">
        <motion.h1
          className="mx-auto max-w-5xl text-[clamp(2.6rem,6.6vw,5.9rem)] font-medium leading-[0.95] tracking-display"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: EASE }}
        >
          <span className="block text-[#6d6d66]">The high-tempo execution</span>
          <span className="block">engine for lean teams</span>
        </motion.h1>
        <motion.div
          className="mt-6 flex flex-wrap justify-center gap-2"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: EASE, delay: 0.15 }}
        >
          <Pill>Real-time accountability</Pill>
          <Pill>Proof of work</Pill>
          <Pill className="hidden sm:inline-flex">Standup on autopilot</Pill>
        </motion.div>
      </motion.div>

      {/* Corner captions, editorial-style (desktop) */}
      <motion.div
        style={{ opacity: fade }}
        className="absolute bottom-10 left-8 hidden max-w-[260px] lg:block"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8, duration: 1 }}
      >
        <p className="text-[15px] leading-snug text-ink-2">Assign at 8 AM. Watch every task move from red to green. Audit with proof — no chasing.</p>
        <Link to="/login?intent=signup" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline">
          Start free <ArrowRight className="size-4" />
        </Link>
      </motion.div>
      <motion.div style={{ opacity: fade }} className="absolute bottom-10 right-8 hidden text-right lg:block" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1, duration: 1 }}>
        <p className="text-xs uppercase tracking-[0.18em] text-faint">Scroll</p>
        <motion.div className="ml-auto mt-2 h-10 w-px bg-ink/30" animate={{ scaleY: [0.3, 1, 0.3], originY: 0 }} transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }} />
      </motion.div>
    </section>
  );
}

const STEPS = [
  { color: 'bg-s-open', title: 'Open', body: 'Assign it at 8 AM. It lands red on their board — and on the team heartbeat everyone can see.' },
  { color: 'bg-s-active', title: 'In motion', body: 'They start, or flag a blocker. The teammate they are waiting on gets pinged, not you.' },
  { color: 'bg-s-done', title: 'Executed', body: 'They attach proof — a link, a file, a note. AI checks it against the brief before it turns green.' },
  { color: 'bg-s-approved', title: 'Audited ✓', body: 'You review in one click. Approved work turns blue and is sealed into an immutable ledger.' },
];

function HowItWorks({ step, progress }: { step: number; progress: MotionValue<number> }) {
  const active = Math.max(0, step - 1);
  const bar = useTransform(progress, [0, 1], ['0%', '100%']);
  return (
    <section id="how" className="relative h-[420vh]" aria-label="How it works">
      <div className="sticky top-0 flex h-[100svh] items-start pt-24 md:items-center md:pt-0">
        <div className="mx-auto w-full max-w-[1400px] px-5 sm:px-8 lg:px-16">
          <div className="max-w-[520px]">
            <Reveal>
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-faint">How it works</p>
              <h2 className="mt-3 text-[clamp(2rem,4.2vw,3.6rem)] font-medium leading-[1] tracking-display">
                <span className="text-[#6d6d66]">One ticket. Four colours.</span> Zero chasing.
              </h2>
            </Reveal>
            <div className="relative mt-8 md:mt-10">
              <div className="absolute bottom-2 left-[5px] top-2 w-px bg-line-2" />
              <motion.div className="absolute left-[5px] top-2 w-px bg-ink" style={{ height: bar }} />
              <ol className="space-y-4 md:space-y-6">
                {STEPS.map((s, i) => (
                  <li key={s.title} className={cx('relative pl-8 transition-opacity duration-500', i === active ? 'opacity-100' : 'opacity-35', i !== active && 'hidden md:block')} data-active={i === active}>
                    <span className={cx('absolute left-0 top-1.5 size-[11px] rounded-full ring-4 ring-milk transition-transform duration-500', s.color, i === active && 'scale-125')} />
                    <p className="text-lg font-medium tracking-[-0.02em]">
                      <span className="mr-2 font-normal text-faint">0{i + 1}</span>
                      {s.title}
                    </p>
                    <p className="mt-1 max-w-[440px] text-[15px] leading-relaxed text-mute">{s.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  { icon: Activity, title: 'Heartbeat feed', body: 'One global, live rhythm of who started, shipped and got blocked — filterable by person or department.' },
  { icon: FileCheck2, title: 'Proof of work + AI check', body: 'Green requires evidence. AI reads the proof against the brief and flags anything that needs a human look.' },
  { icon: Gauge, title: 'Velocity Pulse', body: 'Time-to-impact for every operator: how fast work moves from red to green, and how often it lands on time.' },
  { icon: Newspaper, title: 'Standup-in-a-Box', body: 'Yesterday’s shipped work, today’s new tickets and every blocker, compiled into a one-page brief at 8:00 AM.' },
  { icon: BellRing, title: 'Blocker Ping', body: 'Flag what you are waiting on and who owns it. The bottleneck sees a gentle, visible nudge — not a meeting.' },
  { icon: Lock, title: 'Immutable ledger', body: 'Every assignment, submission and audit is written to an append-only log. No disputes about who did what, when.' },
];

function Features() {
  return (
    <section id="product" className="relative py-28 md:py-40">
      <div className="mx-auto grid max-w-[1400px] px-5 sm:px-8 lg:grid-cols-[1fr_1.35fr] lg:px-16">
        <div className="hidden lg:block" />
        <div>
          <Reveal>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-faint">Product</p>
            <h2 className="mt-3 max-w-2xl text-[clamp(2rem,4.2vw,3.6rem)] font-medium leading-[1] tracking-display">
              <span className="text-[#6d6d66]">Everything a lean team needs.</span> Nothing it doesn’t.
            </h2>
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-mute">
              Not another Jira. Delegate trades bureaucratic clutter for one clear signal: is the work moving, and can you prove it?
            </p>
          </Reveal>
          <div className="mt-12 grid gap-3 sm:grid-cols-2">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={(i % 2) * 0.08}>
                <div className="group h-full rounded-3xl border border-line bg-paper/90 p-6 shadow-[var(--shadow-card)] backdrop-blur transition-[transform,box-shadow] duration-500 hover:-translate-y-1 hover:shadow-[var(--shadow-float)]">
                  <span className="grid size-10 place-items-center rounded-full border border-line bg-milk transition-colors duration-500 group-hover:bg-ink group-hover:text-milk">
                    <f.icon className="size-[18px]" strokeWidth={1.8} />
                  </span>
                  <h3 className="mt-5 text-lg font-medium tracking-[-0.02em]">{f.title}</h3>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-mute">{f.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Preview() {
  return (
    <section id="preview" className="relative py-28 md:py-36">
      <div className="mx-auto max-w-[1100px] px-4 sm:px-8">
        <Reveal className="text-center">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-faint">The board</p>
          <h2 className="mx-auto mt-3 max-w-4xl text-[clamp(2rem,4.2vw,3.6rem)] font-medium leading-[1] tracking-display">
            <span className="text-[#6d6d66]">Your whole operation,</span> in one calm view.
          </h2>
        </Reveal>
        <Reveal delay={0.1} className="mt-12">
          <BoardPreview />
        </Reveal>
        <div className="mt-10 grid gap-3 text-center sm:grid-cols-3">
          {[
            ['08:00', 'Tickets assigned, standup brief delivered'],
            ['Live', 'Heartbeat feed across every department'],
            ['18:00', 'Work audited, ledger sealed for the day'],
          ].map(([big, small], i) => (
            <Reveal key={big} delay={i * 0.08}>
              <p className="text-3xl font-medium tracking-display">{big}</p>
              <p className="mt-1 text-sm text-mute">{small}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

const PLANS = [
  {
    name: 'Starter',
    price: '$0',
    cadence: 'up to 5 people',
    body: 'For founders and small crews getting their rhythm.',
    features: ['Live board + heartbeat feed', 'Proof of work on every task', 'Blocker Ping', '7-day velocity'],
    cta: 'Start free',
    featured: false,
  },
  {
    name: 'Team',
    price: '$8',
    cadence: 'per member / month',
    body: 'For operating teams that run on daily accountability.',
    features: ['Everything in Starter', 'AI proof verification', 'Standup-in-a-Box at 8:00 AM', 'Velocity Pulse leaderboard', 'Departments & swimlanes'],
    cta: 'Start 14-day trial',
    featured: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    cadence: 'annual agreement',
    body: 'For organisations with compliance and scale needs.',
    features: ['SSO / SAML', 'Ledger export & retention controls', 'Dedicated success manager', '99.9% uptime SLA'],
    cta: 'Talk to sales',
    featured: false,
  },
];

function Pricing() {
  return (
    <section id="pricing" className="relative py-28 md:py-36">
      <div className="mx-auto max-w-[1100px] px-4 sm:px-8">
        <Reveal className="text-center">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-faint">Pricing</p>
          <h2 className="mx-auto mt-3 max-w-3xl text-[clamp(2rem,4.2vw,3.6rem)] font-medium leading-[1] tracking-display">
            <span className="text-[#6d6d66]">Simple pricing</span> that scales with your team.
          </h2>
        </Reveal>
        <div className="mt-14 grid gap-3 md:grid-cols-3">
          {PLANS.map((p, i) => (
            <Reveal key={p.name} delay={i * 0.08} className="h-full">
              <div className={cx('flex h-full flex-col rounded-3xl border p-7', p.featured ? 'border-ink bg-ink text-milk shadow-[var(--shadow-float)]' : 'border-line bg-paper shadow-[var(--shadow-card)]')}>
                <div className="flex items-center justify-between">
                  <p className="text-lg font-medium tracking-[-0.02em]">{p.name}</p>
                  {p.featured && <span className="rounded-full border border-milk/30 px-2.5 py-0.5 text-xs">Most popular</span>}
                </div>
                <p className="mt-6 text-5xl font-medium tracking-display">{p.price}</p>
                <p className={cx('mt-1 text-sm', p.featured ? 'text-milk/60' : 'text-faint')}>{p.cadence}</p>
                <p className={cx('mt-5 text-[15px] leading-relaxed', p.featured ? 'text-milk/80' : 'text-mute')}>{p.body}</p>
                <ul className="mt-6 space-y-2.5 text-[15px]">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <Check className={cx('mt-0.5 size-4 shrink-0', p.featured ? 'text-milk' : 'text-ink')} strokeWidth={2.2} />
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-8">
                  {p.name === 'Enterprise' ? (
                    <a href="mailto:sales@delegate.app?subject=Delegate%20Enterprise">
                      <Button variant="outline" className="w-full">
                        {p.cta}
                      </Button>
                    </a>
                  ) : (
                    <Link to="/login?intent=signup">
                      <Button variant={p.featured ? 'soft' : 'primary'} className="w-full">
                        {p.cta}
                      </Button>
                    </Link>
                  )}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section id="start" className="relative h-[100svh] min-h-[680px]">
      <div className="px-4 pt-[16vh] text-center">
        <Reveal>
          <h2 className="text-[clamp(2.6rem,6.6vw,5.9rem)] font-medium leading-[0.95] tracking-display">
            <span className="block text-[#6d6d66]">Hand it off.</span>
            <span className="block">See it done.</span>
          </h2>
        </Reveal>
        <Reveal delay={0.1} className="mt-7 flex flex-wrap justify-center gap-2">
          <Link to="/login?intent=signup">
            <Button size="lg">
              Get started free <ArrowUpRight className="size-4" />
            </Button>
          </Link>
          <a href="mailto:sales@delegate.app?subject=Delegate%20demo">
            <Button size="lg" variant="outline">
              Book a demo
            </Button>
          </a>
        </Reveal>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="relative z-10 border-t border-line bg-milk">
      <div className="mx-auto grid max-w-[1400px] gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.5fr_1fr_1fr_1fr] lg:px-16">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-mute">The high-tempo execution engine for lean teams.</p>
        </div>
        {[
          ['Product', [['Board', '#preview'], ['How it works', '#how'], ['Pricing', '#pricing']]],
          ['Company', [['Contact', 'mailto:hello@delegate.app'], ['Sales', 'mailto:sales@delegate.app']]],
          ['Account', [['Log in', '/login'], ['Get started', '/login?intent=signup']]],
        ].map(([title, links]) => (
          <div key={title as string}>
            <p className="text-sm font-medium">{title as string}</p>
            <ul className="mt-3 space-y-2 text-sm text-mute">
              {(links as string[][]).map(([label, href]) => (
                <li key={label}>
                  {href!.startsWith('/') ? (
                    <Link to={href!} className="hover:text-ink">
                      {label}
                    </Link>
                  ) : (
                    <a href={href} className="hover:text-ink">
                      {label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-6 text-xs text-faint sm:px-8 lg:px-16">
        <span>© {new Date().getFullYear()} Delegate. All rights reserved.</span>
        <span>Made for teams that deliver.</span>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  const { step, progress } = useHowStep();

  useEffect(() => {
    document.title = 'Delegate — The high-tempo execution engine for lean teams';
  }, []);

  return (
    <div className="relative">
      {/* Studio backdrop: milk centre, halftone dots towards the edges */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-milk" aria-hidden>
        <div className="dot-grid absolute inset-0 [mask-image:radial-gradient(ellipse_70%_65%_at_50%_45%,transparent_35%,black_100%)]" />
      </div>
      <CupStage step={step} />
      <Nav />
      <main className="relative z-10">
        <Hero />
        <HowItWorks step={step} progress={progress} />
        <Features />
        <Preview />
        <Pricing />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
