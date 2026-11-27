import React, { useState } from 'react';
import { FOLLOW_UP_RULES, type FollowUpRuleId } from '../../../shared/followUps';
import { followUpService, type FollowUpState } from '../../services/hiringAutomationService';
import { Loading, useLoad } from '../common/loadUi';
import { Switch } from '../hiring/shell/Switch';
import { SidePanel } from '../hiring/shell/SidePanel';
import { useToast } from '../leave/ui';
import { whenIst } from './when';

const ghost = 'h-8 cursor-pointer rounded-md border border-[#dfe1e5] bg-white px-3 text-[13px] font-semibold text-[#16181d] hover:bg-[#f8f8f9] disabled:opacity-50';

/** Automatic reminders for hiring work that is waiting on someone. Off until switched on. */
export const FollowUps: React.FC<{ onShowActivity: () => void }> = ({ onShowActivity }) => {
  const load = useLoad(() => followUpService.state(), []);
  const [fresh, setFresh] = useState<FollowUpState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<FollowUpRuleId | ''>('');
  const [value, setValue] = useState('');
  const [preview, setPreview] = useState<FollowUpState['next'][number] | null>(null);
  const toast = useToast();
  const state = fresh || load.data;
  if (!state) return <Loading loading={load.loading} error={load.error} />;
  const { settings } = state;

  const save = async (patch: unknown, done: string) => {
    setBusy(true); setError('');
    try { setFresh(await followUpService.save(patch)); toast?.(done); setEditing(''); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="max-w-5xl space-y-6">
      {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
      <section className="flex flex-wrap items-center gap-4 rounded-[12px] border border-[#e8e9ec] px-5 py-4">
        <Switch on={settings.enabled} disabled={busy} label="Automatic follow-ups" onChange={(on) => save({ enabled: on }, on ? 'Follow-ups are on.' : 'Follow-ups are off.')} />
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="text-base font-semibold text-[#16181d]">Automatic follow-ups are {settings.enabled ? 'on' : 'off'}</h2>
          <p className="text-[13px] text-[#5c626d]">At most one reminder per person per task each day. Working hours only: {state.workingHours}.</p>
        </div>
        {settings.enabled && <button type="button" disabled={busy} onClick={() => save({ enabled: false }, 'All follow-ups are paused.')} className={ghost}>Pause all</button>}
      </section>

      <section>
        <h2 className="text-base font-semibold text-[#16181d]">Rules</h2>
        <ul className="mt-2 divide-y divide-[#eef0f2] border-y border-[#eef0f2]">
          {FOLLOW_UP_RULES.map((def) => {
            const r = settings.rules[def.id];
            return (
              <li key={def.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5">
                <Switch on={r.on} disabled={busy} label={def.title} onChange={(on) => save({ rules: { [def.id]: { on } } }, 'Saved.')} />
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-sm font-semibold text-[#16181d]">{def.title}</p>
                  <p className="text-[13px] text-[#5c626d]">{def.when(r.after)} · goes to {def.to}</p>
                </div>
                {editing === def.id ? (
                  <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void save({ rules: { [def.id]: { after: Number(value) } } }, 'Saved.'); }}>
                    <input type="number" min={def.min} max={def.max} required autoFocus value={value} onChange={(e) => setValue(e.target.value)} aria-label={`${def.title}: number of ${def.unit}`} className="h-8 w-20 rounded-md border border-[#dfe1e5] px-2 text-sm" />
                    <span className="text-[13px] text-[#5c626d]">{def.unit}</span>
                    <button type="submit" disabled={busy} className={ghost}>Save</button>
                    <button type="button" onClick={() => setEditing('')} className={ghost}>Cancel</button>
                  </form>
                ) : <button type="button" onClick={() => { setEditing(def.id); setValue(String(r.after)); }} className={ghost}>Edit</button>}
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 className="text-base font-semibold text-[#16181d]">{settings.enabled ? 'Going out next' : 'Would go out if switched on'}{state.waitingCount ? ` (${state.waitingCount})` : ''}</h2>
        {settings.enabled && !state.workingTime && <p className="text-[13px] text-[#5c626d]">It is outside working hours, so these wait for the next working day.</p>}
        {state.next.length === 0 ? <p className="py-4 text-sm text-[#5c626d]">Nothing is waiting for a reminder right now.</p> : (
          <ul className="mt-2 divide-y divide-[#eef0f2] border-y border-[#eef0f2]">
            {state.next.map((n, i) => (
              <li key={i} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1 basis-64"><p className="text-sm text-[#16181d]"><b className="font-semibold">{n.toName}</b></p><p className="text-[13px] text-[#5c626d]">{n.why}</p></div>
                <button type="button" onClick={() => setPreview(n)} className={ghost}>Preview message</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold text-[#16181d]">Sent lately</h2><button type="button" onClick={onShowActivity} className="cursor-pointer text-[13px] font-semibold text-[#3F3393] hover:underline">All activity</button></div>
        {state.recent.length === 0 ? <p className="py-4 text-sm text-[#5c626d]">No reminders have been sent yet.</p> : (
          <ul className="mt-2 divide-y divide-[#eef0f2] border-y border-[#eef0f2]">
            {state.recent.map((r, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-4 py-2.5">
                <span className="min-w-0 flex-1 basis-64 text-[13px] text-[#3d434d]"><b className="font-semibold text-[#16181d]">{r.toName}</b> · {r.why}{r.status === 'FAILED' && <span className="text-rose-700"> Not delivered: {r.error}</span>}</span>
                <span className="text-xs text-[#5c626d]">{whenIst(r.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {preview && (
        <SidePanel label="Message preview" onClose={() => setPreview(null)} header={<div className="flex items-center justify-between gap-3 pb-3"><h2 className="text-base font-semibold">Message preview</h2><button type="button" onClick={() => setPreview(null)} className={ghost}>Close</button></div>}>
          <p className="text-[13px] text-[#5c626d]">To {preview.toName}</p>
          <p className="mt-2 text-sm font-semibold text-[#16181d]">{preview.subject}</p>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm text-[#3d434d]">{preview.body}</p>
        </SidePanel>
      )}
    </div>
  );
};
