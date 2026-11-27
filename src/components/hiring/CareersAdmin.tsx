import React, { useState } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import { DEFAULT_SOURCE, RETENTION_CHOICES, careersPath, toSlug, toSourceLabel } from '../../../shared/careers';
import { careersAdminService, type CareersJob, type CareersState } from '../../services/hiringAutomationService';
import { Loading, useLoad } from '../common/loadUi';
import { Switch } from './shell/Switch';
import { SidePanel } from './shell/SidePanel';

const ghost = 'inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-[#dfe1e5] bg-white px-3.5 text-[13px] font-semibold text-[#16181d] hover:bg-[#f8f8f9] disabled:opacity-50';
const primary = 'h-9 cursor-pointer rounded-lg bg-[#4C3EB0] px-4 text-[13px] font-semibold text-white hover:bg-[#3F3393] disabled:opacity-50';
const field = 'mt-1 w-full rounded-lg border border-[#dfe1e5] bg-white px-3 py-2 text-sm font-normal outline-none focus:border-[#4C3EB0]';
const BOARDS = ['Job board 1', 'Job board 2'];

const JobPanel: React.FC<{ job: CareersJob; state: CareersState; busy: boolean; onHide: (hidden: boolean) => void; onClose: () => void }> = ({ job, state, busy, onHide, onClose }) => {
  const { page } = state;
  const [board, setBoard] = useState('');
  const [copied, setCopied] = useState('');
  const link = (source: string) => `${window.location.origin}${careersPath(page.slug, job.id, source)}`;
  const copy = async (what: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); } catch { window.prompt('Copy this text:', text); }
  };
  const post = `${job.title} at ${state.companyName}\n${[job.location, job.workMode, job.employmentType, job.experience].filter(Boolean).join(' · ')}\n\n${job.description}`.trim();
  const source = toSourceLabel(board);
  const total = Object.values(job.bySource).reduce((a, b) => a + b, 0);
  return (
    <SidePanel label={`Job posting: ${job.title}`} onClose={onClose} header={<div className="flex items-center justify-between gap-3 pb-3"><h2 className="min-w-0 truncate text-base font-semibold">{job.title}</h2><button type="button" onClick={onClose} className={ghost}>Close</button></div>}>
      <div className="space-y-6">
        <div className="flex items-center gap-3"><Switch on={!job.hidden} disabled={busy} label="Show on the careers page" onChange={(on) => onHide(!on)} /><p className="text-sm">{job.hidden ? 'Hidden from the careers page' : page.published ? 'Showing on your careers page' : 'Will show when the page is published'}</p></div>
        <section>
          <h3 className="text-sm font-semibold">Where to post</h3>
          <ul className="mt-2 divide-y divide-[#eef0f2] border-y border-[#eef0f2]">
            {BOARDS.map((b) => <li key={b} className="py-2.5 text-[13px]"><span className="font-semibold text-[#16181d]">{b}</span> <span className="text-[#5c626d]">· not connected. Automatic posting needs approved access from the board (cost to be confirmed).</span></li>)}
          </ul>
          <p className="mt-3 text-[13px] text-[#3d434d]">To post on any board today: copy the post and a tracked link, then paste them on the board yourself. Applications through that link are recorded as coming from it and go into the pipeline.</p>
          <label className="mt-3 block text-[13px] font-semibold">Name this link (the board or place you are posting on)<input value={board} maxLength={30} onChange={(e) => { setBoard(e.target.value); setCopied(''); }} placeholder="for example: referral-group" className={field} /></label>
          <p className="mt-2 break-all rounded-lg bg-[#f4f3fb] px-3 py-2 text-xs text-[#3d434d]">{link(source)}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => copy('link', link(source))} className={ghost}><Copy className="h-3.5 w-3.5" />{copied === 'link' ? 'Link copied' : 'Copy tracked link'}</button>
            <button type="button" onClick={() => copy('post', `${post}\n\nApply: ${link(source)}`)} className={ghost}><Copy className="h-3.5 w-3.5" />{copied === 'post' ? 'Post copied' : 'Copy post with link'}</button>
          </div>
          {!page.published && <p className="mt-2 text-[13px] text-[#8a5300]">Publish the page first, or this link will say the page is not available.</p>}
        </section>
        <section>
          <h3 className="text-sm font-semibold">Post preview</h3>
          <div className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-[#e8e9ec] p-3 text-[13px] leading-5 text-[#3d434d]">{post}</div>
          <p className="mt-1 text-xs text-[#5c626d]">Salary details are not included.</p>
        </section>
        <section>
          <h3 className="text-sm font-semibold">Applications by link ({total})</h3>
          {total === 0 ? <p className="mt-1 text-[13px] text-[#5c626d]">None yet.</p> : (
            <ul className="mt-2 divide-y divide-[#eef0f2] border-y border-[#eef0f2]">{Object.entries(job.bySource).sort((a, b) => b[1] - a[1]).map(([s, n]) => <li key={s} className="flex justify-between py-2 text-[13px]"><span>{s === DEFAULT_SOURCE ? 'Careers page' : s}</span><span className="tabular-nums font-semibold">{n}</span></li>)}</ul>
          )}
        </section>
      </div>
    </SidePanel>
  );
};

const Settings: React.FC<{ state: CareersState; busy: boolean; save: (patch: unknown) => void }> = ({ state, busy, save }) => {
  const [f, setF] = useState({ slug: state.page.slug, headline: state.page.headline, intro: state.page.intro, retentionMonths: state.page.retentionMonths });
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(f); }} className="grid gap-3 rounded-[12px] border border-[#e8e9ec] p-5 sm:grid-cols-2">
      <label className="block text-[13px] font-semibold">Page address<input value={f.slug} maxLength={40} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} onBlur={() => setF({ ...f, slug: toSlug(f.slug) })} className={field} /><span className="mt-1 block break-all text-xs font-normal text-[#5c626d]">{window.location.origin}{careersPath(toSlug(f.slug))}</span></label>
      <label className="block text-[13px] font-semibold">Keep applications for<select value={f.retentionMonths} onChange={(e) => setF({ ...f, retentionMonths: Number(e.target.value) })} className={field}>{RETENTION_CHOICES.map((m) => <option key={m} value={m}>{m} months</option>)}</select><span className="mt-1 block text-xs font-normal text-[#5c626d]">Applicants agree to this. Nothing is deleted on its own; older ones are listed below for you to delete.</span></label>
      <label className="block text-[13px] font-semibold sm:col-span-2">Headline<input value={f.headline} maxLength={120} placeholder={`Work at ${state.companyName}`} onChange={(e) => setF({ ...f, headline: e.target.value })} className={field} /></label>
      <label className="block text-[13px] font-semibold sm:col-span-2">Introduction<textarea rows={3} maxLength={1500} value={f.intro} onChange={(e) => setF({ ...f, intro: e.target.value })} className={field} /></label>
      <div className="sm:col-span-2"><button type="submit" disabled={busy} className={primary}>Save</button></div>
    </form>
  );
};

/** HR's side of the public careers page: publish it, choose the jobs, and get tracked links for job boards. */
export const CareersAdmin: React.FC = () => {
  const load = useLoad(() => careersAdminService.state(), []);
  const [fresh, setFresh] = useState<CareersState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [openId, setOpenId] = useState('');
  const state = fresh || load.data;
  if (!state) return <div className="p-6"><Loading loading={load.loading} error={load.error} /></div>;
  const { page, jobs } = state;
  const save = async (patch: unknown) => {
    setBusy(true); setError(''); setNote('');
    try { setFresh(await careersAdminService.save(patch)); setNote('Saved.'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const openJob = jobs.find((j) => j.id === openId);
  const hide = (id: string, hidden: boolean) => save({ hiddenJobs: hidden ? [...new Set([...page.hiddenJobs, id])] : page.hiddenJobs.filter((x) => x !== id) });

  return (
    <div className="w-full max-w-5xl space-y-6 p-4 sm:p-8">
      <section className="flex flex-wrap items-center gap-4">
        <Switch on={page.published} disabled={busy} label="Publish careers page" onChange={(published) => { if (!published || window.confirm('Publish the careers page? Anyone with the link will be able to see your open jobs and apply.')) void save({ published }); }} />
        <div className="min-w-0 flex-1 basis-64"><h2 className="text-lg font-semibold text-[#16181d]">Careers page is {page.published ? 'published' : 'not published'}</h2><p className="text-[13px] text-[#5c626d]">{state.total} application{state.total === 1 ? '' : 's'} received through it.</p></div>
        {page.published && <a href={careersPath(page.slug)} target="_blank" rel="noreferrer" className={ghost}><ExternalLink className="h-3.5 w-3.5" />Open page</a>}
      </section>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      {note && <p role="status" className="text-sm text-emerald-700">{note}</p>}

      <section>
        <h3 className="text-base font-semibold">Open jobs</h3>
        {jobs.length === 0 ? <p className="py-4 text-sm text-[#5c626d]">No job is open. A job appears here once its requisition is open.</p> : (
          <ul className="mt-2 divide-y divide-[#eef0f2] border-y border-[#eef0f2]">
            {jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1 basis-56"><p className="text-sm font-semibold">{j.title}</p><p className="text-[13px] text-[#5c626d]">{[j.department, j.location].filter(Boolean).join(' · ')}{j.hidden ? ' · hidden' : ''}</p></div>
                <span className="text-[13px] tabular-nums text-[#5c626d]">{Object.values(j.bySource).reduce((a, b) => a + b, 0)} applied</span>
                <button type="button" onClick={() => setOpenId(j.id)} className={ghost}>Job posting</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section><h3 className="mb-2 text-base font-semibold">Page settings</h3><Settings key={`${page.slug}-${page.retentionMonths}`} state={state} busy={busy} save={save} /></section>

      {state.pastRetention.length > 0 && (
        <section>
          <h3 className="text-base font-semibold">Past the keep-for period ({state.pastRetention.length})</h3>
          <p className="text-[13px] text-[#5c626d]">Delete these from Candidates → Applications unless you have a reason and consent to keep them.</p>
          <ul className="mt-2 divide-y divide-[#eef0f2] border-y border-[#eef0f2]">{state.pastRetention.map((a) => <li key={a.id} className="py-2 text-[13px]">{a.name} · {a.designation} · applied {a.createdAt.slice(0, 10)}</li>)}</ul>
        </section>
      )}
      {openJob && <JobPanel job={openJob} state={state} busy={busy} onHide={(h) => hide(openJob.id, h)} onClose={() => setOpenId('')} />}
    </div>
  );
};
