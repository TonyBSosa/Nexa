import express from 'express';
import { healthRouter } from './routes/health.js';

export const app = express();
app.disable('x-powered-by');
app.use('/api', healthRouter);
