import { StudyFocusProvider } from './components/focus/StudyFocusContext';
import './components/focus/focus.css';
import './theme/themeBoot';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AudioPlayerProvider } from './components/AudioPlayer';
import { BrowserMediaProvider } from './components/browser/BrowserMedia';
import { DriftProvider } from './components/drift/DriftProvider';
import { installTooltipLayer } from './tooltipLayer';
import './index.css';

installTooltipLayer();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AudioPlayerProvider>
      <BrowserMediaProvider>
      {/* Nodus Drift belongs to the window, not to a view: one engine, above everything that navigates. */}
      <DriftProvider>
      <StudyFocusProvider><App /></StudyFocusProvider>
      </DriftProvider>
      </BrowserMediaProvider>
    </AudioPlayerProvider>
  </React.StrictMode>
);
