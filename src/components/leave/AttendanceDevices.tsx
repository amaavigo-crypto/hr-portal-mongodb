import React, { useCallback, useEffect, useState } from 'react';
import { leaveService } from '../../services/leaveService';
import { Card, Field, Notice, btnDanger, btnGhost, btnPrimary, input, useRunner } from './ui';

/** Bring punches in from a biometric device or a CSV export, and manage the API keys devices use. */
export const AttendanceDevices: React.FC = () => {
  const [keys, setKeys] = useState<any[]>([]);
  const [label, setLabel] = useState('');
  const [fresh, setFresh] = useState('');
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<any | null>(null);
  const { busy, note, run } = useRunner();
  const load = useCallback(() => leaveService.attendanceKeys().then((r: any) => setKeys(r.items)).catch(() => undefined), []);
  useEffect(() => { load(); }, [load]);
  const endpoint = `${window.location.origin}/api/leave/attendance-ingest`;

  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      <Card title="Import a CSV of punches" subtitle="Columns: Employee ID, Date Time (and optionally Direction IN/OUT). Without a direction, punches of a day are paired in order: in, out, in, out. Importing the same file twice changes nothing.">
        <input type="file" accept=".csv,text/csv" className="text-xs mb-2" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
        <textarea className={input + ' h-28 font-mono text-xs'} placeholder={'Employee ID,Date Time,Direction\nE001,2026-11-03 09:12,IN\nE001,2026-11-03 18:05,OUT'} value={csv} onChange={(e) => setCsv(e.target.value)} />
        <div className="mt-2"><button className={btnPrimary} disabled={busy || !csv.trim()} onClick={() => run(async () => { setResult(await leaveService.attendanceImport(csv)); })}>Import</button></div>
        {result && (
          <div className="mt-3 text-xs text-slate-700 space-y-1">
            <p>{result.added} punches added on {result.daysUpdated} days. {result.ignored} were already there or ignored.</p>
            {result.unknownEmployees.length > 0 && <Notice tone="warn">No employee with ID: {result.unknownEmployees.join(', ')}</Notice>}
            {result.problems.length > 0 && <Notice tone="warn"><ul className="list-disc pl-4">{result.problems.map((p: string) => <li key={p}>{p}</li>)}</ul></Notice>}
          </div>
        )}
      </Card>

      <Card title="Device and script access" subtitle="A device or gateway can post punches as they happen, using a key instead of a login.">
        <div className="flex gap-2 items-end mb-3">
          <Field label="Key name"><input className={input} placeholder="Head office turnstile" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
          <button className={btnPrimary} disabled={busy || !label.trim()} onClick={() => run(async () => { const r = await leaveService.createAttendanceKey(label); setFresh(r.key); setLabel(''); await load(); })}>Create key</button>
        </div>
        {fresh && <Notice tone="ok">Copy this key now, it is not shown again: <code className="font-mono break-all">{fresh}</code></Notice>}
        <table className="text-xs w-full mt-2">
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className="border-t border-slate-100">
                <td className="p-1.5 font-semibold">{k.label}</td><td className="p-1.5 font-mono text-slate-500">{k.prefix}…</td>
                <td className="p-1.5 text-slate-500">{k.active ? (k.lastUsedAt ? `last used ${k.lastUsedAt.slice(0, 10)}` : 'never used') : 'revoked'}</td>
                <td className="p-1.5 text-right">{k.active && <button className={btnDanger} disabled={busy} onClick={() => run(async () => { await leaveService.revokeAttendanceKey(k.id); await load(); })}>Revoke</button>}</td>
              </tr>
            ))}
            {keys.length === 0 && <tr><td className="p-3 text-slate-400">No keys yet.</td></tr>}
          </tbody>
        </table>
        <div className="mt-3 text-[11px] text-slate-500">
          <p className="font-semibold">How a device posts punches</p>
          <pre className="bg-slate-50 border border-slate-200 rounded-lg p-2 overflow-x-auto">{`POST ${endpoint}\nx-api-key: atk_...\n{"logs":[{"empId":"E001","time":"2026-11-03T09:12:00+05:30","direction":"IN"}]}`}</pre>
          <button className={btnGhost + ' mt-2'} onClick={() => navigator.clipboard?.writeText(endpoint)}>Copy address</button>
        </div>
      </Card>
    </div>
  );
};
