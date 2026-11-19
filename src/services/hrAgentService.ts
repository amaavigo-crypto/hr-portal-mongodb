import { apiJson } from './apiClient';

export interface HrAgentReply { success: boolean; id: string; answer: string; tools: string[]; unsure: boolean; off?: boolean; limited?: boolean; error?: string }
export interface HrAgentStatus { success: boolean; enabled: boolean; available: boolean; modules: string[]; tools: string[] }
export interface HrAgentHistoryItem { id: string; question: string; answer: string; tools: string[]; createdAt: string }

/** HR Agent calls (HR roles only). Server side: api/_lib/hrAgentApi.ts, served under /api/assistant. */
export const hrAgentService = {
  status: () => apiJson<HrAgentStatus>('/api/assistant/agent-status'),
  chat: (question: string, history: { role: 'user' | 'assistant'; content: string }[]) => apiJson<HrAgentReply>('/api/assistant/agent-chat', { question, history }),
  history: () => apiJson<{ success: boolean; items: HrAgentHistoryItem[] }>('/api/assistant/agent-history'),
};
