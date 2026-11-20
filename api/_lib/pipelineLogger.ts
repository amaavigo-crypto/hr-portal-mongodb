import { randomUUID } from 'node:crypto';

export type PipelineLogStatus = 'START' | 'SUCCESS' | 'SKIP' | 'WARN' | 'ERROR';

/**
 * Structured server logs for tracing document ingestion, embeddings, retrieval and Ask HR.
 * Never pass API keys, raw document text, prompts, answers, emails or other sensitive payloads.
 */
export const createPipelineTraceId = (prefix = 'hr-ai'): string => `${prefix}-${randomUUID()}`;

export function pipelineLog(
  traceId: string,
  event: string,
  status: PipelineLogStatus,
  details: Record<string, unknown> = {},
): void {
  const entry = {
    timestamp: new Date().toISOString(),
    service: 'hr-document-ai',
    traceId,
    event,
    status,
    ...details,
  };
  const line = `[HR_AI_PIPELINE] ${JSON.stringify(entry)}`;
  if (status === 'ERROR') console.error(line);
  else if (status === 'WARN' || status === 'SKIP') console.warn(line);
  else console.info(line);
}

export function pipelineErrorDetails(error: unknown): { errorName: string; errorMessage: string; errorStack?: string } {
  const err = error instanceof Error ? error : new Error(String(error));
  return {
    errorName: err.name || 'Error',
    errorMessage: err.message || 'Unknown error',
    ...(err.stack ? { errorStack: err.stack.split('\n').slice(0, 5).join('\n') } : {}),
  };
}
