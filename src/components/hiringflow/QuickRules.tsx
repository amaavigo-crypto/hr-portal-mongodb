import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { FIELD_LABEL, FIELD_OPS, MAX_ACTIONS, MAX_CONDITIONS, OP_LABEL, RULE_TEMPLATES, describeAction, type QuickRuleInput, type RuleAction, type RuleCondition, type RuleField, type RuleOp } from '../../../shared/quickRules';
import { quickRuleService, type QuickRuleRow, type QuickRuleTest } from '../../services/hiringAutomationService';
import { Loading, useLoad } from '../common/loadUi';
import { Switch } from '../hiring/shell/Switch';
import { useToast } from '../leave/ui';
import { whenIst } from './when';

const ghost = 'h-9 cursor-pointer rounded-lg border border-[#dfe1e5] bg-white px-3.5 text-[13px] font-semibold text-[#16181d] hover:bg-[#f8f8f9] disabled:opacity-50';
const primary = 'h-9 cursor-pointer rounded-lg bg-[#4C3EB0] px-4 text-[13px] font-semibold text-white hover:bg-[#3F3393] disabled:opacity-50';
const field = 'h-9 min-w-0 rounded-lg border border-[#dfe1e5] bg-white px-2.5 text-[13px] outline-none focus:border-[#4C3EB0]';
type Draft = QuickRuleInput & { id?: string; status?: string };

const newAction = (type: RuleAction['type']): RuleAction => (type === 'tag' ? { type, tag: '' } : type === 'notify' ? { type, uid: '' } : { ...(RULE_TEMPLATES.find((t) => t.id === 'ack')!.rule.actions[0]) });
const summary = (r: QuickRuleInput) => `${r.conditions.length ? `If ${r.conditions.map((c) => `${FIELD_LABEL[c.field].toLowerCase()} ${OP_LABEL[c.op]} ${c.value}`).join(' and ')}` : 'For every new application'}, ${r.actions.map((a) => describeAction(a).toLowerCase()).join(', then ')}.`;

const Editor: React.FC<{ initial: Draft; people: { uid: string; name: string }[]; onDone: () => void }> = ({ initial, people, onDone }) => {
  const [rule, setRule] = useState<Draft>(() => JSON.parse(JSON.stringify(initial)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [test, setTest] = useState<QuickRuleTest | null>(null);
  const toast = useToast();
  const change = (patch: Partial<Draft>) => { setRule((r) => ({ ...r, ...patch })); setTest(null); };
  const setC = (i: number, patch: Partial<RuleCondition>) => change({ conditions: rule.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const setA = (i: number, a: RuleAction) => change({ actions: rule.actions.map((x, j) => (j === i ? a : x)) });
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const save = (turnOn: boolean) => run(async () => { await quickRuleService.save({ ...rule, turnOn }); toast?.(turnOn ? 'The rule is on.' : 'Saved as a draft.'); onDone(); });

  return (
    <div className="max-w-3xl space-y-5">
      <label className="block text-[13px] font-semibold text-[#16181d]">Rule name<input value={rule.name} maxLength={80} onChange={(e) => change({ name: e.target.value })} className={`${field} mt-1 w-full font-normal`} /></label>
      <section className="rounded-[12px] border border-[#e8e9ec] p-4"><p className="text-xs font-semibold uppercase tracking-wide text-[#5c626d]">When</p><p className="mt-1 text-sm text-[#16181d]">A new application arrives (not spreadsheet imports)</p></section>
      <section className="space-y-2 rounded-[12px] border border-[#e8e9ec] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#5c626d]">If</p>
        {rule.conditions.length === 0 && <p className="text-sm text-[#5c626d]">No conditions: every new application matches.</p>}
        {rule.conditions.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            {i > 0 && <span className="text-xs text-[#5c626d]">and</span>}
            <select aria-label="Field" value={c.field} onChange={(e) => { const f = e.target.value as RuleField; setC(i, { field: f, op: FIELD_OPS[f][0], value: '' }); }} className={field}>{Object.entries(FIELD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select aria-label="Comparison" value={c.op} onChange={(e) => setC(i, { op: e.target.value as RuleOp })} className={field}>{FIELD_OPS[c.field].map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}</select>
            <input aria-label="Value" value={c.value} onChange={(e) => setC(i, { value: e.target.value })} className={`${field} flex-1 basis-32`} />
            <button type="button" aria-label="Remove condition" onClick={() => change({ conditions: rule.conditions.filter((_, j) => j !== i) })} className="cursor-pointer p-2 text-[#5c626d] hover:text-rose-700"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        {rule.conditions.length < MAX_CONDITIONS && <button type="button" onClick={() => change({ conditions: [...rule.conditions, { field: 'experience', op: 'atLeast', value: '' }] })} className="cursor-pointer text-[13px] font-semibold text-[#3F3393]">+ Add condition</button>}
      </section>
      <section className="space-y-3 rounded-[12px] border border-[#e8e9ec] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#5c626d]">Then</p>
        {rule.actions.map((a, i) => (
          <div key={i} className="space-y-2 border-b border-[#eef0f2] pb-3 last:border-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Action" value={a.type} onChange={(e) => setA(i, newAction(e.target.value as RuleAction['type']))} className={field}><option value="tag">Add a tag</option><option value="notify">Email a colleague</option><option value="ack">Email the applicant</option></select>
              {a.type === 'tag' && <input aria-label="Tag" placeholder="Tag name" maxLength={30} value={a.tag} onChange={(e) => setA(i, { type: 'tag', tag: e.target.value })} className={`${field} flex-1 basis-40`} />}
              {a.type === 'notify' && <select aria-label="Person" value={a.uid} onChange={(e) => setA(i, { type: 'notify', uid: e.target.value })} className={`${field} flex-1 basis-40`}><option value="">The job's recruiter (or Head of HR)</option>{people.map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}</select>}
              {rule.actions.length > 1 && <button type="button" aria-label="Remove action" onClick={() => change({ actions: rule.actions.filter((_, j) => j !== i) })} className="cursor-pointer p-2 text-[#5c626d] hover:text-rose-700"><Trash2 className="h-4 w-4" /></button>}
            </div>
            {a.type === 'ack' && <>
              <input aria-label="Email subject" value={a.subject} onChange={(e) => setA(i, { ...a, subject: e.target.value })} className={`${field} w-full`} />
              <textarea aria-label="Email message" rows={6} value={a.message} onChange={(e) => setA(i, { ...a, message: e.target.value })} className="w-full rounded-lg border border-[#dfe1e5] px-2.5 py-2 text-[13px] outline-none focus:border-[#4C3EB0]" />
              <p className="text-xs text-[#5c626d]">{'{name}, {job} and {company} are filled in for each person.'}</p>
            </>}
          </div>
        ))}
        {rule.actions.length < MAX_ACTIONS && <button type="button" onClick={() => change({ actions: [...rule.actions, newAction('tag')] })} className="cursor-pointer text-[13px] font-semibold text-[#3F3393]">+ Add action</button>}
      </section>
      <p className="text-[13px] text-[#5c626d]">A rule cannot reject a candidate or change their stage. It runs once per candidate, only on applications that arrive after you turn it on, and every run is recorded.</p>
      {test && (
        <div className="rounded-[12px] bg-[#f4f3fb] p-4 text-sm text-[#16181d]" role="status">
          <p className="font-semibold">{test.matched} of the last {test.checked} applications match. Nothing was sent or changed.</p>
          {test.unknown > 0 && <p className="mt-1 text-[13px] text-[#5c626d]">{test.unknown} could not be checked because their resume has not been read yet.</p>}
          {test.examples.length > 0 && <p className="mt-1 text-[13px]">For example: {test.examples.map((e) => `${e.candidateName} (${e.designation})`).join(', ')}.</p>}
          <p className="mt-1 text-[13px]">For each new match it would: {test.wouldDo.join('; ')}.</p>
        </div>
      )}
      {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => run(async () => setTest(await quickRuleService.test(rule)))} className={ghost}>Run test on past applications</button>
        <span className="flex-1" />
        <button type="button" disabled={busy} onClick={onDone} className={ghost}>Cancel</button>
        <button type="button" disabled={busy} onClick={() => save(false)} className={ghost}>Save draft</button>
        <button type="button" disabled={busy} onClick={() => save(true)} className={primary}>{rule.status === 'ON' ? 'Save and keep on' : 'Turn on'}</button>
      </div>
    </div>
  );
};

/** Small "when this, then that" rules for new applications. */
export const QuickRules: React.FC = () => {
  const load = useLoad(() => quickRuleService.list(), []);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!load.data) return <Loading loading={load.loading} error={load.error} />;
  const { rules, people, recent } = load.data;
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); await load.reload(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  if (editing) return <Editor initial={editing} people={people} onDone={() => { setEditing(null); void load.reload(); }} />;

  return (
    <div className="max-w-5xl space-y-6">
      {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
      <section>
        <h2 className="text-base font-semibold text-[#16181d]">Your rules</h2>
        {rules.length === 0 ? <p className="py-4 text-sm text-[#5c626d]">No rules yet. Pick a starting point below. Nothing runs until you turn a rule on.</p> : (
          <ul className="mt-2 divide-y divide-[#eef0f2] border-y border-[#eef0f2]">
            {rules.map((r: QuickRuleRow) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5">
                <Switch on={r.status === 'ON'} disabled={busy} label={r.name} onChange={(on) => act(() => quickRuleService.switch(r.id, on))} />
                <div className="min-w-0 flex-1 basis-64">
                  <p className="text-sm font-semibold text-[#16181d]">{r.name} {r.status === 'DRAFT' && <span className="ml-1 rounded-full bg-[#fdf1dc] px-2 py-0.5 text-[11px] text-[#8a5300]">Draft</span>}</p>
                  <p className="text-[13px] text-[#5c626d]">{summary(r)} Ran {r.runs} time{r.runs === 1 ? '' : 's'}.</p>
                </div>
                <button type="button" onClick={() => setEditing(r)} className={ghost}>Edit</button>
                <button type="button" disabled={busy} aria-label={`Delete ${r.name}`} onClick={() => { if (window.confirm(`Delete the rule "${r.name}"?`)) void act(() => quickRuleService.remove(r.id)); }} className="cursor-pointer p-2 text-[#5c626d] hover:text-rose-700"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="text-base font-semibold text-[#16181d]">Start from a template</h2>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {RULE_TEMPLATES.map((t) => (
            <button key={t.id} type="button" onClick={() => setEditing(JSON.parse(JSON.stringify(t.rule)))} className="cursor-pointer rounded-[12px] border border-[#e8e9ec] p-4 text-left hover:border-[#4C3EB0]">
              <Plus className="h-4 w-4 text-[#4C3EB0]" aria-hidden />
              <span className="mt-2 block text-sm font-semibold text-[#16181d]">{t.title}</span>
              <span className="mt-0.5 block text-[13px] text-[#5c626d]">{t.blurb}</span>
            </button>
          ))}
        </div>
      </section>
      {recent.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-[#16181d]">Recent runs</h2>
          <ul className="mt-2 divide-y divide-[#eef0f2] border-y border-[#eef0f2]">
            {recent.map((r, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-4 py-2.5">
                <span className="min-w-0 flex-1 basis-64 text-[13px] text-[#3d434d]"><b className="font-semibold text-[#16181d]">{r.candidateName}</b> · {r.ruleName}: <span className={r.ok ? '' : 'text-rose-700'}>{r.results.join(' ') || 'Running…'}</span></span>
                <span className="text-xs text-[#5c626d]">{whenIst(r.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
