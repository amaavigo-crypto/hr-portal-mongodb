import { apiJson } from './apiClient';
import type { ProposalCard } from '../../shared/leaveAgentTools';

export interface AssistantSource { kind: 'data' | 'policy'; label: string }
export type { ProposalCard };
export interface AssistantReply { success: boolean; id: string; answer: string; sources: AssistantSource[]; unsure: boolean; proposals?: ProposalCard[]; off?: boolean; limited?: boolean; error?: string }
export interface ProposalResult { success: boolean; status: 'DONE' | 'FAILED' | 'EXPIRED' | 'DISMISSED' | string; message?: string; error?: string }

/** Ask HR calls. Server side: api/_lib/assistantApi.ts. */
export const assistantService = {
  ask: (question: string, history: { role: 'user' | 'assistant'; content: string }[]) => apiJson<AssistantReply>('/api/assistant/ask', { question, history }),
  feedback: (id: string, helpful: boolean) => apiJson('/api/assistant/feedback', { id, helpful }),
  askHr: (question: string, id?: string) => apiJson<{ success: boolean; sent: boolean; message: string; error?: string }>('/api/assistant/ask-hr', { question, id }),
  /** The person's own click on a card: runs the prepared action once. */
  confirm: (id: string) => apiJson<ProposalResult>('/api/assistant/confirm', { id }),
  dismiss: (id: string) => apiJson<ProposalResult>('/api/assistant/dismiss', { id }),
};
