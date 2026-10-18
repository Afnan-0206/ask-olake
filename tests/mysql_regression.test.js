import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { RetrievalEngine } from '../server/retrieval.js';

// Native request helper without external dependencies
async function request(app, method, url, body = null) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = server.address().port;
      const fullUrl = `http://127.0.0.1:${port}${url}`;
      try {
        const fetchOptions = {
          method,
          headers: {}
        };
        if (body !== null) {
          fetchOptions.headers['Content-Type'] = 'application/json';
          fetchOptions.body = JSON.stringify(body);
        }
        const res = await fetch(fullUrl, fetchOptions);
        const text = await res.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {}
        server.close(() => {
          resolve({ status: res.status, headers: res.headers, body: json, text });
        });
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

test('MySQL CDC Regression: Core query retrieves required CDC settings, version constraints, and privileges', () => {
  const engine = RetrievalEngine.fromFile();
  const query = 'What MySQL settings and privileges does OLake need for CDC?';
  const search = engine.search(query, { limit: 8 });

  assert.strictEqual(search.sufficientEvidence, true, 'Search must indicate sufficient evidence');
  assert.ok(search.results.length >= 3, 'Must retrieve multiple relevant chunks');

  const combinedEvidence = search.results.map(r => `${r.title} ${r.section} ${r.text}`).join(' ').toLowerCase();

  // 1. Verify required CDC settings
  assert.ok(combinedEvidence.includes('binlog_format') || combinedEvidence.includes('binlog-format'), 'Must include binlog_format');
  assert.ok(combinedEvidence.includes('row'), 'Must include row-based format');
  assert.ok(combinedEvidence.includes('binlog_row_image') || combinedEvidence.includes('binlog-row-image'), 'Must include binlog_row_image');
  assert.ok(combinedEvidence.includes('full'), 'Must include full row image');
  assert.ok(combinedEvidence.includes('binlog_row_metadata') || combinedEvidence.includes('binlog-row-metadata'), 'Must include binlog_row_metadata');
  assert.ok(combinedEvidence.includes('log_bin') || combinedEvidence.includes('log-bin') || combinedEvidence.includes('binary logging'), 'Must include binary logging');

  // 2. Verify required privileges
  assert.ok(combinedEvidence.includes('replication client'), 'Must include REPLICATION CLIENT privilege');
  assert.ok(combinedEvidence.includes('replication slave'), 'Must include REPLICATION SLAVE privilege');

  // 3. Verify that non-essential performance tuning does NOT crowd out canonical setup
  const topResult = search.results[0];
  assert.ok(
    !topResult.section.toLowerCase().includes('innodb settings') &&
    !topResult.section.toLowerCase().includes('replication settings'),
    'Top result must be canonical connector documentation, not slave buffer or InnoDB tuning'
  );

  // 4. Verify canonical sources
  const urls = search.results.map(r => r.url);
  assert.ok(
    urls.some(u => u.includes('docs/connectors/mysql')),
    'Must include official MySQL connector documentation'
  );
});

test('MySQL CDC Regression: Alternative phrasings successfully discover official CDC requirements', () => {
  const engine = RetrievalEngine.fromFile();
  const alternativePhrasings = [
    {
      q: 'Configure MySQL CDC for OLake.',
      mustFind: ['binlog_format', 'row', 'binlog_row_image']
    },
    {
      q: 'What binary logging settings are needed for the OLake MySQL connector?',
      mustFind: ['binlog_format', 'row', 'binlog_row_image', 'full']
    },
    {
      q: 'Which database permissions must the OLake replication user have?',
      mustFind: ['replication client', 'replication slave']
    },
    {
      q: 'Why does MySQL CDC require row-based binary logging?',
      mustFind: ['row', 'binlog_format']
    }
  ];

  for (const { q, mustFind } of alternativePhrasings) {
    const res = engine.search(q, { limit: 8 });
    assert.strictEqual(res.sufficientEvidence, true, `Evidence must be sufficient for: "${q}"`);
    const combined = res.results.map(r => `${r.title} ${r.section} ${r.text}`).join(' ').toLowerCase();

    for (const term of mustFind) {
      assert.ok(
        combined.includes(term.toLowerCase()),
        `Alternative phrasing "${q}" must include term "${term}" in retrieved evidence`
      );
    }
  }
});

test('MySQL CDC Regression: End-to-end /ask generation includes all factual CDC requirements and valid citations', async () => {
  const engine = RetrievalEngine.fromFile();
  const mockProvider = {
    isConfigured: () => true,
    generateCompletion: async (messages) => {
      return {
        content: JSON.stringify({
          answer: 'For MySQL CDC, OLake requires MySQL 5.5+ (5.7+ recommended) with binary logging enabled [S1]. The required server settings are binlog_format = ROW [S1], binlog_row_image = FULL [S1], and binlog_row_metadata = FULL for MySQL 8.0+ [S1]. A unique server-id must be configured [S2]. The replication user requires SELECT, REPLICATION CLIENT, and REPLICATION SLAVE privileges [S3].',
          cited_sources: ['S1', 'S2', 'S3']
        })
      };
    }
  };

  const app = createApp({ retrievalEngine: engine, provider: mockProvider });
  const response = await request(app, 'POST', '/ask', {
    question: 'What MySQL settings and privileges does OLake need for CDC?'
  });

  assert.strictEqual(response.status, 200);
  const { answer, sources } = response.body;

  // Verify answer facts
  const lowerAnswer = answer.toLowerCase();
  assert.ok(lowerAnswer.includes('binlog_format = row') || (lowerAnswer.includes('binlog_format') && lowerAnswer.includes('row')), 'Must state binlog_format = ROW');
  assert.ok(lowerAnswer.includes('binlog_row_image = full') || (lowerAnswer.includes('binlog_row_image') && lowerAnswer.includes('full')), 'Must state binlog_row_image = FULL');
  assert.ok(lowerAnswer.includes('replication client'), 'Must state REPLICATION CLIENT');
  assert.ok(lowerAnswer.includes('replication slave'), 'Must state REPLICATION SLAVE');

  // Verify no forbidden / incorrect claims
  assert.strictEqual(lowerAnswer.includes('slave_pending_jobs_size_max'), false, 'Must not center on slave buffer tuning');

  // Verify citations
  assert.ok(sources.length > 0, 'Sources array must not be empty');
  assert.ok(sources.every(s => s.startsWith('https://olake.io/docs/connectors/mysql')), 'All sources must be official MySQL docs');
  assert.ok(answer.includes('[1]'), 'Answer must contain [1] marker');
});
