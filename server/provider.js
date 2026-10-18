import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
dotenv.config();

export const APPROVED_MODELS = [
  'z-ai/glm-4.7-flash',
  'google/gemini-2.5-flash-lite',
  'deepseek/deepseek-v4.1-flash'
];

export const PRIMARY_MODEL = APPROVED_MODELS[0];
export const FALLBACK_MODELS = APPROVED_MODELS.slice(1);

export class OpenRouterProvider {
  constructor(options = {}) {
    this._explicitApiKey = options.apiKey !== undefined ? options.apiKey : null;
    this.baseUrl = options.baseUrl || 'https://openrouter.ai/api/v1/chat/completions';
    this.timeoutMs = options.timeoutMs || 20000;
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.includeReasoning = options.includeReasoning ?? true;
  }

  getApiKey() {
    if (this._explicitApiKey !== null) return this._explicitApiKey;
    if (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim().length > 0 && process.env.OPENROUTER_API_KEY !== 'replace_me_locally') {
      return process.env.OPENROUTER_API_KEY.trim();
    }
    try {
      const envPath = path.resolve(process.cwd(), '.env');
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        const match = content.match(/^OPENROUTER_API_KEY[ \t]*=[ \t]*(?:["']?)([^"'\r\n#]+)(?:["']?)/m);
        if (match && match[1] && match[1].trim() && match[1].trim() !== 'replace_me_locally') {
          process.env.OPENROUTER_API_KEY = match[1].trim();
          return match[1].trim();
        }
      }
    } catch {}
    return '';
  }

  get apiKey() {
    return this.getApiKey();
  }

  isConfigured() {
    const key = this.getApiKey();
    return Boolean(key && key.trim().length > 0 && key !== 'replace_me_locally');
  }

  async generateCompletion(messages, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('OPENROUTER_API_KEY is not configured on the server.');
    }

    const modelsToTry = options.models || APPROVED_MODELS;
    let lastError = null;

    for (const modelId of modelsToTry) {
      if (!APPROVED_MODELS.includes(modelId)) {
        throw new Error(`Unauthorized model requested: ${modelId}. Only organizer-approved models may be used.`);
      }

      const startTime = Date.now();
      try {
        const result = await this._callModelWithOptionalReasoning(modelId, messages, options);
        const duration = Date.now() - startTime;
        console.log(`[OpenRouter] Success with model=${modelId} in ${duration}ms`);
        return {
          content: result.content,
          model: modelId,
          durationMs: duration,
          usage: result.usage
        };
      } catch (err) {
        const duration = Date.now() - startTime;
        const sanitizedCategory = err.status ? `HTTP_${err.status}` : (err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR');
        console.warn(`[OpenRouter] Model ${modelId} failed (${sanitizedCategory}) in ${duration}ms: ${err.message}`);
        lastError = err;
        // Continue to next approved fallback model
      }
    }

    throw new Error(`All approved models failed. Last error: ${lastError?.message || 'Unknown error'}`);
  }

  async _callModelWithOptionalReasoning(modelId, messages, options) {
    const payload = {
      model: modelId,
      messages: messages,
      max_tokens: options.max_tokens || 500,
      temperature: options.temperature ?? 0.1
    };

    if (this.includeReasoning) {
      payload.reasoning = { effort: 'none' };
    }

    try {
      return await this._executeRequest(payload);
    } catch (err) {
      // If error might be due to reasoning parameter, retry once without it for this model
      if (this.includeReasoning && (err.message?.includes('reasoning') || err.status === 400)) {
        console.warn(`[OpenRouter] Retrying ${modelId} without reasoning parameter...`);
        delete payload.reasoning;
        return await this._executeRequest(payload);
      }
      throw err;
    }
  }

  async _executeRequest(payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchFn(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://ask-olake.local',
          'X-Title': 'Ask OLake AI Assistant'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        const err = new Error(`Provider returned status ${response.status}: ${errorText.slice(0, 200)}`);
        err.status = response.status;
        throw err;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content || typeof content !== 'string') {
        throw new Error('Malformed provider response: choices[0].message.content is missing');
      }

      return {
        content: content.trim(),
        usage: data.usage || null
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
