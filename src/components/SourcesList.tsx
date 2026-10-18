import React from 'react';
import { ExternalLink, BookOpen, GitBranch } from 'lucide-react';

function formatSourceLabel(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('olake.io')) {
      const cleanPath = parsed.pathname.replace(/^\/docs\/?/, '').replace(/\/$/, '');
      return cleanPath ? `olake.io/docs/${cleanPath}` : 'olake.io/docs';
    }
    if (parsed.hostname.includes('github.com')) {
      const parts = parsed.pathname.split('/');
      const repo = parts[2] || 'repo';
      const file = parts.slice(5).join('/') || parts.slice(2).join('/');
      return `${repo}/${file}`;
    }
    return url;
  } catch {
    return url;
  }
}

export function SourcesList({ sources }) {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="mt-4 border-t border-border/50 pt-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        <BookOpen className="size-3.5 text-primary" />
        <span>Verified Sources ({sources.length})</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {sources.map((url, idx) => {
          const isDoc = url.includes('olake.io');
          const isGithub = url.includes('github.com');
          return (
            <a
              key={idx}
              id={`source-${idx + 1}`}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-1.5 text-[12px] text-blue-400 transition-all hover:border-primary/40 hover:bg-muted/50 hover:text-blue-300"
              title={url}
            >
              <span className="font-mono text-[11px] font-semibold text-primary">[{idx + 1}]</span>
              {isGithub ? <GitBranch className="size-3.5 shrink-0 opacity-70" /> : <BookOpen className="size-3.5 shrink-0 opacity-70" />}
              <span className="flex-1 truncate font-mono text-[11.5px]">{formatSourceLabel(url)}</span>
              <ExternalLink className="size-3 shrink-0 opacity-50 transition-opacity group-hover:opacity-100" />
            </a>
          );
        })}
      </div>
    </div>
  );
}
