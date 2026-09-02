import '../theme/themeBoot';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '../index.css';
import './serverDesktop.css';

const root = document.getElementById('root');
if (!root) throw new Error('Nodus web root is missing.');
createRoot(root).render(<StrictMode><App /></StrictMode>);
