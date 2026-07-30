// Preload for the Nodi overlay window (mascot.html).
//
// Nodi floats above every other app and is the most exposed renderer Nodus has.
// It needs 36 of the bridge's ~1,250 methods, so it gets those and no others.
import { NODI_WINDOW_METHODS, type NodiApi } from '@shared/api/windows';
import { nodusApi } from './api';
import { exposeWindowBridge, pick } from './windowBridge';

const api: NodiApi = pick(nodusApi, NODI_WINDOW_METHODS);

exposeWindowBridge(api, nodusApi, 'Nodi');
