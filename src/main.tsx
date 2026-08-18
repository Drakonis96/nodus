import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AudioPlayerProvider } from './components/AudioPlayer';
import { BrowserMediaProvider } from './components/browser/BrowserMedia';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AudioPlayerProvider>
      <BrowserMediaProvider>
      <App />
      </BrowserMediaProvider>
    </AudioPlayerProvider>
  </React.StrictMode>
);
