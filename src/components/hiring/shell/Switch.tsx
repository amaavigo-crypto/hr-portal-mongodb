import React from 'react';

/** On / off switch, with a name for screen readers. */
export const Switch: React.FC<{ on: boolean; label: string; onChange: (on: boolean) => void; disabled?: boolean }> = ({ on, label, onChange, disabled }) => (
  <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
    className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors disabled:cursor-default disabled:opacity-50 ${on ? 'bg-[#4C3EB0]' : 'bg-[#c9ccd2]'}`}>
    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
  </button>
);
