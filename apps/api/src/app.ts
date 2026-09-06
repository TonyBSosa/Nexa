import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { healthRouter } from './routes/health.js';
import { createChatRouter } from './routes/chat.js';
import { ChatService } from './services/chat.js';
import type { AgentProvider } from './integrations/agent/AgentProvider.js';

export function createApp(provider: AgentProvider) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', healthRouter);
  app.use('/api', createChatRouter(new ChatService(provider)));
  const handleError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    // Express identifies error middleware by its four-argument signature.
    void _next;
    const type = typeof error === 'object' && error !== null && 'type' in error ? error.type : undefined;
    if (type === 'entity.parse.failed' || type === 'entity.too.large') {
      response.status(type === 'entity.too.large' ? 413 : 400).json({
        error: { code: 'INVALID_REQUEST', message: 'Provide valid JSON within the 16 KB request limit.' },
      });
      return;
    }
    response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unable to process the request.' } });
  };
  app.use(handleError);
  return app;
}
