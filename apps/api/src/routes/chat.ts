import { Router } from 'express';
import { ChatService, InvalidChatRequest } from '../services/chat.js';

export function createChatRouter(service: ChatService) {
  const router = Router();
  router.post('/chat', async (request, response, next) => {
    try {
      const result = await service.chat(request.body);
      const status = result.status === 'FAILURE' ? 503 : 200;
      response.status(status).json(result);
    } catch (error) {
      if (error instanceof InvalidChatRequest) {
        response.status(400).json({ error: { code: 'INVALID_REQUEST', message: error.message } });
      } else {
        next(error);
      }
    }
  });
  return router;
}
