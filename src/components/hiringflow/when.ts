import { niceDate } from '../leave/ui';

export const whenIst = (iso?: string) => (iso ? `${niceDate(iso.slice(0, 10))}, ${new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' })}` : '—');
