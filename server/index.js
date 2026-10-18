import dotenv from 'dotenv';
import { createApp } from './app.js';

dotenv.config();

const port = process.env.PORT || 3000;
const app = createApp();

const server = app.listen(port, () => {
  console.log(`===============================================`);
  console.log(`🚀 Ask OLake Server listening on port ${port}`);
  console.log(`   Health check: http://localhost:${port}/health`);
  console.log(`   Chat UI:      http://localhost:${port}/`);
  console.log(`   Embed Route:  http://localhost:${port}/embed`);
  console.log(`===============================================`);
});

export { app, server };
