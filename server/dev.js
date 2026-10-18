import dotenv from 'dotenv';
import { createApp } from './app.js';

dotenv.config();

const port = process.env.PORT || 3000;
const app = createApp();

app.listen(port, () => {
  console.log(`===============================================`);
  console.log(`🚀 Ask OLake Dev Server running on port ${port}`);
  console.log(`   Health check: http://localhost:${port}/health`);
  console.log(`   App:          http://localhost:${port}/`);
  console.log(`   Embed:        http://localhost:${port}/embed`);
  console.log(`===============================================`);
});
