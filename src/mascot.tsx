import { createRoot } from 'react-dom/client';
import { NodiCompanion } from './components/nodi/NodiCompanion';
import './mascot.css';

// Standalone entry for the always-on-top desktop overlay window. It renders the Nodi
// companion (no app shell, no data access beyond the exposed nodus bridge) on a
// transparent, frameless, click-through window.
const el = document.getElementById('mascot-root');
if (el) {
  createRoot(el).render(<NodiCompanion context="overlay" />);
}
