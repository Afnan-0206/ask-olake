import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAndFormatResponse, ABSTENTION_MESSAGE } from '../server/citations.js';

const mockChunks = [
  {
    chunk_id: 'c1',
    title: 'Postgres Connector',
    section: 'Sync Modes Supported',
    url: 'https://olake.io/docs/connectors/postgres'
  },
  {
    chunk_id: 'c2',
    title: 'Postgres CDC Setup',
    section: 'wal2json Deprecation',
    url: 'https://olake.io/docs/connectors/postgres/wal2json_plugin'
  }
];

test('Citations: Successfully renumbers valid [S1] and [S2] citations to [1] and [2]', () => {
  const modelOutput = JSON.stringify({
    answer: 'OLake supports Full Refresh and CDC modes [S1]. Notice that wal2json is deprecated [S2].',
    cited_sources: ['S1', 'S2']
  });

  const formatted = validateAndFormatResponse(modelOutput, mockChunks);
  assert.strictEqual(
    formatted.answer,
    'OLake supports Full Refresh and CDC modes [1]. Notice that wal2json is deprecated [2].'
  );
  assert.deepStrictEqual(formatted.sources, [
    'https://olake.io/docs/connectors/postgres',
    'https://olake.io/docs/connectors/postgres/wal2json_plugin'
  ]);
});

test('Citations: Deduplicates identical source URLs in citation list', () => {
  const duplicateUrlChunks = [
    { chunk_id: 'c1', url: 'https://olake.io/docs/connectors/postgres' },
    { chunk_id: 'c2', url: 'https://olake.io/docs/connectors/postgres' } // same URL, different section
  ];

  const modelOutput = JSON.stringify({
    answer: 'Postgres has sync modes [S1] and configuration parameters [S2].',
    cited_sources: ['S1', 'S2']
  });

  const formatted = validateAndFormatResponse(modelOutput, duplicateUrlChunks);
  // Both [S1] and [S2] point to the same URL, so both should map to [1]
  assert.strictEqual(
    formatted.answer,
    'Postgres has sync modes [1] and configuration parameters [1].'
  );
  assert.strictEqual(formatted.sources.length, 1);
  assert.strictEqual(formatted.sources[0], 'https://olake.io/docs/connectors/postgres');
});

test('Citations: Rejects unknown / fabricated citation IDs and prevents fake URLs', () => {
  const modelOutput = JSON.stringify({
    answer: 'Here is an unverified claim [S99] and another [S5].',
    cited_sources: ['S99', 'S5']
  });

  const formatted = validateAndFormatResponse(modelOutput, mockChunks);
  // Since neither S99 nor S5 exists in the context of 2 chunks, it must abstain
  assert.strictEqual(formatted.answer, ABSTENTION_MESSAGE);
  assert.deepStrictEqual(formatted.sources, []);
});

test('Citations: Handles markdown-wrapped JSON code blocks', () => {
  const modelOutput = `\`\`\`json
{
  "answer": "OLake Go handles high throughput replication [S1].",
  "cited_sources": ["S1"]
}
\`\`\``;

  const formatted = validateAndFormatResponse(modelOutput, mockChunks);
  assert.strictEqual(
    formatted.answer,
    'OLake Go handles high throughput replication [1].'
  );
  assert.deepStrictEqual(formatted.sources, ['https://olake.io/docs/connectors/postgres']);
});

test('Citations: Returns standard abstention when model signals lack of evidence', () => {
  const modelOutput = JSON.stringify({
    answer: "I couldn't verify that from the currently indexed OLake sources.",
    cited_sources: []
  });

  const formatted = validateAndFormatResponse(modelOutput, mockChunks);
  assert.strictEqual(formatted.answer, ABSTENTION_MESSAGE);
  assert.deepStrictEqual(formatted.sources, []);
});
