// Expected public API contracts, independently specified from the implementation.
// Sources and audit date: docs/research-assistant-reasoning.md.
export const researchOpenAiModels = [
  { models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'], levels: [] },
  { models: ['o1', 'o3', 'o3-mini', 'o4-mini'], levels: ['low', 'medium', 'high'] },
  { models: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-2025-08-07'], levels: ['minimal', 'low', 'medium', 'high'] },
  { models: ['gpt-5.1'], levels: ['none', 'low', 'medium', 'high'] },
  { models: ['gpt-5.2', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.5'], levels: ['none', 'low', 'medium', 'high', 'xhigh'] },
  { models: ['gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'], levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] },
  { models: ['gpt-6-astra'], levels: ['low', 'medium', 'high', 'xhigh', 'max'] },
].flatMap(({ models, levels }) => models.map(model => ({ model, levels })));
