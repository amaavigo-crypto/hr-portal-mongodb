import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  BellRing,
  Building2,
  Check,
  ChevronDown,
  Eye,
  FileClock,
  KeyRound,
  Layers3,
  Lock,
  MessageSquare,
  ScrollText,
  ShieldCheck,
  UserCheck,
  Workflow,
  Zap,
  IndianRupee,
} from 'lucide-react';
import { useFaqs, useModule, useModules, useStats } from './data';
import { Rich, useT } from './content';
import { CountUp, Link, Reveal, spotlight, useRotation } from './hooks';
import { CtaBand, PageHero, SectionHead, goToLogin } from './Layout';
import {
  AuditTimeline,
  AutomationFlow,
  ChatDemo,
  FlagsDemo,
  HeroScene,
  IsolationDiagram,
  ModuleVisual,
  OrbitHub,
  PermissionChips,
} from './visuals';
import type { ModuleKey } from './routes';

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

const Faq: React.FC = () => {
  const FAQS = useFaqs();
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="lp-faq">
      {FAQS.map((f, i) => (
        <Reveal key={f.q} delay={i * 60} className={`lp-faq-item ${open === i ? 'is-open' : ''}`}>
          <button type="button" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
            <span>{f.q}</span>
            <ChevronDown size={18} />
          </button>
          <div className="lp-faq-body"><div><p>{f.a}</p></div></div>
        </Reveal>
      ))}
    </div>
  );
};

const Steps: React.FC<{ steps: { title: string; text: string }[] }> = ({ steps }) => (
  <div className="lp-steps">
    <div className="lp-steps-line"><i /></div>
    {steps.map((s, i) => (
      <Reveal key={i} delay={i * 140} className="lp-step">
        <span className="lp-step-num">{String(i + 1).padStart(2, '0')}</span>
        <h3>{s.title}</h3>
        <p>{s.text}</p>
      </Reveal>
    ))}
  </div>
);

const Rotor: React.FC = () => {
  const t = useT();
  const words = t('home.hero.rotor').split(',').map((w) => w.trim()).filter(Boolean);
  const list = words.length ? words : ['hiring'];
  const [i] = useRotation(list.length, 2200, false, 'rotor');
  const word = list[i % list.length];
  return <span className="lp-rotor"><span key={word} className="lp-rotor-word">{word}</span></span>;
};

/** The home headline: `{rotor}` in the text is where the rotating word goes. */
const HeroTitle: React.FC = () => {
  const t = useT();
  const parts = t('home.hero.title').split('{rotor}');
  return (
    <h1>
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && <Rotor />}
          <Rich text={part} />
        </React.Fragment>
      ))}
    </h1>
  );
};

const Marquee: React.FC = () => {
  const t = useT();
  const MODULES = useModules();
  const MARQUEE_A = MODULES.map((m) => ({ icon: m.icon, label: m.name }));
  const MARQUEE_B = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => t(`home.marquee.${i}`));
  return (
  <section className="lp-marquee" aria-label="What the platform covers">
    <div className="lp-marquee-row">
      <div className="lp-marquee-track">
        {[...MARQUEE_A, ...MARQUEE_A, ...MARQUEE_A].map((m, i) => {
          const Icon = m.icon;
          return <span key={i} className="lp-pill"><Icon size={15} /> {m.label}</span>;
        })}
      </div>
    </div>
    <div className="lp-marquee-row is-reverse">
      <div className="lp-marquee-track">
        {[...MARQUEE_B, ...MARQUEE_B, ...MARQUEE_B].map((m, i) => <span key={i} className="lp-pill is-soft"><Check size={14} /> {m}</span>)}
      </div>
    </div>
  </section>
  );
};

const WHY_ICONS = [Layers3, Zap, Building2, IndianRupee];

/* ------------------------------------------------------------------ */
/* Home                                                                */
/* ------------------------------------------------------------------ */

const ModuleShowcase: React.FC = () => {
  const t = useT();
  const MODULES = useModules();
  const [hover, setHover] = useState(false);
  const [active, setActive] = useRotation(MODULES.length, 6000, hover, 'showcase');
  const m = MODULES[active];
  const Icon = m.icon;
  return (
    <div className="lp-showcase" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="lp-showcase-tabs" role="tablist" aria-label="Modules">
        {MODULES.map((item, i) => {
          const TabIcon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={i === active}
              className={`lp-stab ${i === active ? 'is-active' : ''} ${hover ? 'is-paused' : ''}`}
              onClick={() => setActive(i)}
            >
              <span className={`lp-iconbadge tone-${item.tone}`}><TabIcon size={16} /></span>
              <span>{item.name}</span>
              <i className="lp-stab-progress" />
            </button>
          );
        })}
      </div>
      <div className="lp-showcase-panel" key={m.key}>
        <div className="lp-showcase-copy">
          <span className={`lp-iconbadge is-large tone-${m.tone}`}><Icon size={22} /></span>
          <h3>{m.name}</h3>
          <p>{m.tagline}</p>
          <ul>
            {m.points.map((p) => <li key={p}><span><Check size={12} /></span>{p}</li>)}
          </ul>
          <Link to={`/modules/${m.key}`} className="lp-textlink">{t('home.modules.explore', { name: m.name.toLowerCase() })} <ArrowRight size={15} /></Link>
        </div>
        <div className="lp-showcase-visual"><ModuleVisual k={m.key} /></div>
      </div>
    </div>
  );
};

export const HomePage: React.FC = () => {
  const t = useT();
  const r = (key: string) => <Rich text={t(key)} />;
  const STATS = useStats();
  return (
  <>
    <section className="lp-hero">
      <div className="lp-grid-bg" aria-hidden="true" />
      <div className="lp-hero-inner">
        <div className="lp-hero-copy">
          <div className="lp-eyebrow"><span className="lp-dot" /> {t('home.hero.eyebrow')}</div>
          <HeroTitle />
          <p className="lp-lede">
            {t('home.hero.text')}
          </p>
          <div className="lp-hero-actions">
            <button type="button" className="lp-btn lp-btn-primary" onClick={goToLogin}>{t('home.hero.primary')} <ArrowRight size={17} /></button>
            <Link to="/modules" className="lp-btn lp-btn-outline">{t('home.hero.secondary')}</Link>
          </div>
          <div className="lp-proof">
            <span><Check size={14} /> {t('home.hero.proof1')}</span>
            <span><Check size={14} /> {t('home.hero.proof2')}</span>
            <span><Check size={14} /> {t('home.hero.proof3')}</span>
          </div>
        </div>
        <HeroScene />
      </div>
    </section>

    <Marquee />

    <section className="lp-stats">
      <div className="lp-stats-inner">
        {STATS.map((s, i) => (
          <Reveal key={i} delay={i * 100} className="lp-stat">
            <strong><CountUp value={s.value} suffix={s.suffix} /></strong>
            <span>{s.label}</span>
          </Reveal>
        ))}
      </div>
    </section>

    <section className="lp-section">
      <SectionHead kicker={t('home.why.kicker')} title={r('home.why.title')} text={t('home.why.text')} />
      <div className="lp-why">
        {WHY_ICONS.map((Icon, i) => (
          <Reveal key={i} delay={i * 90} className="lp-card lp-spot" {...spotlight}>
            <span className="lp-iconbadge is-large tone-violet"><Icon size={20} /></span>
            <h3>{t(`home.why.${i + 1}.title`)}</h3>
            <p>{t(`home.why.${i + 1}.text`)}</p>
          </Reveal>
        ))}
      </div>
    </section>

    <section className="lp-section lp-section-tint">
      <SectionHead kicker={t('home.modules.kicker')} title={r('home.modules.title')} text={t('home.modules.text')} />
      <Reveal variant="zoom"><ModuleShowcase /></Reveal>
    </section>

    <section className="lp-dark">
      <div className="lp-dark-glow" aria-hidden="true" />
      <div className="lp-dark-inner">
        <SectionHead light kicker={t('home.auto.kicker')} title={r('home.auto.title')} text={t('home.auto.text')} />
        <Reveal variant="zoom"><AutomationFlow /></Reveal>
        <Reveal className="lp-dark-links">
          <Link to="/smart-features" className="lp-btn lp-btn-white">{t('home.auto.primary')} <ArrowRight size={16} /></Link>
          <Link to="/modules/hiring" className="lp-btn lp-btn-outline-light">{t('home.auto.secondary')}</Link>
        </Reveal>
      </div>
    </section>

    <section className="lp-section">
      <SectionHead kicker={t('home.smart.kicker')} title={r('home.smart.title')} text={t('home.smart.text')} />
      <div className="lp-two">
        <Reveal variant="left"><ChatDemo /></Reveal>
        <Reveal variant="right"><FlagsDemo /></Reveal>
      </div>
      <Reveal className="lp-center-link"><Link to="/smart-features" className="lp-textlink">{t('home.smart.link')} <ArrowRight size={15} /></Link></Reveal>
    </section>

    <section className="lp-section lp-section-tint">
      <div className="lp-split-section">
        <div>
          <SectionHead kicker={t('home.security.kicker')} title={r('home.security.title')} text={t('home.security.text')} />
          <Reveal><Link to="/security" className="lp-textlink">{t('home.security.link')} <ArrowRight size={15} /></Link></Reveal>
        </div>
        <Reveal variant="right"><IsolationDiagram /></Reveal>
      </div>
    </section>

    <section className="lp-section">
      <SectionHead kicker={t('home.how.kicker')} title={r('home.how.title')} center />
      <Steps steps={[1, 2, 3, 4].map((i) => ({ title: t(`home.how.${i}.title`), text: t(`home.how.${i}.text`) }))} />
    </section>

    <section className="lp-section lp-section-tint">
      <SectionHead kicker={t('home.faq.kicker')} title={r('home.faq.title')} center />
      <Faq />
    </section>

    <CtaBand />
  </>
  );
};

/* ------------------------------------------------------------------ */
/* Modules index                                                       */
/* ------------------------------------------------------------------ */

export const ModulesPage: React.FC = () => {
  const t = useT();
  const r = (key: string) => <Rich text={t(key)} />;
  const MODULES = useModules();
  const TOGETHER_ICONS = [UserCheck, Workflow, KeyRound];
  return (
  <>
    <PageHero
      kicker={t('modules.hero.kicker')}
      title={r('modules.hero.title')}
      text={t('modules.hero.text')}
      visual={<OrbitHub />}
      actions={<div className="lp-hero-actions"><button type="button" className="lp-btn lp-btn-primary" onClick={goToLogin}>{t('modules.hero.primary')} <ArrowRight size={17} /></button></div>}
    />
    <section className="lp-section">
      <div className="lp-modgrid">
        {MODULES.map((m, i) => {
          const Icon = m.icon;
          return (
            <Reveal key={m.key} delay={(i % 3) * 90} className={`lp-card lp-spot lp-modcard tone-${m.tone}`} {...spotlight}>
              <Link to={`/modules/${m.key}`} className="lp-modcard-link" aria-label={m.name}>
                <span className={`lp-iconbadge is-large tone-${m.tone}`}><Icon size={20} /></span>
                <h3>{m.name}</h3>
                <p>{m.tagline}</p>
                <ul>{m.points.slice(0, 3).map((p) => <li key={p}><Check size={13} />{p}</li>)}</ul>
                <span className="lp-textlink">{t('modules.card.link')} <ArrowRight size={15} /></span>
              </Link>
            </Reveal>
          );
        })}
      </div>
    </section>
    <section className="lp-section lp-section-tint">
      <SectionHead kicker={t('modules.together.kicker')} title={r('modules.together.title')} center />
      <div className="lp-why is-three">
        {TOGETHER_ICONS.map((Icon, i) => (
          <Reveal key={i} delay={i * 100} className="lp-card lp-spot" {...spotlight}>
            <span className="lp-iconbadge is-large tone-violet"><Icon size={20} /></span>
            <h3>{t(`modules.together.${i + 1}.title`)}</h3>
            <p>{t(`modules.together.${i + 1}.text`)}</p>
          </Reveal>
        ))}
      </div>
    </section>
    <CtaBand />
  </>
  );
};

/* ------------------------------------------------------------------ */
/* Module detail                                                       */
/* ------------------------------------------------------------------ */

export const ModuleDetailPage: React.FC<{ k: ModuleKey }> = ({ k }) => {
  const t = useT();
  const r = (key: string, vars?: Record<string, string>) => <Rich text={t(key, vars)} />;
  const MODULES = useModules();
  const m = useModule(k);
  const Icon = m.icon;
  const others = MODULES.filter((x) => x.key !== m.key);
  const lower = m.name.toLowerCase();
  return (
    <>
      <PageHero
        crumbs={[{ label: t('tpl.mod.crumb.home'), to: '/' }, { label: t('tpl.mod.crumb.modules'), to: '/modules' }, { label: m.name }]}
        kicker={m.name.toUpperCase()}
        title={<Rich text={m.headline} />}
        text={m.intro}
        visual={<div className="lp-hero-visual-wrap"><div className="lp-hero-visual-glow" /><ModuleVisual k={m.key} /></div>}
        actions={
          <div className="lp-hero-actions">
            <button type="button" className="lp-btn lp-btn-primary" onClick={goToLogin}>{t('tpl.mod.hero.primary')} <ArrowRight size={17} /></button>
            <Link to="/modules" className="lp-btn lp-btn-outline">{t('tpl.mod.hero.secondary')}</Link>
          </div>
        }
      />
      <section className="lp-section">
        <SectionHead kicker={t('tpl.mod.get.kicker')} title={r('tpl.mod.get.title', { name: lower })} />
        <div className="lp-why is-two">
          {m.highlights.map((h, i) => {
            const HIcon = h.icon;
            return (
              <Reveal key={i} delay={(i % 2) * 100} className="lp-card lp-spot" {...spotlight}>
                <span className={`lp-iconbadge is-large tone-${m.tone}`}><HIcon size={20} /></span>
                <h3>{h.title}</h3>
                <p>{h.text}</p>
              </Reveal>
            );
          })}
        </div>
      </section>
      <section className="lp-section lp-section-tint">
        <SectionHead kicker={t('tpl.mod.flow.kicker')} title={r('tpl.mod.flow.title')} center />
        <Steps steps={m.steps} />
      </section>
      <section className="lp-section">
        <div className="lp-split-section">
          <div>
            <SectionHead kicker={t('tpl.mod.inside.kicker')} title={r('tpl.mod.inside.title', { name: lower })} />
            <ul className="lp-checklist">
              {m.points.map((p, i) => (
                <Reveal as="li" key={i} delay={i * 90} variant="left"><span><Check size={13} /></span>{p}</Reveal>
              ))}
            </ul>
          </div>
          <Reveal variant="zoom" className={`lp-feature-card tone-${m.tone}`}>
            <span className={`lp-iconbadge is-large tone-${m.tone}`}><Icon size={22} /></span>
            <h3>{m.name}</h3>
            <p>{m.tagline}</p>
            <button type="button" className="lp-btn lp-btn-primary" onClick={goToLogin}>{t('tpl.mod.inside.button')} <ArrowRight size={16} /></button>
          </Reveal>
        </div>
      </section>
      <section className="lp-section lp-section-tint">
        <SectionHead kicker={t('tpl.mod.with.kicker')} title={r('tpl.mod.with.title')} center />
        <div className="lp-related">
          {others.map((o, i) => {
            const OIcon = o.icon;
            return (
              <Reveal key={o.key} delay={i * 60} variant="zoom">
                <Link to={`/modules/${o.key}`} className="lp-related-item">
                  <span className={`lp-iconbadge tone-${o.tone}`}><OIcon size={17} /></span>
                  <span><b>{o.name}</b><small>{o.short}</small></span>
                  <ArrowRight size={15} />
                </Link>
              </Reveal>
            );
          })}
        </div>
      </section>
      <CtaBand />
    </>
  );
};

/* ------------------------------------------------------------------ */
/* Smart features                                                      */
/* ------------------------------------------------------------------ */

export const SmartFeaturesPage: React.FC = () => {
  const t = useT();
  const r = (key: string) => <Rich text={t(key)} />;
  const HIRING_ICONS = [Workflow, Zap, Eye];
  const RULES_ICONS = [UserCheck, Lock, FileClock];
  return (
  <>
    <PageHero
      kicker={t('smart.hero.kicker')}
      title={r('smart.hero.title')}
      text={t('smart.hero.text')}
      visual={<div className="lp-hero-visual-wrap"><div className="lp-hero-visual-glow" /><ChatDemo /></div>}
    />

    <section className="lp-section">
      <div className="lp-split-section is-top">
        <Reveal variant="left">
          <div className="lp-kicker"><MessageSquare size={14} /> {t('smart.ask.kicker')}</div>
          <h2 className="lp-h2">{t('smart.ask.title')}</h2>
          <p className="lp-p">{t('smart.ask.text')}</p>
          <ul className="lp-checklist">
            {[1, 2, 3].map((i) => <li key={i}><span><Check size={13} /></span>{t(`smart.ask.point.${i}`)}</li>)}
          </ul>
        </Reveal>
        <Reveal variant="right"><ChatDemo /></Reveal>
      </div>
    </section>

    <section className="lp-dark">
      <div className="lp-dark-glow" aria-hidden="true" />
      <div className="lp-dark-inner">
        <SectionHead light kicker={t('smart.hiring.kicker')} title={r('smart.hiring.title')} text={t('smart.hiring.text')} />
        <Reveal variant="zoom"><AutomationFlow /></Reveal>
        <div className="lp-why is-three is-dark">
          {HIRING_ICONS.map((Icon, i) => (
            <Reveal key={i} delay={i * 100} className="lp-card lp-spot" {...spotlight}>
              <span className="lp-iconbadge is-large tone-violet"><Icon size={20} /></span>
              <h3>{t(`smart.hiring.${i + 1}.title`)}</h3>
              <p>{t(`smart.hiring.${i + 1}.text`)}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>

    <section className="lp-section">
      <div className="lp-split-section is-top is-flip">
        <Reveal variant="left"><FlagsDemo /></Reveal>
        <Reveal variant="right">
          <div className="lp-kicker"><BellRing size={14} /> {t('smart.flags.kicker')}</div>
          <h2 className="lp-h2">{t('smart.flags.title')}</h2>
          <p className="lp-p">{t('smart.flags.text')}</p>
          <ul className="lp-checklist">
            {[1, 2, 3].map((i) => <li key={i}><span><Check size={13} /></span>{t(`smart.flags.point.${i}`)}</li>)}
          </ul>
        </Reveal>
      </div>
    </section>

    <section className="lp-section lp-section-tint">
      <SectionHead kicker={t('smart.rules.kicker')} title={r('smart.rules.title')} center />
      <div className="lp-why is-three">
        {RULES_ICONS.map((Icon, i) => (
          <Reveal key={i} delay={i * 100} className="lp-card lp-spot" {...spotlight}>
            <span className="lp-iconbadge is-large tone-violet"><Icon size={20} /></span>
            <h3>{t(`smart.rules.${i + 1}.title`)}</h3>
            <p>{t(`smart.rules.${i + 1}.text`)}</p>
          </Reveal>
        ))}
      </div>
    </section>
    <CtaBand />
  </>
  );
};

/* ------------------------------------------------------------------ */
/* Security                                                            */
/* ------------------------------------------------------------------ */

const ShieldArt: React.FC = () => (
  <div className="lp-shield" aria-hidden="true">
    <div className="lp-shield-ring lp-shield-ring-1" />
    <div className="lp-shield-ring lp-shield-ring-2" />
    <div className="lp-shield-ring lp-shield-ring-3" />
    <div className="lp-shield-core"><ShieldCheck size={54} strokeWidth={1.4} /></div>
    <span className="lp-shield-dot lp-sd-1"><Lock size={14} /></span>
    <span className="lp-shield-dot lp-sd-2"><KeyRound size={14} /></span>
    <span className="lp-shield-dot lp-sd-3"><ScrollText size={14} /></span>
  </div>
);

export const SecurityPage: React.FC = () => {
  const t = useT();
  const r = (key: string) => <Rich text={t(key)} />;
  const MORE_ICONS = [Lock, Eye, UserCheck, ShieldCheck];
  return (
  <>
    <PageHero
      kicker={t('sec.hero.kicker')}
      title={r('sec.hero.title')}
      text={t('sec.hero.text')}
      visual={<ShieldArt />}
    />

    <section className="lp-section">
      <div className="lp-split-section">
        <Reveal variant="left">
          <div className="lp-kicker"><Building2 size={14} /> {t('sec.companies.kicker')}</div>
          <h2 className="lp-h2">{t('sec.companies.title')}</h2>
          <p className="lp-p">{t('sec.companies.text')}</p>
        </Reveal>
        <Reveal variant="right"><IsolationDiagram /></Reveal>
      </div>
    </section>

    <section className="lp-section lp-section-tint">
      <div className="lp-split-section is-flip">
        <Reveal variant="left">
          <PermissionChips />
        </Reveal>
        <Reveal variant="right">
          <div className="lp-kicker"><KeyRound size={14} /> {t('sec.roles.kicker')}</div>
          <h2 className="lp-h2">{t('sec.roles.title')}</h2>
          <p className="lp-p">{t('sec.roles.text')}</p>
        </Reveal>
      </div>
    </section>

    <section className="lp-section">
      <div className="lp-split-section is-top">
        <Reveal variant="left">
          <div className="lp-kicker"><FileClock size={14} /> {t('sec.record.kicker')}</div>
          <h2 className="lp-h2">{t('sec.record.title')}</h2>
          <p className="lp-p">{t('sec.record.text')}</p>
        </Reveal>
        <Reveal variant="right"><AuditTimeline /></Reveal>
      </div>
    </section>

    <section className="lp-section lp-section-tint">
      <SectionHead kicker={t('sec.more.kicker')} title={r('sec.more.title')} center />
      <div className="lp-why">
        {MORE_ICONS.map((Icon, i) => (
          <Reveal key={i} delay={i * 90} className="lp-card lp-spot" {...spotlight}>
            <span className="lp-iconbadge is-large tone-violet"><Icon size={20} /></span>
            <h3>{t(`sec.more.${i + 1}.title`)}</h3>
            <p>{t(`sec.more.${i + 1}.text`)}</p>
          </Reveal>
        ))}
      </div>
    </section>
    <CtaBand />
  </>
  );
};

/* ------------------------------------------------------------------ */
/* How it works                                                        */
/* ------------------------------------------------------------------ */

export const HowItWorksPage: React.FC = () => {
  const t = useT();
  const r = (key: string) => <Rich text={t(key)} />;
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setStage((s) => (s + 1) % 4), 2600);
    return () => window.clearInterval(id);
  }, []);
  const rows = [1, 2, 3, 4].map((i) => ({ title: t(`how.${i}.title`), text: t(`how.${i}.text`), items: [1, 2, 3].map((j) => t(`how.${i}.item.${j}`)) }));
  return (
    <>
      <PageHero
        kicker={t('how.hero.kicker')}
        title={r('how.hero.title')}
        text={t('how.hero.text')}
        actions={<div className="lp-hero-actions"><button type="button" className="lp-btn lp-btn-primary" onClick={goToLogin}>{t('how.hero.primary')} <ArrowRight size={17} /></button></div>}
      />
      <section className="lp-section">
        <div className="lp-how">
          <div className="lp-how-rail" aria-hidden="true">
            {rows.map((_, i) => (
              <span key={i} className={`lp-how-dot ${i <= stage ? 'is-on' : ''}`}>{i + 1}</span>
            ))}
            <i className="lp-how-fill" style={{ height: `${(stage / 3) * 100}%` }} />
          </div>
          <div className="lp-how-list">
            {rows.map((row, i) => (
              <Reveal key={i} delay={80} className={`lp-how-card ${i === stage ? 'is-current' : ''}`}>
                <span className="lp-step-num">{String(i + 1).padStart(2, '0')}</span>
                <h3>{row.title}</h3>
                <p>{row.text}</p>
                <ul>{row.items.map((item, j) => <li key={j}><Check size={14} />{item}</li>)}</ul>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
      <section className="lp-section lp-section-tint">
        <SectionHead kicker={t('how.faq.kicker')} title={r('how.faq.title')} center />
        <Faq />
      </section>
      <CtaBand />
    </>
  );
};
