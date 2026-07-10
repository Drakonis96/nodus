import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSettings, ModelRef } from '@shared/types';

export type FeatureModelSettingKey =
  | 'chatModel'
  | 'deepResearchModel'
  | 'immersionModel'
  | 'writingModel'
  | 'argumentMapModel'
  | 'authorModel'
  | 'studyModel'
  | 'tutorModel'
  | 'hypothesisModel';

function resolveFeatureModel(settings: AppSettings, key: FeatureModelSettingKey): ModelRef | null {
  return settings[key] ?? settings.synthesisModel ?? null;
}

/**
 * Feature-local model selection persisted in the active vault's settings.
 * Reading fresh settings on mount avoids stale App props after navigating away
 * and back without coupling the feature to a global selector.
 */
export function useFeatureModel(
  settings: AppSettings,
  key: FeatureModelSettingKey
): [ModelRef | null, (model: ModelRef | null) => void] {
  const [model, setModelState] = useState<ModelRef | null>(() => resolveFeatureModel(settings, key));
  const changedLocallyRef = useRef(false);

  useEffect(() => {
    let active = true;
    void window.nodus
      .getSettings()
      .then((fresh) => {
        if (active && !changedLocallyRef.current) setModelState(resolveFeatureModel(fresh, key));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [key]);

  const setModel = useCallback(
    (next: ModelRef | null) => {
      changedLocallyRef.current = true;
      setModelState(next);
      void window.nodus.updateSettings({ [key]: next } as Partial<AppSettings>);
    },
    [key]
  );

  return [model, setModel];
}
