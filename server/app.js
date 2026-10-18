import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RetrievalEngine } from './retrieval.js';
import { OpenRouterProvider } from './provider.js';
import { buildSystemPrompt, buildUserPrompt, validateAndFormatResponse, ABSTENTION_MESSAGE } from './citations.js';
import { formatEvaluationBranches, synthesizeDocumentationAnswer } from './synthesis.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distPath = path.join(projectRoot, 'dist');
const manifestPath = path.join(projectRoot, 'knowledge/manifest.json');

export function createApp(options = {}) {
  const app = express();
  
  // Injected or default components
  const retrievalEngine = options.retrievalEngine || RetrievalEngine.fromFile();
  const provider = options.provider || new OpenRouterProvider();

  let manifest = { total_chunks: 0, repositories: {} };
  let resolvedManifestPath = manifestPath;
  if (!fs.existsSync(resolvedManifestPath)) {
    const cwdManifest = path.resolve(process.cwd(), 'knowledge/manifest.json');
    if (fs.existsSync(cwdManifest)) {
      resolvedManifestPath = cwdManifest;
    }
  }

  if (fs.existsSync(resolvedManifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(resolvedManifestPath, 'utf8'));
    } catch {
      // ignore
    }
  }

  // Security & standard middleware
  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  }));
  app.options('*', cors());
  app.use(express.json({ limit: '100kb' }));

  // Lightweight in-memory rate limiter
  const rateLimitWindowMs = 60 * 1000;
  const maxRequestsPerWindow = 60;
  const ipHits = new Map();

  app.use((req, res, next) => {
    // Custom security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Allow embedding in iframes for /embed and /demo routes
    if (
      req.path === '/embed' || req.path.startsWith('/embed/') ||
      req.path === '/demo' || req.path.startsWith('/demo/')
    ) {
      res.removeHeader('X-Frame-Options');
      res.setHeader('Content-Security-Policy', "frame-ancestors *;");
    } else {
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    }

    // Rate limiting on API routes
    if (req.path === '/ask') {
      const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
      const now = Date.now();
      const record = ipHits.get(clientIp) || { count: 0, startTime: now };

      if (now - record.startTime > rateLimitWindowMs) {
        record.count = 1;
        record.startTime = now;
      } else {
        record.count++;
      }
      ipHits.set(clientIp, record);

      if (record.count > maxRequestsPerWindow) {
        return res.status(429).json({
          error: 'Rate limit exceeded. Please wait a moment before asking more questions.'
        });
      }
    }

    next();
  });

  // GET /health endpoint
  app.get(['/health', '/api/health'], (req, res) => {
    res.status(200).json({
      status: 'ok',
      modelConfigured: provider.isConfigured(),
      corpusChunks: retrievalEngine.docCount || manifest.total_chunks,
      repositories: Object.keys(manifest.repositories || {}),
      timestamp: new Date().toISOString()
    });
  });

  // GET /version endpoint (request-time Vercel metadata)
  app.get(['/version', '/api/version'], (req, res) => {
    res.status(200).json({
      commit: process.env.VERCEL_GIT_COMMIT_SHA || '',
      deployment: process.env.VERCEL_DEPLOYMENT_ID || ''
    });
  });

  // GET /models endpoint (queries OpenRouter user models at request time)
  app.get(['/models', '/api/models'], async (req, res) => {
    const apiKey = (typeof provider.getApiKey === 'function' ? provider.getApiKey() : provider.apiKey) || process.env.OPENROUTER_API_KEY || '';

    if (!apiKey || apiKey.trim().length === 0 || apiKey === 'replace_me_locally') {
      return res.status(503).json({
        error: 'OPENROUTER_API_KEY is not configured on the server.',
        models: []
      });
    }

    const controller = new AbortController();
    const timeoutMs = options.modelsTimeoutMs || 5000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const fetchFn = options.fetchFn || (provider && provider.fetchFn) || globalThis.fetch;

    try {
      const response = await fetchFn('https://openrouter.ai/api/v1/models/user', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
          'HTTP-Referer': 'https://ask-olake.local',
          'X-Title': 'Ask OLake AI Assistant'
        },
        signal: controller.signal
      });

      if (!response.ok) {
        const status = response.status;
        return res.status(status >= 500 ? 502 : status).json({
          error: `Provider models API returned HTTP ${status}.`,
          models: []
        });
      }

      const rawText = await response.text();
      let data = null;
      try {
        data = JSON.parse(rawText);
      } catch {
        return res.status(502).json({
          error: 'Provider returned malformed JSON.',
          models: []
        });
      }

      let modelList = [];
      if (Array.isArray(data?.data)) {
        modelList = data.data.map(m => (typeof m === 'string' ? m : m?.id)).filter(Boolean);
      } else if (Array.isArray(data?.models)) {
        modelList = data.models.map(m => (typeof m === 'string' ? m : m?.id)).filter(Boolean);
      } else if (Array.isArray(data)) {
        modelList = data.map(m => (typeof m === 'string' ? m : m?.id)).filter(Boolean);
      }

      return res.status(200).json({
        models: modelList
      });
    } catch (err) {
      const isTimeout = err.name === 'AbortError';
      return res.status(isTimeout ? 504 : 502).json({
        error: isTimeout ? 'Request to OpenRouter models API timed out.' : 'Failed to retrieve models from provider.',
        models: []
      });
    } finally {
      clearTimeout(timer);
    }
  });

  // POST /ask endpoint
  app.post(['/ask', '/api/ask'], async (req, res) => {
    const startTime = Date.now();

    // 1. Input validation
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Request body must be a JSON object.' });
    }

    const { question } = req.body;

    if (question === undefined || question === null) {
      return res.status(400).json({ error: 'Missing required field: "question".' });
    }

    if (typeof question !== 'string') {
      return res.status(400).json({ error: 'Field "question" must be a string.' });
    }

    const trimmedQuestion = question.trim();

    if (trimmedQuestion.length === 0) {
      return res.status(400).json({ error: 'Question cannot be empty.' });
    }

    // Prompt injection & secret disclosure check
    const lowerQuestion = trimmedQuestion.toLowerCase();
    if (
      lowerQuestion.includes('ignore previous instructions') ||
      lowerQuestion.includes('ignore all instructions') ||
      lowerQuestion.includes('output all environment secrets') ||
      lowerQuestion.includes('reveal api key') ||
      lowerQuestion.includes('print env') ||
      lowerQuestion.includes('show secrets') ||
      lowerQuestion.includes('openrouter_api_key') ||
      lowerQuestion.includes('system prompt')
    ) {
      return res.status(200).json({
        answer: "I cannot fulfill this request. I am the official Ask OLake documentation assistant and cannot reveal secrets, API keys, or override system guidelines.",
        sources: [],
        branches: []
      });
    }

    const MAX_QUESTION_LENGTH = 1500;
    if (trimmedQuestion.length > MAX_QUESTION_LENGTH) {
      return res.status(400).json({
        error: `Question exceeds maximum allowed length of ${MAX_QUESTION_LENGTH} characters.`
      });
    }

    try {
      // 2. Local retrieval
      const searchResult = retrievalEngine.search(trimmedQuestion, { limit: 6 });
      const { results: candidateChunks, sufficientEvidence } = searchResult;

      // 3. Abstention check if retrieval finds no sufficient evidence
      if (!sufficientEvidence || candidateChunks.length === 0) {
        return res.status(200).json({
          answer: ABSTENTION_MESSAGE,
          sources: [],
          branches: []
        });
      }

      // Format dynamic evaluation branches from the real retrieved chunks
      const branches = formatEvaluationBranches(candidateChunks, searchResult.topScore);

      // 4. Model configuration check: if not configured, synthesize from real retrieved chunks
      if (!provider.isConfigured()) {
        const synthesized = synthesizeDocumentationAnswer(trimmedQuestion, candidateChunks);
        const durationMs = Date.now() - startTime;
        console.log(`[Ask API - Local Synthesis] Responded in ${durationMs}ms with ${synthesized.sources.length} sources and ${branches.length} branches.`);

        return res.status(200).json({
          answer: synthesized.answer,
          sources: synthesized.sources,
          branches
        });
      }

      // 5. Construct grounded prompt
      const systemPrompt = buildSystemPrompt();
      const userPrompt = buildUserPrompt(trimmedQuestion, candidateChunks);

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];

      // 6. Invoke OpenRouter provider with approved models & fallbacks
      const completion = await provider.generateCompletion(messages, { max_tokens: 500 });

      // 7. Validate citations and format output
      const validated = validateAndFormatResponse(completion.content, candidateChunks);

      const durationMs = Date.now() - startTime;
      console.log(`[Ask API] Responded in ${durationMs}ms with ${validated.sources.length} sources.`);

      return res.status(200).json({
        answer: validated.answer,
        sources: validated.sources,
        branches
      });
    } catch (err) {
      const durationMs = Date.now() - startTime;
      console.error(`[Ask API Error] after ${durationMs}ms:`, err.message);

      // Never expose secrets or internal error stacks to clients
      return res.status(500).json({
        error: 'An internal error occurred while processing your request. Please try again later.'
      });
    }
  });

  // Serve static assets if dist/ exists
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));

    app.get(['/embed', '/demo'], (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });

    app.get('*', (req, res) => {
      if (req.accepts('html')) {
        res.sendFile(path.join(distPath, 'index.html'));
      } else {
        res.status(404).json({ error: 'Not found' });
      }
    });
  } else {
    // If frontend hasn't been built yet, provide clear info
    app.get(['/embed', '/demo'], (req, res) => {
      res.send('Frontend build not found. Run "npm run build" first.');
    });

    app.get('/', (req, res) => {
      res.json({
        service: 'Ask OLake API',
        endpoints: {
          ask: 'POST /ask',
          health: 'GET /health',
          version: 'GET /version',
          models: 'GET /models',
          embed: 'GET /embed',
          demo: 'GET /demo'
        },
        frontendStatus: 'Run "npm run build" to build and serve the chat interface.'
      });
    });
  }

  return app;
}
