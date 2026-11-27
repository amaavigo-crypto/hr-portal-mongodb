import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Search } from 'lucide-react';
import { MAX_RESUME_BYTES } from '../../shared/careers';

interface Job { id: string; title: string; department: string; location: string; employmentType: string; workMode: string; experience: string; description: string }
interface Page { companyName: string; logo: string; headline: string; intro: string; jobs: Job[]; consent: string; formToken: string }

/** Plain requests: this page is public, so no sign-in is attached. */
async function call<T>(url: string, body?: unknown): Promise<T> {
  let res: Response;
  try { res = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined); }
  catch { throw new Error('Could not reach the server. Check your connection and try again.'); }
  if (res.status === 413) throw new Error('That file is too large to send. Please attach a smaller resume.');
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(data?.error || 'Something went wrong. Please try again.');
  return data as T;
}

const readBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
  r.onerror = () => reject(new Error('Could not read that file.'));
  r.readAsDataURL(file);
});

const meta = (j: Job) => [j.department, j.location, j.workMode, j.employmentType, j.experience].filter(Boolean).join(' · ');
const input = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base outline-none focus:border-[#4C3EB0] sm:text-sm';

const ApplyForm: React.FC<{ page: Page; job: Job; slug: string; source: string }> = ({ page, job, slug, source }) => {
  const [f, setF] = useState({ name: '', email: '', phone: '', expectedCtcLpa: '', website: '', consent: false });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: k === 'consent' ? e.target.checked : e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    if (!file) return setError('Attach your resume as a PDF or Word (.docx) file.');
    if (file.size > MAX_RESUME_BYTES) return setError('The resume must be 5 MB or smaller.');
    setBusy(true);
    try {
      const out = await call<{ message: string }>('/api/recruitment/careers-public-apply', { ...f, slug, jobId: job.id, source, formToken: page.formToken, resume: { name: file.name, data: await readBase64(file) } });
      setDone(out.message);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  if (done) return <div role="status" className="flex items-start gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-5 text-emerald-900"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /><p className="text-sm font-semibold">{done}</p></div>;
  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-bold text-slate-900">Apply for this role</h2>
      <label className="block text-sm font-semibold text-slate-800">Full name<input required maxLength={120} autoComplete="name" value={f.name} onChange={set('name')} className={input} /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-semibold text-slate-800">Email<input required type="email" maxLength={200} autoComplete="email" value={f.email} onChange={set('email')} className={input} /></label>
        <label className="block text-sm font-semibold text-slate-800">Phone<input required type="tel" maxLength={30} autoComplete="tel" value={f.phone} onChange={set('phone')} className={input} /></label>
      </div>
      <label className="block text-sm font-semibold text-slate-800">Expected salary (₹ lakhs per year)<input required type="number" inputMode="decimal" min="0.1" max="1000" step="0.01" value={f.expectedCtcLpa} onChange={set('expectedCtcLpa')} className={input} /></label>
      <label className="block text-sm font-semibold text-slate-800">Resume (PDF or .docx, up to 5 MB)<input required type="file" accept=".pdf,.docx" onChange={(e) => setFile(e.target.files?.[0] || null)} className="mt-1 block w-full text-sm font-normal file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-[#efedfa] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[#3F3393]" /></label>
      {/* Left empty by people. Form-filling robots complete it. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden"><label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></label></div>
      <label className="flex items-start gap-2.5 text-sm text-slate-700"><input required type="checkbox" checked={f.consent} onChange={set('consent')} className="mt-1 h-4 w-4 shrink-0 accent-[#4C3EB0]" /><span>{page.consent}</span></label>
      {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <button type="submit" disabled={busy} className="w-full cursor-pointer rounded-lg bg-[#4C3EB0] px-4 py-3 text-sm font-bold text-white hover:bg-[#3F3393] disabled:opacity-60 sm:w-auto sm:px-8">{busy ? 'Sending…' : 'Submit application'}</button>
    </form>
  );
};

/** A company's public careers page (/?careers=<address>). Applicants need no account. */
export const CareersPublicPage: React.FC = () => {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const slug = params.get('careers') || '';
  const source = params.get('src') || '';
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(params.get('job') || '');
  const [q, setQ] = useState('');
  useEffect(() => { call<Page>(`/api/recruitment/careers-public-get?slug=${encodeURIComponent(slug)}`).then((p) => { setPage(p); document.title = `Careers at ${p.companyName}`; }).catch((e: Error) => setError(e.message)); }, [slug]);
  const job = page?.jobs.find((j) => j.id === open);
  const shown = (page?.jobs || []).filter((j) => !q || `${j.title} ${meta(j)}`.toLowerCase().includes(q.toLowerCase()));
  const show = (id: string) => { setOpen(id); window.scrollTo(0, 0); };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:py-10">
      <main className="mx-auto max-w-2xl space-y-4">
        {error && <p role="alert" className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700">{error}</p>}
        {!page && !error && <p className="text-sm text-slate-500">Loading…</p>}
        {page && (
          <>
            <header className="flex items-center gap-3">
              {page.logo && <img src={page.logo} alt="" className="h-11 max-w-[140px] object-contain" />}
              <div><p className="text-lg font-bold text-slate-900">{page.companyName}</p><p className="text-sm text-slate-500">Careers</p></div>
            </header>
            {open && !job && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">That role is no longer open. Here are the current ones.</p>}
            {job ? (
              <>
                <button type="button" onClick={() => show('')} className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-[#3F3393]"><ArrowLeft className="h-4 w-4" />All open roles</button>
                <section className="rounded-2xl border border-slate-200 bg-white p-5">
                  <h1 className="text-2xl font-bold text-slate-900">{job.title}</h1>
                  {meta(job) && <p className="mt-1 text-sm text-slate-600">{meta(job)}</p>}
                  {job.description && <div className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{job.description}</div>}
                </section>
                <ApplyForm key={job.id} page={page} job={job} slug={slug} source={source} />
              </>
            ) : (
              <>
                <section><h1 className="text-2xl font-bold text-slate-900">{page.headline || `Work at ${page.companyName}`}</h1>{page.intro && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{page.intro}</p>}</section>
                {page.jobs.length > 0 && <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search roles" aria-label="Search roles" className={`${input} !mt-0 !pl-9`} /></div>}
                {shown.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">{page.jobs.length ? 'No roles match your search.' : 'There are no open roles right now. Please check again later.'}</p> : (
                  <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    {shown.map((j) => (
                      <li key={j.id}><button type="button" onClick={() => show(j.id)} className="flex w-full cursor-pointer items-center justify-between gap-3 px-5 py-4 text-left hover:bg-slate-50">
                        <span className="min-w-0"><span className="block font-semibold text-slate-900">{j.title}</span><span className="block text-sm text-slate-500">{meta(j)}</span></span>
                        <span className="shrink-0 text-sm font-semibold text-[#3F3393]">View and apply</span>
                      </button></li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
};
