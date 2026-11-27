import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, ExternalLink, Loader2, RotateCcw, Save, Search, Undo2 } from 'lucide-react';
import { landingApi } from '../services/adminService';
import {
  DEFAULT_TEXT,
  FIELDS,
  PAGES,
  SEO_DEFAULTS,
  seoKeyForPath,
  type ContentField,
  type SeoFields,
} from '../../shared/landingContent';

/**
 * Platform administrators edit every text on the public landing pages here, plus each page's search-engine title,
 * description and share-preview text. Saved wording appears on the live site within about a minute and is what
 * search engines read (the server puts it into the page HTML).
 */

type SeoKey = keyof Omit<SeoFields, 'noindex'>;
const SEO_FIELDS: { key: SeoKey; label: string; hint: string; max: number; multiline?: boolean }[] = [
  { key: 'title', label: 'Page title', hint: 'Shown as the blue link in Google results and on the browser tab. About 50–60 characters.', max: 60 },
  { key: 'description', label: 'Meta description', hint: 'The grey text under the title in search results. About 140–160 characters.', max: 160, multiline: true },
  { key: 'ogTitle', label: 'Share title', hint: 'Shown when the link is shared on WhatsApp, LinkedIn, Slack and similar.', max: 70 },
  { key: 'ogDescription', label: 'Share description', hint: 'The short text under the share title.', max: 200, multiline: true },
  { key: 'ogImage', label: 'Share image address (optional)', hint: 'A full web address (https://…) or a path on this site such as /share.png. About 1200 × 630 pixels works well.', max: 500 },
];

const emptySeo = (): Record<string, SeoFields> => JSON.parse(JSON.stringify(SEO_DEFAULTS));

export const LandingContentAdmin: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<'' | 'save' | 'undo'>('');
  const [page, setPage] = useState('home');
  const [query, setQuery] = useState('');

  // The saved state (what the live site uses) and the working copy (what is on screen).
  const [savedText, setSavedText] = useState<Record<string, string>>({ ...DEFAULT_TEXT });
  const [savedSeo, setSavedSeo] = useState<Record<string, SeoFields>>(emptySeo());
  const [text, setText] = useState<Record<string, string>>({ ...DEFAULT_TEXT });
  const [seo, setSeo] = useState<Record<string, SeoFields>>(emptySeo());
  const [meta, setMeta] = useState<{ updatedAt?: string | null; updatedBy?: string | null; canUndo?: boolean }>({});

  const apply = useCallback((r: { text: Record<string, string>; seo: Record<string, Partial<SeoFields>>; updatedAt?: string | null; updatedBy?: string | null; canUndo?: boolean }) => {
    const t = { ...DEFAULT_TEXT, ...r.text };
    const s = emptySeo();
    for (const [k, o] of Object.entries(r.seo || {})) if (s[k]) s[k] = { ...s[k], ...o } as SeoFields;
    setSavedText(t);
    setSavedSeo(JSON.parse(JSON.stringify(s)));
    setText(t);
    setSeo(s);
    setMeta({ updatedAt: r.updatedAt, updatedBy: r.updatedBy, canUndo: r.canUndo });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      apply(await landingApi.get());
    } catch (e: any) {
      setError(e?.message || 'Could not load the landing page wording.');
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    load();
  }, [load]);

  const textDirty = useMemo(() => Object.keys(DEFAULT_TEXT).filter((k) => (text[k] ?? '').trim() !== (savedText[k] ?? '').trim()), [text, savedText]);
  const seoDirty = useMemo(() => Object.keys(SEO_DEFAULTS).filter((k) => JSON.stringify(seo[k]) !== JSON.stringify(savedSeo[k])), [seo, savedSeo]);
  const dirtyCount = textDirty.length + seoDirty.length;

  useEffect(() => {
    if (!dirtyCount) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirtyCount]);

  const save = async () => {
    setBusy('save');
    setError('');
    setNotice('');
    try {
      const r = await landingApi.save({ text, seo });
      apply(r);
      setNotice('Saved. The live site shows this within about a minute.');
    } catch (e: any) {
      setError(e?.message || 'Could not save.');
    } finally {
      setBusy('');
    }
  };

  const undo = async () => {
    if (!window.confirm('Go back to the version saved before the latest one? Anything you have not saved will be lost.')) return;
    setBusy('undo');
    setError('');
    setNotice('');
    try {
      apply(await landingApi.undo());
      setNotice('Went back to the earlier version.');
    } catch (e: any) {
      setError(e?.message || 'Could not go back.');
    } finally {
      setBusy('');
    }
  };

  const discard = () => {
    setText({ ...savedText });
    setSeo(JSON.parse(JSON.stringify(savedSeo)));
  };

  const changedIn = (pageId: string) => {
    const p = PAGES.find((x) => x.id === pageId);
    let n = FIELDS.filter((f) => f.page === pageId && (text[f.key] ?? '').trim() !== DEFAULT_TEXT[f.key]).length;
    if (p?.path) {
      const k = seoKeyForPath(p.path)!;
      n += Object.keys(SEO_DEFAULTS[k]).filter((f) => (seo[k] as any)?.[f] !== (SEO_DEFAULTS[k] as any)[f]).length;
    }
    return n;
  };

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (q ? FIELDS.filter((f) => f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q) || (text[f.key] || '').toLowerCase().includes(q) || DEFAULT_TEXT[f.key].toLowerCase().includes(q)) : []),
    [q, text],
  );

  const current = PAGES.find((p) => p.id === page) || PAGES[0];
  const seoKey = current.path ? seoKeyForPath(current.path)! : null;

  const renderField = (f: ContentField) => {
    const value = text[f.key] ?? '';
    const isDefault = value.trim() === DEFAULT_TEXT[f.key];
    const unsaved = value.trim() !== (savedText[f.key] ?? '').trim();
    const rows = f.multiline ? Math.min(6, Math.max(2, Math.ceil(Math.max(value.length, DEFAULT_TEXT[f.key].length) / 90))) : 1;
    const common = {
      value,
      placeholder: DEFAULT_TEXT[f.key],
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => setText((t) => ({ ...t, [f.key]: e.target.value })),
      className: `w-full rounded-lg border px-3 py-2 text-sm text-slate-900 focus:border-[#6050D0] focus:outline-none focus:ring-2 focus:ring-brand-100 ${unsaved ? 'border-amber-300 bg-amber-50/40' : 'border-slate-300'}`,
    };
    return (
      <div key={f.key}>
        <div className="mb-1 flex items-center justify-between gap-2">
          <label className="text-xs font-bold text-slate-700">
            {f.label}
            {!isDefault && <span className="ml-2 rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold text-[#4C3EB0]">edited</span>}
            {unsaved && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">unsaved</span>}
          </label>
          {!isDefault && (
            <button type="button" onClick={() => setText((t) => ({ ...t, [f.key]: DEFAULT_TEXT[f.key] }))} className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-slate-800">
              <RotateCcw className="h-3 w-3" /> Use original wording
            </button>
          )}
        </div>
        {f.multiline ? <textarea rows={rows} {...common} /> : <input type="text" {...common} />}
      </div>
    );
  };

  const renderSections = (fields: ContentField[], showPage = false) => {
    const groups: { title: string; fields: ContentField[] }[] = [];
    for (const f of fields) {
      const title = showPage ? `${PAGES.find((p) => p.id === f.page)?.label || f.page}: ${f.section}` : f.section;
      let g = groups.find((x) => x.title === title);
      if (!g) groups.push((g = { title, fields: [] }));
      g.fields.push(f);
    }
    return groups.map((g) => (
      <section key={g.title} className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-black text-slate-900">{g.title}</h3>
        <div className="space-y-3">{g.fields.map((f) => renderField(f))}</div>
      </section>
    ));
  };

  const renderSeo = (k: string) => {
    const s = seo[k];
    const base = SEO_DEFAULTS[k];
    const url = `${window.location.origin}${current.path === '/' ? '' : current.path}`;
    return (
      <section key={`seo-${k}`} className="rounded-2xl border border-brand-200 bg-white p-4">
        <h3 className="text-sm font-black text-slate-900">Search engines and sharing</h3>
        <p className="mb-3 text-xs text-slate-500">This is what Google, WhatsApp, LinkedIn and other sites read about this page.</p>
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="truncate text-xs text-slate-500">{url}</div>
          <div className="truncate text-base font-medium text-[#1a0dab]">{s.title || base.title}</div>
          <div className="line-clamp-2 text-sm text-slate-600">{s.description || base.description}</div>
        </div>
        <div className="space-y-3">
          {SEO_FIELDS.map((f) => {
            const value = s[f.key] ?? '';
            const unsaved = value !== (savedSeo[k]?.[f.key] ?? '');
            const over = f.max && value.length > f.max && (f.key === 'title' || f.key === 'description');
            const common = {
              value,
              placeholder: base[f.key] || (f.key === 'ogImage' ? 'None: link previews show no picture' : ''),
              onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => setSeo((all) => ({ ...all, [k]: { ...all[k], [f.key]: e.target.value } })),
              className: `w-full rounded-lg border px-3 py-2 text-sm text-slate-900 focus:border-[#6050D0] focus:outline-none focus:ring-2 focus:ring-brand-100 ${unsaved ? 'border-amber-300 bg-amber-50/40' : 'border-slate-300'}`,
            };
            return (
              <div key={f.key}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="text-xs font-bold text-slate-700">{f.label}{unsaved && <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">unsaved</span>}</label>
                  <span className={`text-[11px] font-semibold ${over ? 'text-rose-600' : 'text-slate-400'}`}>{value.length}{f.key === 'title' || f.key === 'description' ? ` / ${f.max}` : ''}</span>
                </div>
                {f.multiline ? <textarea rows={2} {...common} /> : <input type="text" {...common} />}
                <p className="mt-1 text-[11px] text-slate-400">{f.hint}</p>
              </div>
            );
          })}
          <label className="flex items-start gap-2 text-xs font-semibold text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={!!s.noindex} onChange={(e) => setSeo((all) => ({ ...all, [k]: { ...all[k], noindex: e.target.checked } }))} />
            <span>Ask search engines not to list this page<span className="block font-normal text-slate-400">The page stays reachable by its address, but is left out of the sitemap.</span></span>
          </label>
        </div>
      </section>
    );
  };

  if (loading) return <div className="flex justify-center p-10 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">Landing page</h1>
        <p className="text-sm text-slate-500">
          Every text on the public site, and the title and description search engines show for each page.
          {meta.updatedAt && <> Last saved {new Date(meta.updatedAt).toLocaleString()}{meta.updatedBy ? ` by ${meta.updatedBy}` : ''}.</>}
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
        <b className="text-slate-800">Tips.</b> Put *stars* around words to show them in the highlight colour, like <code>Less chasing. More *doing.*</code>.
        Leave {'{name}'}, {'{year}'} and {'{rotor}'} as they are: the site fills them in. Clearing a field brings back the original wording.
        The numbers, names and amounts inside the sample screens are examples and stay fixed; their labels and captions can be edited.
      </div>

      {error && <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}</div>}
      {notice && <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-700"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {notice}</div>}

      <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white/95 p-2.5 backdrop-blur">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find any text on the site…" className="w-full rounded-lg border border-slate-300 py-2 pl-8 pr-3 text-sm focus:border-[#6050D0] focus:outline-none focus:ring-2 focus:ring-brand-100" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">{dirtyCount ? `${dirtyCount} unsaved change${dirtyCount === 1 ? '' : 's'}` : 'All changes saved'}</span>
          {meta.canUndo && (
            <button onClick={undo} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              {busy === 'undo' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />} Undo last save
            </button>
          )}
          <button onClick={discard} disabled={!dirtyCount || !!busy} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Discard</button>
          <button onClick={save} disabled={!dirtyCount || !!busy} className="inline-flex items-center gap-1.5 rounded-lg bg-[#6050D0] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#5243BE] disabled:opacity-50">
            {busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save changes
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <nav className="space-y-0.5 self-start rounded-2xl border border-slate-200 bg-white p-2 lg:sticky lg:top-20" aria-label="Pages">
          {PAGES.map((p) => {
            const n = changedIn(p.id);
            return (
              <button
                key={p.id}
                onClick={() => { setPage(p.id); setQuery(''); }}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold ${!q && page === p.id ? 'bg-brand-50 text-[#4C3EB0]' : 'text-slate-700 hover:bg-slate-50'}`}
              >
                <span className="truncate">{p.label}</span>
                {n > 0 && <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{n}</span>}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 space-y-4">
          {q ? (
            <>
              <div className="text-xs font-semibold text-slate-500">{matches.length} text{matches.length === 1 ? '' : 's'} found</div>
              {matches.length ? renderSections(matches, true) : <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400">Nothing matches “{query}”.</div>}
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-black text-slate-900">{current.label}</h2>
                  {current.note && <p className="text-xs text-slate-500">{current.note}</p>}
                </div>
                {current.path && (
                  <a href={current.path} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                    View page <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
              {seoKey && renderSeo(seoKey)}
              {renderSections(FIELDS.filter((f) => f.page === page))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default LandingContentAdmin;
