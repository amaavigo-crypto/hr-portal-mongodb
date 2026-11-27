import React from 'react';
import { flowService } from '../../services/flowService';
import { Loading, useLoad } from '../common/loadUi';
import { whenIst } from './when';

/** What the automation has done lately, newest first. */
export const AutomationActivity: React.FC = () => {
  const activity = useLoad(() => flowService.activity(100), []);
  if (activity.loading && !activity.data) return <Loading loading />;
  if (activity.error && !activity.data) return <Loading error={activity.error} />;
  const items = activity.data?.items || [];
  if (!items.length) return <p className="py-10 text-center text-sm text-[#5c626d]">Nothing has happened yet.</p>;
  return (
    <ol className="max-w-4xl divide-y divide-[#eef0f2] border-y border-[#eef0f2]">
      {items.map((a, i) => (
        <li key={i} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 py-3">
          <span className="min-w-0 flex-1 basis-80">
            <span className="block text-sm text-[#16181d]"><b className="font-semibold">{a.candidateName}</b>{a.designation ? ` · ${a.designation}` : ''}</span>
            <span className="block text-[13px] text-[#3d434d]">{a.text}</span>
            <span className="block text-xs text-[#5c626d]">{a.flowName} · {a.by}</span>
          </span>
          <span className="text-xs text-[#5c626d]">{whenIst(a.at)}</span>
        </li>
      ))}
    </ol>
  );
};
