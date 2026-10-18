import test from 'node:test';
import assert from 'node:assert/strict';
import { RetrievalEngine, tokenize } from '../server/retrieval.js';

test('Retrieval: Tokenizer preserves technical terms and filters stopwords', () => {
  const tokens = tokenize('How do I configure postgres cdc using pgoutput and docker-compose?');
  assert.ok(tokens.includes('postgres'), 'Should preserve postgres');
  assert.ok(tokens.includes('cdc'), 'Should preserve cdc');
  assert.ok(tokens.includes('pgoutput'), 'Should preserve pgoutput');
  assert.ok(tokens.includes('docker-compose'), 'Should preserve docker-compose');
  assert.ok(!tokens.includes('how'), 'Should filter out stopword "how"');
  assert.ok(!tokens.includes('and'), 'Should filter out stopword "and"');
});

test('Retrieval: Correctly retrieves technical chunks from committed corpus', () => {
  const engine = RetrievalEngine.fromFile();
  assert.ok(engine.docCount > 100, 'Corpus should contain over 100 chunks');

  // Test 1: PostgreSQL connector sync modes
  const pgResult = engine.search('Which sync modes are documented for PostgreSQL?');
  assert.strictEqual(pgResult.sufficientEvidence, true, 'PostgreSQL query should have sufficient evidence');
  assert.ok(pgResult.results.length > 0, 'Should return candidate chunks');
  const topPg = pgResult.results[0];
  assert.ok(topPg.url.startsWith('https://'), 'URL must be a valid public URL');
  assert.ok(topPg.text.toLowerCase().includes('sync modes') || topPg.section.toLowerCase().includes('sync modes'), 'Must match sync modes');

  // Test 2: OLake Fusion Compaction types
  const fusionResult = engine.search('What are the types of compaction in OLake Fusion?');
  assert.strictEqual(fusionResult.sufficientEvidence, true, 'Fusion query should have sufficient evidence');
  const topFusion = fusionResult.results[0];
  assert.ok(topFusion.text.toLowerCase().includes('compaction'), 'Should discuss compaction');

  // Test 3: Helm deployment
  const helmResult = engine.search('How do I deploy OLake using Helm?');
  assert.strictEqual(helmResult.sufficientEvidence, true, 'Helm query should have sufficient evidence');
  assert.ok(helmResult.results.some(r => r.file_path.includes('helm') || r.text.includes('helm')), 'Should retrieve Helm documents');
});

test('Retrieval: Source metadata is preserved accurately', () => {
  const engine = RetrievalEngine.fromFile();
  const res = engine.search('Postgres connector');
  assert.ok(res.results.length > 0);
  const chunk = res.results[0];
  assert.ok(chunk.chunk_id, 'Must have chunk_id');
  assert.ok(chunk.repository, 'Must have repository');
  assert.ok(chunk.file_path, 'Must have file_path');
  assert.ok(chunk.title, 'Must have title');
  assert.ok(chunk.section, 'Must have section');
  assert.ok(chunk.url, 'Must have public url');
  assert.ok(typeof chunk.line_start === 'number', 'Must have line_start');
});

test('Retrieval: Off-topic / irrelevant query triggers abstention', () => {
  const engine = RetrievalEngine.fromFile();
  const unrelated = engine.search('What is the secret recipe for homemade chocolate chip cookies?');
  assert.strictEqual(unrelated.sufficientEvidence, false, 'Unrelated query should not trigger sufficient evidence');
});

test('Retrieval: Empty corpus and empty query behavior is graceful', () => {
  const emptyEngine = new RetrievalEngine([]);
  const res1 = emptyEngine.search('postgres');
  assert.strictEqual(res1.sufficientEvidence, false);
  assert.deepStrictEqual(res1.results, []);

  const normalEngine = RetrievalEngine.fromFile();
  const res2 = normalEngine.search('');
  assert.strictEqual(res2.sufficientEvidence, false);
  assert.deepStrictEqual(res2.results, []);
});
