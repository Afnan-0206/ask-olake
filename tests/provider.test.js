import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenRouterProvider, APPROVED_MODELS } from '../server/provider.js';

test('Provider: Enforces strictly the three organizer-approved model IDs', () => {
  assert.deepStrictEqual(APPROVED_MODELS, [
    'z-ai/glm-4.7-flash',
    'google/gemini-2.5-flash-lite',
    'deepseek/deepseek-v4.1-flash'
  ]);
});

test('Provider: Rejects unauthorized model IDs', async () => {
  const provider = new OpenRouterProvider({ apiKey: 'mock_key' });
  await assert.rejects(
    async () => {
      await provider.generateCompletion([{ role: 'user', content: 'test' }], {
        models: ['openai/gpt-4o'] // Unauthorized!
      });
    },
    /Unauthorized model requested/
  );
});

test('Provider: Executes successfully with mock fetch', async () => {
  let requestedModel = null;
  let authHeader = null;

  const mockFetch = async (url, options) => {
    const body = JSON.parse(options.body);
    requestedModel = body.model;
    authHeader = options.headers['Authorization'];

    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"answer": "Postgres supports CDC [S1].", "cited_sources": ["S1"]}'
            }
          }
        ],
        usage: { prompt_tokens: 120, completion_tokens: 30 }
      })
    };
  };

  const provider = new OpenRouterProvider({
    apiKey: 'mock_secret_key',
    fetchFn: mockFetch
  });

  const res = await provider.generateCompletion([{ role: 'user', content: 'test' }]);
  assert.strictEqual(requestedModel, 'z-ai/glm-4.7-flash', 'Must use primary approved model');
  assert.strictEqual(authHeader, 'Bearer mock_secret_key');
  assert.ok(res.content.includes('Postgres supports CDC'));
});

test('Provider: Automatically falls back to secondary approved model when primary fails', async () => {
  const attemptedModels = [];

  const mockFetch = async (url, options) => {
    const body = JSON.parse(options.body);
    attemptedModels.push(body.model);

    if (body.model === 'z-ai/glm-4.7-flash') {
      // Primary fails with 503
      return {
        ok: false,
        status: 503,
        text: async () => 'Service Temporarily Unavailable'
      };
    }

    // Secondary succeeds
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"answer": "Fallback answered [S1].", "cited_sources": ["S1"]}'
            }
          }
        ]
      })
    };
  };

  const provider = new OpenRouterProvider({
    apiKey: 'mock_secret_key',
    fetchFn: mockFetch
  });

  const res = await provider.generateCompletion([{ role: 'user', content: 'test' }]);
  assert.strictEqual(res.model, 'google/gemini-2.5-flash-lite');
  assert.deepStrictEqual(attemptedModels, [
    'z-ai/glm-4.7-flash',
    'google/gemini-2.5-flash-lite'
  ]);
});

test('Provider: Fails gracefully when API key is missing', async () => {
  const provider = new OpenRouterProvider({ apiKey: '' });
  assert.strictEqual(provider.isConfigured(), false);
  await assert.rejects(
    async () => {
      await provider.generateCompletion([{ role: 'user', content: 'test' }]);
    },
    /OPENROUTER_API_KEY is not configured/
  );
});
