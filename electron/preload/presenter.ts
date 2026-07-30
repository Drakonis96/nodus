// Preload for the Presenter's audience and presenter-view windows.
//
// They show a deck fullscreen on a projector and control playback; nine methods
// cover all of it, and none of them writes to a vault.
import { PRESENTER_WINDOW_METHODS, type PresenterApi } from '@shared/api/windows';
import { nodusApi } from './api';
import { exposeWindowBridge, pick } from './windowBridge';

const api: PresenterApi = pick(nodusApi, PRESENTER_WINDOW_METHODS);

exposeWindowBridge(api, nodusApi, 'Presenter');
