// Preload for the main window: the whole bridge, unchanged.
//
// The object itself lives in ./preload/api.ts because Nodi and the Presenter build
// their own, narrower bridge from the same assembled surface.
import { contextBridge } from 'electron';
import { nodusApi } from './preload/api';

contextBridge.exposeInMainWorld('nodus', nodusApi);
