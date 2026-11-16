import {
  BellRing,
  Briefcase,
  CalendarCheck,
  CalendarClock,
  ClipboardCheck,
  FileClock,
  FileText,
  GitBranch,
  IndianRupee,
  KanbanSquare,
  LayoutList,
  LineChart,
  ListChecks,
  Mail,
  Network,
  Paperclip,
  Receipt,
  ScrollText,
  Target,
  UserPlus,
  Users,
  Video,
  Wallet,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { useMemo } from 'react';
import { FAQ_COUNT } from '../../shared/landingContent';
import type { ModuleKey } from './routes';
import { useT } from './content';

export type IconType = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
export type Tone = 'violet' | 'green' | 'amber' | 'blue' | 'rose' | 'teal' | 'slate';

export interface Highlight {
  icon: IconType;
  title: string;
  text: string;
}

export interface ModuleDef {
  key: ModuleKey;
  tone: Tone;
  icon: IconType;
  name: string;
  short: string;
  tagline: string;
  headline: string;
  intro: string;
  points: string[];
  highlights: Highlight[];
  steps: { title: string; text: string }[];
}

/**
 * What stays in code for each module: its order, colour and icons. All wording (name, headline, points,
 * highlight cards, steps) lives in shared/landingContent.ts and can be changed from the admin screen.
 */
export const MODULE_META: { key: ModuleKey; tone: Tone; icon: IconType; highlightIcons: IconType[] }[] = [
  { key: 'hiring', tone: 'violet', icon: Briefcase, highlightIcons: [ClipboardCheck, LineChart, Video, Mail] },
  { key: 'leave', tone: 'green', icon: CalendarCheck, highlightIcons: [CalendarClock, Users, ListChecks, FileClock] },
  { key: 'payroll', tone: 'amber', icon: IndianRupee, highlightIcons: [Wallet, Receipt, LineChart, FileText] },
  { key: 'performance', tone: 'rose', icon: Target, highlightIcons: [Target, ClipboardCheck, ListChecks, LineChart] },
  { key: 'people', tone: 'blue', icon: Network, highlightIcons: [Users, Network, UserPlus, BellRing] },
  { key: 'policies', tone: 'teal', icon: ScrollText, highlightIcons: [GitBranch, ClipboardCheck, Users, FileClock] },
  { key: 'tasks', tone: 'slate', icon: KanbanSquare, highlightIcons: [KanbanSquare, Users, Paperclip, LayoutList] },
];

/** All modules with their current wording. */
export function useModules(): ModuleDef[] {
  const t = useT();
  return useMemo(
    () =>
      MODULE_META.map((m) => {
        const k = `mod.${m.key}`;
        return {
          key: m.key,
          tone: m.tone,
          icon: m.icon,
          name: t(`${k}.name`),
          short: t(`${k}.short`),
          tagline: t(`${k}.tagline`),
          headline: t(`${k}.headline`),
          intro: t(`${k}.intro`),
          points: [1, 2, 3, 4].map((i) => t(`${k}.point.${i}`)),
          highlights: m.highlightIcons.map((icon, i) => ({ icon, title: t(`${k}.highlight.${i + 1}.title`), text: t(`${k}.highlight.${i + 1}.text`) })),
          steps: [1, 2, 3, 4].map((i) => ({ title: t(`${k}.step.${i}.title`), text: t(`${k}.step.${i}.text`) })),
        };
      }),
    [t],
  );
}

export function useModule(key: ModuleKey): ModuleDef {
  const modules = useModules();
  return modules.find((m) => m.key === key) || modules[0];
}

export function useFaqs(): { q: string; a: string }[] {
  const t = useT();
  return useMemo(() => Array.from({ length: FAQ_COUNT }, (_, i) => ({ q: t(`faq.${i + 1}.q`), a: t(`faq.${i + 1}.a`) })), [t]);
}

export function useStats(): { value: number; suffix: string; label: string }[] {
  const t = useT();
  return useMemo(
    () =>
      [1, 2, 3, 4].map((i) => {
        const n = Number(String(t(`home.stats.${i}.value`)).replace(/[^0-9.]/g, ''));
        return { value: Number.isFinite(n) ? n : 0, suffix: t(`home.stats.${i}.suffix`), label: t(`home.stats.${i}.label`) };
      }),
    [t],
  );
}
