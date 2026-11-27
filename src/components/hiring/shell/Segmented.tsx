import React from 'react';

export interface SegmentOption<T extends string> { value: T; label: string; badge?: number }

/** The grey "pill" switch used to move between views inside a hiring tab. */
export function Segmented<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: SegmentOption<T>[] }) {
  return (
    <div className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-[#f1f2f4] p-[3px]" role="tablist" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="tab" aria-selected={on} onClick={() => onChange(o.value)}
            className={`inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[13px] ${on ? 'bg-white font-semibold text-[#16181d] shadow-sm' : 'font-medium text-[#555b66] hover:text-[#16181d]'}`}>
            {o.label}
            {!!o.badge && <span className="rounded-full bg-[#fdeceb] px-1.5 text-[11px] font-semibold text-[#b42318]">{o.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
