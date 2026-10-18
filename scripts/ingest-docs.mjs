import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const knowledgeDir = path.join(rootDir, 'knowledge');

if (!fs.existsSync(knowledgeDir)) {
  fs.mkdirSync(knowledgeDir, { recursive: true });
}

// Repositories configuration
const REPOS = [
  {
    name: 'datazip-inc/olake-docs',
    dir: path.join(rootDir, 'scratch-olake-docs'),
    cloneUrl: 'https://github.com/datazip-inc/olake-docs.git',
    type: 'docs',
    include: ['docs'],
    docBaseUrl: 'https://olake.io/docs'
  },
  {
    name: 'datazip-inc/olake',
    dir: path.join(rootDir, 'scratch-olake'),
    cloneUrl: 'https://github.com/datazip-inc/olake.git',
    type: 'repo',
    include: ['README.md', 'CONTRIBUTING.md', 'docker-compose.yml', 'drivers', 'destination', 'examples']
  },
  {
    name: 'datazip-inc/olake-ui',
    dir: path.join(rootDir, 'scratch-olake-ui'),
    cloneUrl: 'https://github.com/datazip-inc/olake-ui.git',
    type: 'repo',
    include: ['README.md', 'api-contract.md', 'docker-compose.yml', 'docker-compose-v1.yml', 'ui', 'server']
  },
  {
    name: 'datazip-inc/olake-helm',
    dir: path.join(rootDir, 'scratch-olake-helm'),
    cloneUrl: 'https://github.com/datazip-inc/olake-helm.git',
    type: 'repo',
    include: ['README.md', 'helm']
  },
  {
    name: 'datazip-inc/olake-fusion',
    dir: path.join(rootDir, 'scratch-olake-fusion'),
    cloneUrl: 'https://github.com/datazip-inc/olake-fusion.git',
    type: 'repo',
    include: ['README.md', 'docs', 'charts']
  }
];

function getCommitSha(repoDir) {
  try {
    return execSync('git rev-parse HEAD', { cwd: repoDir, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

function ensureRepo(repo) {
  if (!fs.existsSync(repo.dir)) {
    console.log(`Cloning ${repo.name} shallowly...`);
    execSync(`git clone --depth 1 ${repo.cloneUrl} "${repo.dir}"`, { stdio: 'inherit' });
  }
}

function cleanMdx(rawContent) {
  let content = rawContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Strip import statements
  content = content.replace(/^import\s+.*?from\s+['"].*?['"];?\s*$/gm, '');
  // Strip JSX self-closing tags like <TOCTabLinker ... /> or <SupportedSources />
  content = content.replace(/<[A-Z][A-Za-z0-9]*\b[^>]*\/>/g, '');
  // Strip JSX wrapper tags like <Tabs ...>, </Tabs>, <TabItem ...>, </TabItem>
  content = content.replace(/<\/?(Tabs|TabItem|TOCTabLinker|DateTimeHandling|SourceSSLModeDetails)[^>]*>/g, '');
  // Strip MDX comments {/* ... */}
  content = content.replace(/{\/\*[\s\S]*?\*\/}/g, '');
  // Replace :::info / :::warning / :::danger Admonitions with blockquotes
  content = content.replace(/:::(info|tip|note|warning|danger)\[?(.*?)\]?/g, '> **[$1] $2**');
  content = content.replace(/:::/g, '');
  return content.trim();
}

function parseFrontmatter(rawContent) {
  const normalized = rawContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let title = '';
  let description = '';
  let slug = '';
  let body = normalized;

  if (normalized.startsWith('---')) {
    const endIdx = normalized.indexOf('\n---', 3);
    if (endIdx !== -1) {
      const fm = normalized.slice(3, endIdx);
      body = normalized.slice(endIdx + 4);
      for (const rawLine of fm.split('\n')) {
        const line = rawLine.trim();
        const titleMatch = line.match(/^title:\s*["']?(.*?)["']?$/);
        if (titleMatch) title = titleMatch[1].trim();
        const descMatch = line.match(/^description:\s*["']?(.*?)["']?$/);
        if (descMatch) description = descMatch[1].trim();
        const slugMatch = line.match(/^slug:\s*["']?(.*?)["']?$/);
        if (slugMatch) slug = slugMatch[1].trim();
      }
    }
  }

  return { title, description, slug, body };
}

function getDocUrl(relPath, slug) {
  // Docusaurus mapping
  if (slug === '/') return 'https://olake.io/docs/';
  if (slug && slug.startsWith('/')) return `https://olake.io${slug}`;

  // Normalize path
  let cleanPath = relPath.replace(/\\/g, '/');
  if (cleanPath.startsWith('docs/')) {
    cleanPath = cleanPath.slice(5);
  }
  cleanPath = cleanPath.replace(/\.(md|mdx)$/, '');
  if (cleanPath.endsWith('/index')) {
    cleanPath = cleanPath.slice(0, -6);
  }
  return `https://olake.io/docs/${cleanPath}`;
}

function getGithubUrl(repoName, commitSha, relPath, lineStart, lineEnd) {
  const lineAnchor = lineStart ? `#L${lineStart}-L${lineEnd || lineStart}` : '';
  const ref = commitSha !== 'unknown' ? commitSha : 'main';
  return `https://github.com/${repoName}/blob/${ref}/${relPath.replace(/\\/g, '/')}${lineAnchor}`;
}

function chunkDocument(doc) {
  const lines = doc.rawContent.split('\n');
  const chunks = [];
  let currentSection = doc.title || 'Overview';
  let currentLines = [];
  let chunkStartLine = 1;

  function flushChunk(endLine) {
    const text = currentLines.join('\n').trim();
    if (text.length > 50) {
      const chunkId = `${doc.repo.replace(/[^a-zA-Z0-9]/g, '_')}_${doc.relPath.replace(/[^a-zA-Z0-9]/g, '_')}_L${chunkStartLine}`;
      
      let primaryUrl = doc.docUrl || getGithubUrl(doc.repo, doc.commitSha, doc.relPath, chunkStartLine, endLine);

      chunks.push({
        chunk_id: chunkId,
        repository: doc.repo,
        file_path: doc.relPath.replace(/\\/g, '/'),
        title: doc.title,
        section: currentSection,
        text: text,
        url: primaryUrl,
        github_url: getGithubUrl(doc.repo, doc.commitSha, doc.relPath, chunkStartLine, endLine),
        line_start: chunkStartLine,
        line_end: endLine,
        commit_sha: doc.commitSha
      });
    }
    currentLines = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^\s*(#{1,3})\s+(.*)$/);

    if (headingMatch) {
      if (currentLines.length > 0) {
        flushChunk(i);
      }
      currentSection = headingMatch[2]
        .replace(/\{#.*?\}/g, '')
        .replace(/<.*?>/g, '')
        .replace(/\*\*/g, '')
        .trim();
      chunkStartLine = i + 1;
      currentLines.push(line);
    } else {
      currentLines.push(line);
      // Split if section gets too large (over 3000 chars)
      if (currentLines.join('\n').length > 3000 && line.trim() === '') {
        flushChunk(i + 1);
        chunkStartLine = i + 2;
      }
    }
  }

  if (currentLines.length > 0) {
    flushChunk(lines.length);
  }

  return chunks;
}

function walkDir(dir, baseDir = dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    if (file.startsWith('.') || file === 'node_modules' || file === 'target' || file === 'vendor') continue;
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results = results.concat(walkDir(full, baseDir));
    } else {
      results.push({
        fullPath: full,
        relPath: path.relative(baseDir, full)
      });
    }
  }
  return results;
}

export async function ingestDocs() {
  console.log('--- Starting OLake Documentation Ingestion ---');
  const allChunks = [];
  const manifest = {
    generated_at: new Date().toISOString(),
    repositories: {},
    total_documents: 0,
    total_chunks: 0
  };

  for (const repo of REPOS) {
    ensureRepo(repo);
    const commitSha = getCommitSha(repo.dir);
    console.log(`Processing ${repo.name} (SHA: ${commitSha})...`);

    const repoDocCount = { documents: 0, chunks: 0 };
    manifest.repositories[repo.name] = {
      commit_sha: commitSha,
      documents: 0,
      chunks: 0,
      source_url: repo.cloneUrl.replace('.git', '')
    };

    const files = walkDir(repo.dir);

    for (const file of files) {
      const rel = file.relPath.replace(/\\/g, '/');
      const ext = path.extname(file.fullPath).toLowerCase();

      // Check inclusion
      const isIncluded = repo.include.some(inc => rel === inc || rel.startsWith(inc + '/'));
      if (!isIncluded) continue;

      // Filter relevant file extensions
      const isDoc = ext === '.md' || ext === '.mdx';
      const isConfig = (ext === '.yaml' || ext === '.yml' || ext === '.json' || ext === '.conf' || ext === '.sh') && 
        (rel.includes('compose') || rel.includes('values') || rel.includes('config') || rel.includes('api-contract') || rel.includes('platforms'));

      if (!isDoc && !isConfig) continue;

      try {
        const raw = fs.readFileSync(file.fullPath, 'utf8');
        if (!raw.trim()) continue;

        let title = path.basename(rel, ext);
        let cleanedContent = raw;
        let docUrl = null;

        if (isDoc) {
          const fm = parseFrontmatter(raw);
          if (fm.title) title = fm.title;
          cleanedContent = cleanMdx(fm.body);
          if (repo.type === 'docs' && rel.startsWith('docs/')) {
            docUrl = getDocUrl(rel, fm.slug);
          }
        }

        const docObj = {
          repo: repo.name,
          relPath: rel,
          title: title,
          rawContent: cleanedContent,
          docUrl: docUrl,
          commitSha: commitSha
        };

        const chunks = chunkDocument(docObj);
        allChunks.push(...chunks);

        repoDocCount.documents++;
        repoDocCount.chunks += chunks.length;
      } catch (err) {
        console.warn(`Error processing ${rel}: ${err.message}`);
      }
    }

    manifest.repositories[repo.name].documents = repoDocCount.documents;
    manifest.repositories[repo.name].chunks = repoDocCount.chunks;
    manifest.total_documents += repoDocCount.documents;
    manifest.total_chunks += repoDocCount.chunks;
    console.log(`  -> Indexed ${repoDocCount.documents} documents into ${repoDocCount.chunks} chunks.`);
  }

  // Save corpus and manifest
  const corpusPath = path.join(knowledgeDir, 'corpus.json');
  const manifestPath = path.join(knowledgeDir, 'manifest.json');

  console.log(`Writing corpus to ${corpusPath}...`);
  fs.writeFileSync(corpusPath, JSON.stringify(allChunks, null, 2), 'utf8');

  console.log(`Writing manifest to ${manifestPath}...`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`Ingestion completed! Total chunks: ${allChunks.length}`);
  return { manifest, chunkCount: allChunks.length };
}

// Allow direct CLI execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  ingestDocs().catch(err => {
    console.error('Ingestion failed:', err);
    process.exit(1);
  });
}
