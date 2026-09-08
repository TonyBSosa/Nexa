import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { BotpressWebchat } from './integrations/botpress/BotpressWebchat';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root.');

const enableBotpressWebchat = import.meta.env.DEV
  && import.meta.env.VITE_ENABLE_BOTPRESS_WEBCHAT === 'true';

createRoot(root).render(
  <StrictMode>
    <App />
    {enableBotpressWebchat && <BotpressWebchat />}
  </StrictMode>,
);
