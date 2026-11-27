import React, { useEffect } from 'react';

/** A right-hand panel (bottom sheet on phones) with a fixed header and footer. Escape or a click outside closes it. */
export const SidePanel: React.FC<{ label: string; onClose: () => void; header: React.ReactNode; footer?: React.ReactNode; children: React.ReactNode }> = ({ label, onClose, header, footer, children }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="hx fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={label}>
      <div className="absolute inset-0 bg-[#16181d]/30" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[92vh] flex-col rounded-t-2xl bg-white shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[520px] sm:rounded-none">
        <div className="border-b border-[#e8e9ec] px-5 pt-4 pb-px">{header}</div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-[#e8e9ec] px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
};
