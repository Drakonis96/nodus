import { ipcRenderer } from 'electron';
import type { StudyFocusApi } from '../../shared/studyFocus';
export const studyFocusApi: StudyFocusApi = {
  getStudyFocus: () => ipcRenderer.invoke('studyFocus:get'),
  configureStudyFocus: (id, patch) => ipcRenderer.invoke('studyFocus:configure', id, patch),
  actStudyFocus: (id, action, revision, subjectId) => ipcRenderer.invoke('studyFocus:act', id, action, revision, subjectId),
  getStudyFocusStats: () => ipcRenderer.invoke('studyFocus:stats'),
  setStudyFocusDistractions: value => ipcRenderer.invoke('studyFocus:distractions', value),
  onStudyFocusChanged: callback => {
    const listener = (_event: unknown, state: Parameters<typeof callback>[0]) => callback(state);
    ipcRenderer.on('studyFocus:changed', listener);
    return () => { ipcRenderer.removeListener('studyFocus:changed', listener); };
  },
  onStudyFocusCompleted: callback => {
    const listener = (_event: unknown, state: Parameters<typeof callback>[0]) => callback(state);
    ipcRenderer.on('studyFocus:completed', listener);
    return () => { ipcRenderer.removeListener('studyFocus:completed', listener); };
  },
};
