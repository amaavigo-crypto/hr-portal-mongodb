/**
 * Kept so older imports keep working. Everything now lives in ./ai (the shared AI layer): see ai/index.ts.
 */
export { aiKey, aiEnabled, aiJson, aiText, aiChat, aiUsage, reserveAiCall, monthlyCap, monthlyBudgetUsd, modelFor, s, validate } from './ai/index.js';
export type { Part, AiResult, Schema, UsageSummary } from './ai/index.js';
