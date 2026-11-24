import React from 'react';

/** Shows a stored photo or PDF. PDFs open in the browser's own viewer. */
export const isPdfUrl = (src: string | null | undefined) => !!src && src.startsWith('data:application/pdf');

export const FilePreview: React.FC<{ src: string; title: string }> = ({ src, title }) =>
  isPdfUrl(src)
    ? <iframe title={title} src={src} className="w-full h-[85vh] rounded-lg bg-white" />
    : <img src={src} alt={title} className="w-full max-h-[85vh] object-contain rounded-lg bg-white" />;
