import React, { useEffect, useState } from 'react';
import {
  BellRing,
  Briefcase,
  CalendarCheck,
  Check,
  FileText,
  IndianRupee,
  KanbanSquare,
  Lock,
  MessageSquare,
  Network,
  ScrollText,
  Sparkles,
  Target,
  Users,
  Video,
  X,
} from 'lucide-react';
import { CountUp, Reveal, prefersReducedMotion, useInView, useParallax } from './hooks';
import { useModules, type IconType } from './data';
import { useT } from './content';
import type { ModuleKey } from './routes';

const HUES = ['#fa7014', '#2f9e77', '#d4a017', '#3b82c4', '#d4577c', '#1f9aa3', '#64748b'];

export const Avatar: React.FC<{ name: string; size?: number; i?: number }> = ({ name, size = 28, i = 0 }) => {
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const hue = HUES[(name.length + i) % HUES.length];
  return (
    <span className="lp-avatar" style={{ width: size, height: size, background: `${hue}1f`, color: hue, fontSize: size * 0.38 }}>
      {initials}
    </span>
  );
};

export const MockWindow: React.FC<{ title: string; badge?: string; className?: string; children: React.ReactNode }> = ({
  title,
  badge,
  className = '',
  children,
}) => {
  const t = useT();
  // Bars, rings and cards animate in only once the window is actually on screen.
  const [ref, seen] = useInView<HTMLDivElement>(0.2);
  return (
    <div ref={ref} className={`lp-window ${seen ? 'lp-live' : ''} ${className}`}>
      <div className="lp-window-top">
        <span className="lp-window-dots"><i /><i /><i /></span>
        <span className="lp-window-title">{title}</span>
        <span className="lp-window-badge"><i /> {badge ?? t('viz.window.badge')}</span>
      </div>
      <div className="lp-window-body">{children}</div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Hero scene                                                          */
/* ------------------------------------------------------------------ */

const TOAST_META: { icon: IconType; tone: string }[] = [
  { icon: Check, tone: 'green' },
  { icon: CalendarCheck, tone: 'violet' },
  { icon: IndianRupee, tone: 'amber' },
  { icon: Video, tone: 'blue' },
  { icon: Sparkles, tone: 'rose' },
  { icon: ScrollText, tone: 'teal' },
];

export const ToastFeed: React.FC = () => {
  const t = useT();
  const TOASTS = TOAST_META.map((m, i) => ({ ...m, title: t(`viz.toast.${i + 1}.title`), sub: t(`viz.toast.${i + 1}.text`) }));
  const [n, setN] = useState(2);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const id = window.setInterval(() => setN((v) => v + 1), 2600);
    return () => window.clearInterval(id);
  }, []);
  const items = [0, 1, 2]
    .map((offset) => n - offset)
    .filter((abs) => abs >= 0)
    .map((abs) => ({ abs, ...TOASTS[abs % TOASTS.length] }));
  return (
    <div className="lp-toasts" aria-hidden="true">
      {items.map((t, i) => {
        const Icon = t.icon;
        return (
          <div key={t.abs} className={`lp-toast tone-${t.tone}`} style={{ ['--o' as string]: i }}>
            <span className="lp-toast-icon"><Icon size={15} /></span>
            <span><b>{t.title}</b><small>{t.sub}</small></span>
          </div>
        );
      })}
    </div>
  );
};

const FUNNEL_VALUES = [100, 72, 44, 18];

export const HeroScene: React.FC = () => {
  const t = useT();
  const FUNNEL = FUNNEL_VALUES.map((v, i) => ({ label: t(`viz.hero.funnel${i + 1}`), v }));
  const ref = useParallax<HTMLDivElement>();
  return (
    <div className="lp-hero-scene" ref={ref} aria-label="Illustration of the Amaavigo workspace">
      <div className="lp-blob lp-blob-a" />
      <div className="lp-blob lp-blob-b" />
      <div className="lp-ring lp-ring-1" />
      <div className="lp-ring lp-ring-2" />

      <div className="lp-layer lp-layer-main">
        <MockWindow title={t('viz.hero.window')}>
          <div className="lp-dash-head">
            <div><small>{t('viz.hero.greeting')}</small><h4>{t('viz.hero.heading')}</h4></div>
            <div className="lp-avatars"><Avatar name="Hema R" i={0} /><Avatar name="Omar K" i={1} /><Avatar name="Priya S" i={2} /><span>+4</span></div>
          </div>
          <div className="lp-tiles">
            <div className="lp-tile"><span className="lp-tile-icon tone-violet"><Briefcase size={15} /></span><small>{t('viz.hero.tile1')}</small><strong><CountUp value={6} /></strong></div>
            <div className="lp-tile"><span className="lp-tile-icon tone-green"><CalendarCheck size={15} /></span><small>{t('viz.hero.tile2')}</small><strong><CountUp value={4} /></strong></div>
            <div className="lp-tile"><span className="lp-tile-icon tone-blue"><Users size={15} /></span><small>{t('viz.hero.tile3')}</small><strong><CountUp value={246} /></strong></div>
          </div>
          <div className="lp-funnel">
            <div className="lp-funnel-head"><b>{t('viz.hero.funnel')}</b><span>{t('viz.hero.funnelperiod')}</span></div>
            {FUNNEL.map((f, i) => (
              <div className="lp-funnel-row" key={f.label}>
                <small>{f.label}</small>
                <div className="lp-funnel-bar"><i style={{ ['--w' as string]: `${f.v}%`, ['--i' as string]: i }} /></div>
                <em>{f.v}</em>
              </div>
            ))}
          </div>
        </MockWindow>
      </div>

      <div className="lp-layer lp-layer-front"><ToastFeed /></div>

      <div className="lp-layer lp-layer-chip lp-chip-a">
        <span className="lp-chip"><span className="lp-chip-icon tone-violet"><Sparkles size={14} /></span><span><b>{t('viz.hero.chipa.title')}</b><small>{t('viz.hero.chipa.text')}</small></span></span>
      </div>
      <div className="lp-layer lp-layer-chip lp-chip-b">
        <span className="lp-chip"><span className="lp-chip-icon tone-green"><Check size={14} /></span><span><b>{t('viz.hero.chipb.title')}</b><small>{t('viz.hero.chipb.text')}</small></span></span>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Module visuals                                                      */
/* ------------------------------------------------------------------ */

const Kanban: React.FC = () => {
  const t = useT();
  const cols = [
    { name: t('viz.kanban.col1'), items: [{ n: 'Ananya Rao', r: 'Product designer', s: 82 }, { n: 'Karan Shah', r: 'Product designer', s: 76 }] },
    { name: t('viz.kanban.col2'), items: [{ n: 'Meera Patel', r: 'Product designer', s: 91 }, { n: 'Rohan Das', r: 'Backend engineer', s: 85 }] },
    { name: t('viz.kanban.col3'), items: [{ n: 'Dev Thomas', r: 'Backend engineer', s: 88 }] },
  ];
  return (
    <MockWindow title={t('viz.kanban.window')}>
      <div className="lp-kanban">
        {cols.map((c, ci) => (
          <div className="lp-kcol" key={c.name}>
            <div className="lp-kcol-head">{c.name}<span>{c.items.length}</span></div>
            {c.items.map((it, ii) => (
              <div className="lp-kcard" key={it.n} style={{ ['--i' as string]: ci * 2 + ii }}>
                <Avatar name={it.n} i={ci + ii} size={26} />
                <div><b>{it.n}</b><small>{it.r}</small></div>
                <span className="lp-score">{it.s}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="lp-meta-row"><span><Sparkles size={13} /> {t('viz.kanban.meta1')}</span><span><Video size={13} /> {t('viz.kanban.meta2')}</span></div>
    </MockWindow>
  );
};

const LeaveVisual: React.FC = () => {
  const t = useT();
  const cells = Array.from({ length: 35 }, (_, i) => {
    const d = i - 2;
    if (d < 1 || d > 30) return { d: '', cls: 'is-empty' };
    const weekend = i % 7 === 5 || i % 7 === 6;
    let cls = weekend ? 'is-off' : '';
    if ([9, 10].includes(d)) cls = 'is-leave';
    if (d === 14) cls = 'is-holiday';
    if ([22, 23, 24].includes(d)) cls = 'is-leave';
    if (d === 17) cls = 'is-today';
    return { d: String(d), cls };
  });
  const balances = [
    { n: t('viz.leave.type1'), v: 11, t: 18 },
    { n: t('viz.leave.type2'), v: 6, t: 8 },
    { n: t('viz.leave.type3'), v: 4, t: 6 },
  ];
  return (
    <MockWindow title={t('viz.leave.window')}>
      <div className="lp-split">
        <div>
          <div className="lp-cal-head"><b>{t('viz.leave.month')}</b><span>{t('viz.leave.calendar')}</span></div>
          <div className="lp-cal">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <small key={i}>{d}</small>)}
            {cells.map((c, i) => <span key={i} className={`lp-cal-cell ${c.cls}`}>{c.d}</span>)}
          </div>
        </div>
        <div className="lp-balances">
          <b>{t('viz.leave.balances')}</b>
          {balances.map((b, i) => (
            <div key={b.n} className="lp-balance">
              <div><small>{b.n}</small><em>{b.v} / {b.t}</em></div>
              <div className="lp-bar"><i style={{ ['--w' as string]: `${(b.v / b.t) * 100}%`, ['--i' as string]: i }} /></div>
            </div>
          ))}
          <div className="lp-approval"><Avatar name="Sana Iqbal" size={24} /><span><b>Sana</b><small>{t('viz.leave.waiting')}</small></span><button type="button" tabIndex={-1}><Check size={13} /> {t('viz.leave.approve')}</button></div>
        </div>
      </div>
    </MockWindow>
  );
};

const PayrollVisual: React.FC = () => {
  const t = useT();
  const bars = [52, 61, 58, 70, 66, 78];
  const rows = [
    [t('viz.pay.row1'), '₹ 52,000'],
    [t('viz.pay.row2'), '₹ 26,000'],
    [t('viz.pay.row3'), '− ₹ 6,240'],
    [t('viz.pay.row4'), '− ₹ 200'],
    [t('viz.pay.row5'), '− ₹ 4,100'],
  ];
  return (
    <MockWindow title={t('viz.pay.window')}>
      <div className="lp-split">
        <div className="lp-payslip">
          <div className="lp-payslip-head"><b>{t('viz.pay.payslip')}</b><span>{t('viz.pay.sample')}</span></div>
          {rows.map(([a, b]) => (
            <div key={a} className="lp-pay-row"><span>{a}</span><b className={b.startsWith('−') ? 'is-minus' : ''}>{b}</b></div>
          ))}
          <div className="lp-pay-net"><span>{t('viz.pay.net')}</span><strong>₹ <CountUp value={66960} format /></strong></div>
        </div>
        <div className="lp-chart">
          <b>{t('viz.pay.chart')}</b>
          <div className="lp-bars">
            {bars.map((h, i) => (
              <div key={i} className="lp-vbar"><i style={{ ['--h' as string]: `${h}%`, ['--i' as string]: i }} /><small>{['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'][i]}</small></div>
            ))}
          </div>
          <div className="lp-lock"><Lock size={13} /> {t('viz.pay.lock')}</div>
        </div>
      </div>
    </MockWindow>
  );
};

const Ring: React.FC<{ pct: number; label: string; tone: string; i: number }> = ({ pct, label, tone, i }) => (
  <div className={`lp-ringstat tone-${tone}`}>
    <svg viewBox="0 0 80 80" width="84" height="84" aria-hidden="true">
      <circle cx="40" cy="40" r="32" className="lp-ring-bg" />
      <circle cx="40" cy="40" r="32" className="lp-ring-fg" style={{ ['--p' as string]: pct, ['--i' as string]: i }} />
    </svg>
    <strong><CountUp value={pct} suffix="%" /></strong>
    <small>{label}</small>
  </div>
);

const PerformanceVisual: React.FC = () => {
  const t = useT();
  return (
  <MockWindow title={t('viz.perf.window')}>
    <div className="lp-rings">
      <Ring pct={86} label={t('viz.perf.ring1')} tone="violet" i={0} />
      <Ring pct={64} label={t('viz.perf.ring2')} tone="green" i={1} />
      <Ring pct={92} label={t('viz.perf.ring3')} tone="rose" i={2} />
    </div>
    <div className="lp-timeline-h">
      {[1, 2, 3].map((n, i) => (
        <div key={n} className={`lp-tstep ${i < 2 ? 'is-done' : ''}`} style={{ ['--i' as string]: i }}>
          <span>{i < 2 ? <Check size={12} /> : i + 1}</span>{t(`viz.perf.step${n}`)}
        </div>
      ))}
    </div>
  </MockWindow>
  );
};

const PeopleVisual: React.FC = () => {
  const t = useT();
  const lines = ['M180 50 L70 96', 'M180 50 L180 96', 'M180 50 L290 96', 'M70 126 L34 172', 'M70 126 L106 172', 'M180 126 L160 172', 'M180 126 L214 172', 'M290 126 L262 172', 'M290 126 L322 172'];
  const nodes: [number, number, string, number][] = [
    [180, 34, 'Asha Menon', 14], [70, 110, 'Vikram Rao', 11], [180, 110, 'Nisha Jain', 11], [290, 110, 'Farah Ali', 11],
    [34, 188, 'Tara N', 9], [106, 188, 'Ishan B', 9], [160, 188, 'Leo D', 9], [214, 188, 'Zoya K', 9], [262, 188, 'Raj P', 9], [322, 188, 'Mina G', 9],
  ];
  return (
    <MockWindow title={t('viz.org.window')}>
      <svg className="lp-org" viewBox="0 0 360 220" role="img" aria-label="Sample organisation chart">
        {lines.map((d, i) => <path key={d} d={d} className="lp-draw" style={{ ['--i' as string]: i }} />)}
        {nodes.map(([x, y, n, r], i) => (
          <g key={n} className="lp-node-pop" style={{ ['--i' as string]: i }}>
            <circle cx={x} cy={y} r={r + 4} className="lp-org-halo" />
            <circle cx={x} cy={y} r={r} className="lp-org-node" />
            <text x={x} y={y + 3} textAnchor="middle">{n.split(' ').map((p) => p[0]).join('')}</text>
          </g>
        ))}
      </svg>
      <div className="lp-meta-row"><span><Network size={13} /> {t('viz.org.meta1')}</span><span><Users size={13} /> {t('viz.org.meta2')}</span></div>
    </MockWindow>
  );
};

const PoliciesVisual: React.FC = () => {
  const t = useT();
  return (
  <MockWindow title={t('viz.policy.window')}>
    <div className="lp-doc">
      <div className="lp-doc-head"><FileText size={16} /><b>{t('viz.policy.name')}</b><span className="lp-vchip">v1.7</span><span className="lp-varrow">→</span><span className="lp-vchip is-new">v1.8</span></div>
      <div className="lp-diff">
        <p className="is-ctx">{t('viz.policy.ctx1')}</p>
        <p className="is-del">{t('viz.policy.del')}</p>
        <p className="is-add">{t('viz.policy.add')}</p>
        <p className="is-ctx">{t('viz.policy.ctx2')}</p>
      </div>
      <div className="lp-ack">
        <div><b>{t('viz.policy.ack')}</b><em><CountUp value={62} /> of 70</em></div>
        <div className="lp-bar"><i style={{ ['--w' as string]: '88%' }} /></div>
        <div className="lp-avatars"><Avatar name="Hema R" i={0} size={24} /><Avatar name="Omar K" i={1} size={24} /><Avatar name="Priya S" i={2} size={24} /><span>+59</span></div>
      </div>
    </div>
  </MockWindow>
  );
};

const TasksVisual: React.FC = () => {
  const t = useT();
  const cols = [
    { name: t('viz.tasks.col1'), cards: [t('viz.tasks.card1'), t('viz.tasks.card2')] },
    { name: t('viz.tasks.col2'), cards: [t('viz.tasks.card3')] },
    { name: t('viz.tasks.col3'), cards: [t('viz.tasks.card4'), t('viz.tasks.card5')] },
  ];
  return (
    <MockWindow title={t('viz.tasks.window')}>
      <div className="lp-kanban">
        {cols.map((c, ci) => (
          <div className="lp-kcol" key={c.name}>
            <div className="lp-kcol-head">{c.name}<span>{c.cards.length}</span></div>
            {c.cards.map((card, ii) => (
              <div key={ii} className={`lp-tcard ${ci === 0 && ii === 0 ? 'is-moving' : ''}`} style={{ ['--i' as string]: ci * 2 + ii }}>
                <b>{card}</b>
                <span><Avatar name={['Hema R', 'Omar K', 'Priya S'][(ci + ii) % 3]} size={20} i={ci} /><small>{ci === 2 ? t('viz.tasks.done') : t('viz.tasks.due')}</small></span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </MockWindow>
  );
};

export const ModuleVisual: React.FC<{ k: ModuleKey }> = ({ k }) => {
  switch (k) {
    case 'hiring': return <Kanban />;
    case 'leave': return <LeaveVisual />;
    case 'payroll': return <PayrollVisual />;
    case 'performance': return <PerformanceVisual />;
    case 'people': return <PeopleVisual />;
    case 'policies': return <PoliciesVisual />;
    case 'tasks': return <TasksVisual />;
    default: return null;
  }
};

/* ------------------------------------------------------------------ */
/* Module hub (modules index)                                          */
/* ------------------------------------------------------------------ */

export const OrbitHub: React.FC = () => {
  const t = useT();
  const MODULES = useModules();
  return (
  <div className="lp-hub" aria-hidden="true">
    <div className="lp-hub-ring lp-hub-ring-1" />
    <div className="lp-hub-ring lp-hub-ring-2" />
    <div className="lp-hub-core"><b>{t('modules.hero.core1')}</b><small>{t('modules.hero.core2')}</small></div>
    <div className="lp-hub-spin">
      {MODULES.map((m, i) => {
        const Icon = m.icon;
        return (
          <div key={m.key} className="lp-hub-item" style={{ ['--a' as string]: `${(360 / MODULES.length) * i}deg` }}>
            <span className={`lp-hub-badge tone-${m.tone}`}><Icon size={18} /></span>
          </div>
        );
      })}
    </div>
  </div>
  );
};

/* ------------------------------------------------------------------ */
/* Automation flow                                                     */
/* ------------------------------------------------------------------ */

const FLOW_ICONS: IconType[] = [Briefcase, FileText, Sparkles, Target, Video, Check];

export const AutomationFlow: React.FC = () => {
  const t = useT();
  const FLOW_STEPS = FLOW_ICONS.map((icon, i) => ({ icon, label: t(`viz.flow.${i + 1}`) }));
  return (
  <div className="lp-flow" aria-label="A hiring flow that moves from step to step on its own">
    <div className="lp-flow-line"><i /></div>
    {FLOW_STEPS.map((s, i) => {
      const Icon = s.icon;
      return (
        <div key={s.label} className="lp-flow-node" style={{ ['--i' as string]: i }}>
          <span><Icon size={18} /></span>
          <small>{s.label}</small>
        </div>
      );
    })}
  </div>
  );
};

/* ------------------------------------------------------------------ */
/* Ask HR demo (types its answers)                                     */
/* ------------------------------------------------------------------ */

export const ChatDemo: React.FC = () => {
  const t = useT();
  const QA = [1, 2, 3].map((i) => ({ q: t(`viz.chat.${i}.q`), a: t(`viz.chat.${i}.a`) }));
  const [ref, seen] = useInView<HTMLDivElement>(0.3);
  const [qi, setQi] = useState(0);
  const [phase, setPhase] = useState<'ask' | 'think' | 'answer'>('ask');
  const [typed, setTyped] = useState(0);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (!seen || reduced) return;
    let cancelled = false;
    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(() => !cancelled && fn(), ms));
    const run = (i: number) => {
      setQi(i);
      setPhase('ask');
      setTyped(0);
      later(() => setPhase('think'), 1100);
      later(() => {
        setPhase('answer');
        const full = QA[i].a.length;
        let c = 0;
        const id = window.setInterval(() => {
          c += 2;
          setTyped(Math.min(full, c));
          if (c >= full) window.clearInterval(id);
        }, 28);
        timers.push(id);
      }, 2200);
      later(() => run((i + 1) % QA.length), 2200 + QA[i].a.length * 14 + 3200);
    };
    run(0);
    return () => {
      cancelled = true;
      timers.forEach((t) => { window.clearTimeout(t); window.clearInterval(t); });
    };
  }, [seen, reduced, QA.map((x) => x.a).join('|')]);

  const qa = QA[qi];
  const answerText = reduced ? qa.a : qa.a.slice(0, typed);
  return (
    <div className="lp-chatdemo" ref={ref}>
      <div className="lp-chat-head"><span><MessageSquare size={14} /></span><b>{t('viz.chat.title')}</b><small>{t('viz.chat.sub')}</small></div>
      <div className="lp-chat-body">
        <div className="lp-bubble lp-bubble-q" key={`q${qi}`}>{qa.q}</div>
        {!reduced && phase === 'think' && <div className="lp-bubble lp-bubble-a lp-dots"><i /><i /><i /></div>}
        {(reduced || phase === 'answer') && <div className="lp-bubble lp-bubble-a" key={`a${qi}`}>{answerText}{!reduced && typed < qa.a.length && <span className="lp-caret" />}</div>}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Flags demo (clickable)                                              */
/* ------------------------------------------------------------------ */

const FLAG_TONES = ['amber', 'rose', 'violet'];

export const FlagsDemo: React.FC = () => {
  const t = useT();
  const FLAGS = FLAG_TONES.map((tone, i) => ({ t: t(`viz.flags.${i + 1}.title`), s: t(`viz.flags.${i + 1}.text`), tone }));
  const [done, setDone] = useState<Record<number, boolean>>({});
  return (
    <div className="lp-flagsdemo">
      <div className="lp-chat-head"><span><BellRing size={14} /></span><b>{t('viz.flags.title')}</b><small>{t('viz.flags.sub')}</small></div>
      {FLAGS.map((f, i) => (
        <div key={f.t} className={`lp-flagrow tone-${f.tone} ${done[i] ? 'is-done' : ''}`}>
          <i />
          <span><b>{f.t}</b><small>{f.s}</small></span>
          <button type="button" onClick={() => setDone((d) => ({ ...d, [i]: !d[i] }))}>{done[i] ? <><Check size={13} /> {t('viz.flags.reviewed')}</> : t('viz.flags.review')}</button>
        </div>
      ))}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Security visuals                                                    */
/* ------------------------------------------------------------------ */

export const IsolationDiagram: React.FC = () => {
  const t = useT();
  return (
  <div className="lp-iso" aria-label="Each company's data stays separate">
    {[1, 2, 3].map((n) => t(`viz.iso.company${n}`)).map((c, i) => (
      <div key={c} className="lp-iso-box" style={{ ['--i' as string]: i }}>
        <span className="lp-iso-lock"><Lock size={14} /></span>
        <b>{c}</b>
        <div className="lp-avatars"><Avatar name={`${c} One`} i={i} size={24} /><Avatar name={`${c} Two`} i={i + 2} size={24} /><Avatar name={`${c} Three`} i={i + 4} size={24} /></div>
        <small>{t('viz.iso.contents')}</small>
        <span className="lp-iso-x"><X size={13} /> {t('viz.iso.blocked')}</span>
      </div>
    ))}
  </div>
  );
};

export const AuditTimeline: React.FC = () => {
  const t = useT();
  const tones = ['violet', 'amber', 'green', 'blue'];
  const items = tones.map((tone, i) => [t(`viz.audit.${i + 1}.title`), t(`viz.audit.${i + 1}.who`), tone]);
  return (
    <div className="lp-audit">
      {items.map(([title, who, tone], i) => (
        <Reveal key={i} delay={i * 160} variant="left" className={`lp-audit-row tone-${tone}`}>
          <i /><span><b>{title}</b><small>{who}</small></span>
        </Reveal>
      ))}
    </div>
  );
};

export const PermissionChips: React.FC = () => {
  const t = useT();
  const roles = [1, 2, 3, 4, 5, 6].map((n) => t(`viz.role.${n}`));
  return (
    <div className="lp-chips">
      {roles.map((r, i) => <span key={i} style={{ ['--i' as string]: i }}>{r}</span>)}
      <span className="is-add" style={{ ['--i' as string]: roles.length }}>{t('viz.role.own')}</span>
    </div>
  );
};

/* Small icon used for the "Policies & documents" and similar nav chips. */
export const ModuleIconBadge: React.FC<{ k: ModuleKey; size?: number }> = ({ k, size = 18 }) => {
  const MODULES = useModules();
  const m = MODULES.find((x) => x.key === k);
  if (!m) return <KanbanSquare size={size} />;
  const Icon = m.icon;
  return <span className={`lp-iconbadge tone-${m.tone}`}><Icon size={size} /></span>;
};
