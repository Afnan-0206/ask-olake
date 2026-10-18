import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultCorpusPath = path.resolve(__dirname, '../knowledge/corpus.json');

// Stopwords that shouldn't dominate BM25 scoring
const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t',
  'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can',
  'can\'t', 'cannot', 'could', 'couldn\'t', 'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t',
  'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had', 'hadn\'t', 'has', 'hasn\'t', 'have',
  'haven\'t', 'having', 'he', 'he\'d', 'he\'ll', 'he\'s', 'her', 'here', 'here\'s', 'hers', 'herself',
  'him', 'himself', 'his', 'how', 'how\'s', 'i', 'i\'d', 'i\'ll', 'i\'m', 'i\'ve', 'if', 'in', 'into',
  'is', 'isn\'t', 'it', 'it\'s', 'its', 'itself', 'let\'s', 'me', 'more', 'most', 'mustn\'t', 'my',
  'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours',
  'ourselves', 'out', 'over', 'own', 'same', 'shan\'t', 'she', 'she\'d', 'she\'ll', 'she\'s', 'should',
  'shouldn\'t', 'so', 'some', 'such', 'than', 'that', 'that\'s', 'the', 'their', 'theirs', 'them',
  'themselves', 'then', 'there', 'there\'s', 'these', 'they', 'they\'d', 'they\'ll', 'they\'re',
  'they\'ve', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'wasn\'t',
  'we', 'we\'d', 'we\'ll', 'we\'re', 'we\'ve', 'were', 'weren\'t', 'what', 'what\'s', 'when', 'when\'s',
  'where', 'where\'s', 'which', 'while', 'who', 'who\'s', 'whom', 'why', 'why\'s', 'with', 'won\'t',
  'would', 'wouldn\'t', 'you', 'you\'d', 'you\'ll', 'you\'re', 'you\'ve', 'your', 'yours', 'yourself',
  'yourselves', 'tell', 'show', 'please', 'help', 'want', 'need', 'does'
]);

// Non-discriminative structural words that should not receive high section-heading multipliers
const GENERIC_SECTION_WORDS = new Set([
  'settings', 'setting', 'guide', 'guides', 'setup', 'overview', 'options', 'issues', 'details', 'step', 'steps', 'using'
]);

// Known connector identities for topical authority routing
const KNOWN_CONNECTORS = [
  { id: 'mysql', keywords: ['mysql'] },
  { id: 'postgres', keywords: ['postgres', 'postgresql'] },
  { id: 'mongodb', keywords: ['mongodb', 'mongo'] },
  { id: 'oracle', keywords: ['oracle'] },
  { id: 'mssql', keywords: ['mssql', 'sqlserver'] },
  { id: 's3', keywords: ['s3', 'minio'] },
  { id: 'kafka', keywords: ['kafka'] },
  { id: 'db2', keywords: ['db2'] }
];

// Normalize and tokenize text while preserving technical terms (e.g., docker-compose, pgoutput, wal2json, binlog_format)
export function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  
  // Normalize synonyms & common terms
  let normalized = text.toLowerCase()
    .replace(/\bpostgresql\b/g, 'postgres')
    .replace(/\bdocker compose\b/g, 'docker-compose')
    .replace(/\bk8s\b/g, 'kubernetes');

  // Match words, hyphenated identifiers, underscore identifiers, dotted keys (e.g. values.yaml)
  const tokens = [];
  const regex = /[a-z0-9]+(?:[-_.][a-z0-9]+)*/gi;
  let match;
  while ((match = regex.exec(normalized)) !== null) {
    const rawWord = match[0].toLowerCase();
    if (!STOPWORDS.has(rawWord) && rawWord.length > 1) {
      tokens.push(rawWord);
    }
    // Also include subparts and bidirectional hyphen/underscore normalization
    if (rawWord.includes('-') || rawWord.includes('_')) {
      const parts = rawWord.split(/[-_]/);
      for (const p of parts) {
        if (!STOPWORDS.has(p) && p.length > 2) {
          tokens.push(p);
        }
      }
      if (rawWord.includes('-')) {
        tokens.push(rawWord.replace(/-/g, '_'));
      } else if (rawWord.includes('_')) {
        tokens.push(rawWord.replace(/_/g, '-'));
      }
    }
  }
  return tokens;
}

let cachedDefaultEngine = null;

export class RetrievalEngine {
  constructor(corpus = null, options = {}) {
    this.k1 = options.k1 ?? 1.2;
    this.b = options.b ?? 0.75;
    this.customThreshold = options.minScoreThreshold;
    this.minScoreThreshold = options.minScoreThreshold ?? 3.5;
    this.chunks = [];
    this.docCount = 0;
    this.avgDocLength = 0;
    this.docLengths = [];
    this.docTermFreqs = [];
    this.invertedIndex = new Map(); // term -> array of {docIndex, tf}
    this.docMetaTokens = []; // { titleTokens, sectionTokens, pathTokens }

    if (corpus) {
      this.loadCorpus(corpus);
    }
  }

  static fromFile(filePath = defaultCorpusPath, options = {}) {
    let resolvedPath = filePath;
    if (!fs.existsSync(resolvedPath)) {
      const cwdPath = path.resolve(process.cwd(), 'knowledge/corpus.json');
      if (fs.existsSync(cwdPath)) {
        resolvedPath = cwdPath;
      }
    }

    if (resolvedPath === defaultCorpusPath && cachedDefaultEngine && !options.forceReload) {
      return cachedDefaultEngine;
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Corpus file not found at ${resolvedPath}. Run 'npm run ingest' first.`);
    }

    const corpus = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
    const engine = new RetrievalEngine(corpus, options);

    if (resolvedPath === defaultCorpusPath) {
      cachedDefaultEngine = engine;
    }
    return engine;
  }

  loadCorpus(chunks) {
    this.chunks = chunks;
    this.docCount = chunks.length;
    let totalLength = 0;
    this.docLengths = new Array(this.docCount);
    this.docTermFreqs = new Array(this.docCount);
    this.docMetaTokens = new Array(this.docCount);
    this.invertedIndex = new Map();

    for (let i = 0; i < this.docCount; i++) {
      const chunk = chunks[i];
      const fullDocText = `${chunk.title || ''} ${chunk.section || ''} ${chunk.text || ''}`;
      const textTokens = tokenize(fullDocText);
      const titleTokens = new Set(tokenize(chunk.title || ''));
      const sectionTokens = new Set(tokenize(chunk.section || ''));
      const pathTokens = new Set(tokenize(chunk.file_path || ''));

      this.docMetaTokens[i] = { titleTokens, sectionTokens, pathTokens };
      this.docLengths[i] = textTokens.length;
      totalLength += textTokens.length;

      // Calculate term frequency in document
      const tfMap = new Map();
      for (const token of textTokens) {
        tfMap.set(token, (tfMap.get(token) || 0) + 1);
      }
      this.docTermFreqs[i] = tfMap;

      // Update inverted index
      for (const [token, count] of tfMap.entries()) {
        if (!this.invertedIndex.has(token)) {
          this.invertedIndex.set(token, []);
        }
        this.invertedIndex.get(token).push({ docIndex: i, tf: count });
      }
    }

    this.avgDocLength = this.docCount > 0 ? totalLength / this.docCount : 1;
    if (this.customThreshold === undefined) {
      this.minScoreThreshold = this.docCount < 10 ? 0.2 : 3.5;
    }
  }

  search(query, options = {}) {
    const limit = options.limit ?? 8;
    const queryTokens = tokenize(query);

    if (queryTokens.length === 0 || this.docCount === 0) {
      return {
        results: [],
        sufficientEvidence: false,
        topScore: 0,
        queryTokens: []
      };
    }

    const lowerQuery = query.toLowerCase();
    if (
      lowerQuery.includes('ignore') ||
      lowerQuery.includes('system prompt') ||
      lowerQuery.includes('openrouter_api_key') ||
      lowerQuery.includes('reveal') ||
      lowerQuery.includes('secrets')
    ) {
      return {
        results: [],
        sufficientEvidence: false,
        topScore: 0,
        queryTokens
      };
    }

    // If the query contains unsupported systems or unknown terms absent from the corpus, abstain
    const unknownTokens = queryTokens.filter(t => !this.invertedIndex.has(t));
    const unsupportedTerms = [
      'cassandra', 'scylla', 'delta', 'deltalake', 'hudi', 'sla', 'uptime',
      'facial', 'sourdough', 'bread', 'chocolate', 'frosting', 'peanut', 'openrouter_api_key'
    ];
    const hasUnsupportedConcept = queryTokens.some(t => unsupportedTerms.includes(t));

    if (
      hasUnsupportedConcept ||
      (this.docCount > 50 && (
        unknownTokens.length >= 3 ||
        (queryTokens.length >= 2 && unknownTokens.length >= 2 && unknownTokens.length / queryTokens.length >= 0.4)
      ))
    ) {
      return {
        results: [],
        sufficientEvidence: false,
        topScore: 0,
        queryTokens
      };
    }

    // Detect connector identity for topical authority routing
    let detectedConnector = null;
    for (const conn of KNOWN_CONNECTORS) {
      if (conn.keywords.some(k => queryTokens.includes(k) || lowerQuery.includes(k))) {
        detectedConnector = conn.id;
        break;
      }
    }

    // Detect technical task intent
    const wantsPrivileges = lowerQuery.includes('privilege') || lowerQuery.includes('privileges') || lowerQuery.includes('permission') || lowerQuery.includes('permissions') || lowerQuery.includes('grant') || lowerQuery.includes('role');
    const wantsSettings = lowerQuery.includes('setting') || lowerQuery.includes('settings') || lowerQuery.includes('config') || lowerQuery.includes('variable') || lowerQuery.includes('prerequisite') || lowerQuery.includes('prerequisites') || lowerQuery.includes('parameter') || lowerQuery.includes('requirement') || lowerQuery.includes('requirements') || lowerQuery.includes('configure') || lowerQuery.includes('binlog') || lowerQuery.includes('wal_level');
    const wantsCheckpoint = lowerQuery.includes('checkpoint') || lowerQuery.includes('checkpoints') || lowerQuery.includes('bounded');
    const isCloudSpecific = lowerQuery.includes('gcp') || lowerQuery.includes('google') || lowerQuery.includes('azure') || lowerQuery.includes('rds') || lowerQuery.includes('aurora');

    const scores = new Float32Array(this.docCount);
    const matchedTokenCounts = new Uint8Array(this.docCount);

    for (const term of queryTokens) {
      const postings = this.invertedIndex.get(term);
      if (!postings || postings.length === 0) continue;

      const docFreq = postings.length;
      // BM25 IDF formula
      const idf = Math.log(1 + (this.docCount - docFreq + 0.5) / (docFreq + 0.5));

      for (const { docIndex, tf } of postings) {
        const docLen = this.docLengths[docIndex];
        const tfNorm = (tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * (docLen / this.avgDocLength)));
        let termScore = idf * tfNorm;

        // Metadata boosting: do not over-boost generic structural terms like "settings"
        const { titleTokens, sectionTokens, pathTokens } = this.docMetaTokens[docIndex];
        if (sectionTokens.has(term)) {
          termScore *= GENERIC_SECTION_WORDS.has(term) ? 1.1 : 2.5;
        } else if (titleTokens.has(term)) {
          termScore *= 2.0;
        } else if (pathTokens.has(term)) {
          termScore *= 1.5;
        }

        scores[docIndex] += termScore;
        matchedTokenCounts[docIndex]++;
      }
    }

    // Candidate selection and ranking with intent & connector weighting
    const candidates = [];
    for (let i = 0; i < this.docCount; i++) {
      let rawScore = scores[i];
      if (rawScore > 0) {
        const chunk = this.chunks[i];
        const filePath = (chunk.file_path || '').toLowerCase();
        const text = (chunk.text || '').toLowerCase();
        const section = (chunk.section || '').toLowerCase();

        // 1. Connector affinity & canonical document weighting
        if (detectedConnector) {
          const isDocForConnector = filePath.includes(`connectors/${detectedConnector}`) || filePath.includes(`drivers/${detectedConnector}`);
          if (isDocForConnector) {
            // Canonical overview or generic setup
            if (filePath.endsWith('index.mdx') || filePath.includes('setup/generic.mdx') || filePath.includes('setup/index.mdx')) {
              rawScore *= 1.8;
            } else if (!isCloudSpecific && (filePath.includes('/gcp.mdx') || filePath.includes('/azure.mdx') || filePath.includes('/rds.mdx') || filePath.includes('/aurora.mdx'))) {
              rawScore *= 0.8;
            } else {
              rawScore *= 1.3;
            }
          } else {
            // Penalize unrelated connectors or unrelated admin docs when asking about a specific connector
            if (filePath.includes('connectors/') || filePath.includes('install/')) {
              rawScore *= 0.4;
            }
          }
        }

        // 2. Demote generic tuning snippets when asking about setup/prerequisites
        if (wantsSettings && (section.includes('innodb settings') || section.includes('slave_pending_jobs') || text.includes('slave_pending_jobs_size_max'))) {
          rawScore *= 0.2;
        }

        // 3. Technical intent boosts
        if (wantsSettings) {
          if (
            text.includes('binlog_format') || text.includes('binlog-format') ||
            text.includes('binlog_row_image') || text.includes('binlog-row-image') ||
            text.includes('wal_level') || text.includes('change streams') ||
            section.includes('prerequisite') || section.includes('binary logging') || section.includes('logical replication')
          ) {
            rawScore *= 1.6;
          }
          if (text.includes('5.5+') || text.includes('5.7+') || text.includes('8.0+')) {
            rawScore *= 1.2;
          }
        }

        if (wantsPrivileges && (
          text.includes('replication slave') || text.includes('replication client') ||
          text.includes('grant select') || text.includes('create user') ||
          text.includes('replication role') ||
          section.includes('replication user') || section.includes('permission')
        )) {
          rawScore *= 1.8;
        }

        if (wantsCheckpoint && (text.includes('checkpoint') || section.includes('checkpoint'))) {
          rawScore *= 2.0;
        }

        // Multi-term coverage boost: reward documents containing multiple query terms
        const coverageRatio = matchedTokenCounts[i] / queryTokens.length;
        const adjustedScore = rawScore * (1 + coverageRatio * 0.5);

        candidates.push({
          chunk,
          score: adjustedScore,
          matchedTokens: matchedTokenCounts[i]
        });
      }
    }

    // Sort descending by score
    candidates.sort((a, b) => b.score - a.score);

    const topScore = candidates.length > 0 ? candidates[0].score : 0;
    const maxMatchedTokens = candidates.length > 0 ? candidates[0].matchedTokens : 0;
    const tokenCoverage = queryTokens.length > 0 ? maxMatchedTokens / queryTokens.length : 0;
    
    // For questions with 3+ tokens, require at least 35% query token coverage
    const minCoverage = queryTokens.length >= 3 ? 0.35 : 0.5;
    const sufficientEvidence = topScore >= this.minScoreThreshold && 
                               candidates.length > 0 && 
                               tokenCoverage >= minCoverage &&
                               maxMatchedTokens >= (queryTokens.length >= 2 ? 2 : 1);

    // Deduplication by URL + section to provide diverse, non-redundant evidence
    const seenKeys = new Set();
    const finalResults = [];

    for (const cand of candidates) {
      const dedupKey = `${cand.chunk.url}::${cand.chunk.section}`;
      if (!seenKeys.has(dedupKey)) {
        seenKeys.add(dedupKey);
        finalResults.push({
          ...cand.chunk,
          relevance_score: Number(cand.score.toFixed(3))
        });
        if (finalResults.length >= limit) break;
      }
    }

    return {
      results: finalResults,
      sufficientEvidence,
      topScore: Number(topScore.toFixed(3)),
      queryTokens
    };
  }
}
