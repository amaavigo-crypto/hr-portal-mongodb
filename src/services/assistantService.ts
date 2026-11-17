import { apiJson } from './apiClient';

export interface AssistantSource { kind: 'data' | 'policy'; label: string }
export interface AssistantQuote { id: string; title: string; version: string; text: string }
export interface AssistantReply { success: boolean; id: string; answer: string; sources: AssistantSource[]; quotes?: AssistantQuote[]; unsure: boolean; off?: boolean; limited?: boolean; error?: string }

/** Ask HR calls. Server side: api/_lib/assistantApi.ts. */
export const assistantService = {
  ask: (question: string, history: { role: 'user' | 'assistant'; content: string }[]) => apiJson<AssistantReply>('/api/assistant/ask', { question, history }),
  feedback: (id: string, helpful: boolean) => apiJson('/api/assistant/feedback', { id, helpful }),
  askHr: (question: string, id?: string) => apiJson<{ success: boolean; sent: boolean; message: string; error?: string }>('/api/assistant/ask-hr', { question, id }),
  status: () => apiJson<{ success: boolean; enabled: boolean }>('/api/assistant/status'),
  /** Policy writers: a plain-words draft of what changed. Server side: api/_lib/policyAiApi.ts. */
  policySummary: (documentMasterId: string, newText: string) => apiJson<{ success: boolean; off?: boolean; firstVersion?: boolean; unchanged?: boolean; summary?: string; source?: 'AI' | 'BASIC' }>('/api/assistant/policy-summary', { documentMasterId, newText }),
  /** Approvers: possible clashes with other published policies and labour-law reference points. Advisory only. */
  policyClash: (versionId: string) => apiJson<PolicyClashResult>('/api/assistant/policy-clash', { versionId }),
};

export interface PolicyClashFinding {
  type: 'POLICY' | 'LAW'; issue: string; thisText: string;
  other?: { title: string; version: string; text: string };
  law?: { topic: string; act: string; point: string };
}
export interface PolicyClashResult { success: boolean; off?: boolean; empty?: boolean; findings: PolicyClashFinding[]; checked: { policies: number; lawPoints: number }; lawReviewed: string; note: string }
