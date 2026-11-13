import serverless from 'serverless-http';
import { createApiApp } from '../../backend/app';

const app = createApiApp();

export const handler = serverless(app);
