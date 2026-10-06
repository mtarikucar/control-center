import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

// No <StrictMode>: its simulated unmount/remount leaves drei's <Html> character tags empty in development.
const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
