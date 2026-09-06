import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { healthRouter } from './routes/health.js';
import { createChatRouter } from './routes/chat.js';
import { ChatService } from './services/chat.js';
import type { AgentProvider } from './integrations/agent/AgentProvider.js';
import { PersistenceError } from './repositories/knowledge.js';
import type { KnowledgeRepository } from './repositories/knowledge.js';
import { createKnowledgeRouter } from './routes/knowledge.js';
import { KnowledgeOperationsService } from './services/knowledgeOperations.js';
import { DomainError } from './domain/workflow.js';

export function createApp(provider: AgentProvider, repository: KnowledgeRepository) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', healthRouter);
  app.use('/api', createChatRouter(new ChatService(provider, repository)));
  app.use('/api', createKnowledgeRouter(repository, new KnowledgeOperationsService(provider, repository)));
  const handleError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    // Express identifies error middleware by its four-argument signature.
    void _next;
    if (error instanceof PersistenceError) {
      response.status(500).json({ error: { code: 'PERSISTENCE_ERROR', message: error.message } });
      return;
    }
    if (error instanceof DomainError) {
      const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'INVALID_REQUEST' ? 400
        : error.code === 'AGENT_UNAVAILABLE' ? 503 : error.code === 'INVALID_PROVIDER_RESPONSE' ? 502 : 409;
      response.status(status).json({ error: { code: error.code, message: error.message } });
      return;
    }
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
