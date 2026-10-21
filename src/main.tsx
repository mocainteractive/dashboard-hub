import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { MocaProvider } from './lib/MocaProvider';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MocaProvider>
      <App />
    </MocaProvider>
  </StrictMode>,
);
