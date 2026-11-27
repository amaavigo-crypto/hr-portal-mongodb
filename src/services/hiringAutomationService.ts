import { apiJson } from './apiClient';
import type { FollowUpRuleId, FollowUpSettings } from '../../shared/followUps';
import type { QuickRuleInput } from '../../shared/quickRules';

const base = '/api/recruitment/';
const post = <T = any>(a: string, body: unknown = {}) => apiJson<T>(`${base}${a}`, body);
const get = <T = any>(a: string) => apiJson<T>(`${base}${a}`);

export interface FollowUpState {
  settings: FollowUpSettings & { updatedBy?: string; updatedAt?: string };
  next: { ruleId: FollowUpRuleId; candidateName: string; toName: string; why: string; subject: string; body: string }[];
  waitingCount: number;
  recent: { at: string; toName: string; candidateName: string; why: string; status: string; error: string }[];
  workingHours: string; workingTime: boolean;
}
export const followUpService = {
  state: () => get<FollowUpState>('followup-state'),
  save: (patch: unknown) => post<FollowUpState>('followup-save', patch),
};

export interface QuickRuleRow extends QuickRuleInput { id: string; status: 'DRAFT' | 'ON' | 'OFF'; updatedBy: string; runs: number }
export interface QuickRuleState {
  rules: QuickRuleRow[]; people: { uid: string; name: string }[];
  recent: { at: string; ruleName: string; candidateName: string; results: string[]; ok: boolean }[];
}
export interface QuickRuleTest { checked: number; matched: number; unknown: number; examples: { candidateName: string; designation: string }[]; wouldDo: string[] }
export const quickRuleService = {
  list: () => get<QuickRuleState>('qrule-list'),
  save: (rule: QuickRuleInput & { id?: string; turnOn?: boolean }) => post<{ id: string }>('qrule-save', rule),
  test: (rule: QuickRuleInput) => post<QuickRuleTest>('qrule-test', rule),
  switch: (id: string, on: boolean) => post('qrule-switch', { id, on }),
  remove: (id: string) => post('qrule-delete', { id }),
};

export interface CareersJob {
  id: string; title: string; department: string; location: string; employmentType: string; workMode: string; experience: string; description: string;
  hidden: boolean; bySource: Record<string, number>;
}
export interface CareersState {
  page: { published: boolean; slug: string; headline: string; intro: string; retentionMonths: number; hiddenJobs: string[]; updatedBy?: string };
  companyName: string; jobs: CareersJob[]; total: number;
  pastRetention: { id: string; name: string; designation: string; createdAt: string }[];
}
export const careersAdminService = {
  state: () => get<CareersState>('careers-state'),
  save: (patch: unknown) => post<CareersState>('careers-save', patch),
};
