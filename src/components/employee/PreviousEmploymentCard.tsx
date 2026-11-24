import React, { useEffect, useState } from 'react';
import { orgService, type PreviousEmployment } from '../../services/orgService';
import { Card } from '../leave/ui';

/** Shown to HR on a transferred person's profile: their earlier time in another organisation of the same account (read-only, no payroll). */
export const PreviousEmploymentCard: React.FC<{ uid?: string }> = ({ uid }) => {
  const [rows, setRows] = useState<PreviousEmployment[]>([]);
  useEffect(() => {
    setRows([]);
    if (!uid) return;
    let live = true;
    orgService.previousEmployment(uid).then((d) => { if (live) setRows(d.employments); }).catch(() => { /* not allowed or nothing to show */ });
    return () => { live = false; };
  }, [uid]);
  if (!rows.length) return null;
  return (
    <div className="space-y-3 mt-4">
      {rows.map((e, i) => (
        <Card key={i} title={`Previously at ${e.organisation}`} subtitle={`Code ${e.empId} · moved on ${e.until} · read-only`}>
          <div className="grid gap-4 md:grid-cols-2 text-sm">
            <div>
              <h4 className="text-xs font-bold text-slate-600 mb-1">Leave taken ({e.leave.length})</h4>
              {e.leave.length ? <ul className="space-y-0.5 max-h-48 overflow-y-auto">{e.leave.map((l, j) => <li key={j}>{l.type} · {l.from}{l.to !== l.from ? ` to ${l.to}` : ''} · {l.days} day(s) · <span className="text-slate-500">{l.status.toLowerCase()}</span></li>)}</ul> : <p className="text-slate-500">None recorded.</p>}
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-600 mb-1">Recent changes</h4>
              {e.audit.length ? <ul className="space-y-0.5 max-h-48 overflow-y-auto">{e.audit.map((a, j) => <li key={j}>{a.action.replace(/_/g, ' ').toLowerCase()} · <span className="text-slate-500">{a.at.slice(0, 10)} by {a.by}</span></li>)}</ul> : <p className="text-slate-500">Nothing recorded.</p>}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
};
