import { useCallback, useEffect, useState } from 'react';
import type { ResearchSystemPromptState } from '@shared/researchSystemPrompts';

export function useResearchSystemPrompts(conversationKey: string | null) {
  const [state, setState] = useState<ResearchSystemPromptState & { key: string | null | undefined; error: string }>({ prompts: [], selectedId: null, key: undefined, error: '' });
  useEffect(() => {
    let active = true;
    void window.nodus.getResearchSystemPrompts(conversationKey)
      .then(next => { if (active) setState({ ...next, key: conversationKey, error: '' }); })
      .catch(error => { if (active) setState({ prompts: [], selectedId: null, key: conversationKey, error: String(error) }); });
    return () => { active = false; };
  }, [conversationKey]);
  const refresh = useCallback(async () => {
    const next = await window.nodus.getResearchSystemPrompts(conversationKey);
    setState(previous => ({ ...next, key: conversationKey, error: '', selectedId: conversationKey ? next.selectedId : next.prompts.some(p => p.id === previous.selectedId) ? previous.selectedId : null }));
    return next;
  }, [conversationKey]);
  const select = async (id: string | null) => {
    if (conversationKey) await window.nodus.selectResearchSystemPrompt(conversationKey, id);
    setState(previous => ({ ...previous, selectedId: id, error: '' }));
  };
  return { prompts: state.prompts, selectedId: state.selectedId, selected: state.prompts.find(p => p.id === state.selectedId) ?? null,
    ready: state.key === conversationKey && !state.error, error: state.error, refresh, select };
}
