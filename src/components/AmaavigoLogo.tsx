import React from 'react';

interface AmaavigoLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'custom';
  variant?: 'full' | 'compact' | 'mark';
  theme?: 'light' | 'dark' | 'auto';
  height?: number | string;
  showTagline?: boolean;
  align?: 'left' | 'center';
}

export const AmaavigoLogo: React.FC<AmaavigoLogoProps> = ({
  className = '',
  size = 'md',
  variant = 'full',
  theme = 'light',
  height,
  showTagline = true,
  align = 'left',
}) => {
  // Dimensions based on size presets
  const sizeConfig = {
    sm: { width: 140, height: 32, markSize: 26 },
    md: { width: 185, height: 42, markSize: 34 },
    lg: { width: 230, height: 52, markSize: 42 },
    xl: { width: 290, height: 66, markSize: 54 },
    custom: { width: 200, height: 46, markSize: 38 },
  };

  const currentSize = sizeConfig[size] || sizeConfig.md;
  const textColor = theme === 'light' ? '#111827' : theme === 'dark' ? '#FFFFFF' : 'currentColor';
  const taglineColor = theme === 'light' ? '#64748B' : '#94A3B8';
  const orangeBrand = '#FA7014'; // Signature Amaavigo Orange

  // Compact Mark Only
  if (variant === 'mark') {
    const markDim = height || currentSize.markSize;
    return (
      <svg
        viewBox="0 0 44 44"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`inline-block shrink-0 ${className}`}
        style={{ height: markDim, width: markDim }}
        role="img"
        aria-label="Amaavigo Mark"
      >
        {/* Flight pip notch */}
        <rect x="2" y="3" width="9" height="9" rx="1.5" fill={orangeBrand} />
        {/* Bold O Ring */}
        <circle cx="24" cy="24" r="15" stroke={orangeBrand} strokeWidth="8" fill="none" />
      </svg>
    );
  }

  // Full or Compact logo: the official Amaavigo artwork (wordmark + "Where Brand takes Flight").
  // Files live in /public so the server-rendered landing pages can reference them by plain URL.
  const withTagline = showTagline && variant === 'full';
  const renderHeight = height || (withTagline ? currentSize.height : currentSize.height * 0.78);
  const isCentered = align === 'center';
  // The artwork has dark lettering, so on dark backgrounds it sits on a small white plate to stay readable.
  const plate = theme === 'dark' ? 'bg-white rounded-lg px-2.5 py-1.5' : '';

  return (
    <div className={`inline-flex select-none shrink-0 ${isCentered ? 'justify-center' : ''} ${plate} ${className}`}>
      <img
        src={withTagline ? '/amaavigo-logo.png' : '/amaavigo-logo-wordmark.png'}
        alt="Amaavigo - Where Brand takes Flight"
        width={165}
        height={withTagline ? 35 : 25}
        draggable={false}
        style={{ height: renderHeight, width: 'auto' }}
        className="shrink-0"
      />
    </div>
  );
};
