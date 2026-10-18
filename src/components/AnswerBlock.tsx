import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

export function AnswerBlock({ text, sources }) {
  if (!text) return null;

  const parts = [];
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'code', lang: match[1], code: match[2] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return (
    <div className="space-y-3 text-[13px] leading-relaxed text-foreground">
      {parts.map((part, pIdx) => {
        if (part.type === 'code') {
          return <CodeBlock key={pIdx} code={part.code.trim()} lang={part.lang} />;
        }

        const paragraphs = part.content.split(/\n\s*\n/);
        return (
          <React.Fragment key={pIdx}>
            {paragraphs.map((para, paraIdx) => {
              const trimmed = para.trim();
              if (!trimmed) return null;

              if (trimmed.startsWith('#')) {
                const cleanHeader = trimmed.replace(/^#+\s*/, '').replace(/#+/g, '');
                return (
                  <h4 key={paraIdx} className="font-bold text-zinc-900 text-sm mt-3 mb-1">
                    {renderInline(cleanHeader, sources)}
                  </h4>
                );
              }

              if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                const items = trimmed.split('\n').filter(l => l.trim().startsWith('- ') || l.trim().startsWith('* '));
                return (
                  <ul key={paraIdx} className="my-2 ml-5 list-disc space-y-1 text-muted-foreground">
                    {items.map((item, itemIdx) => (
                      <li key={itemIdx} className="leading-snug text-foreground">
                        {renderInline(item.replace(/^[-*]\s+/, '').replace(/#+/g, ''), sources)}
                      </li>
                    ))}
                  </ul>
                );
              }

              if (/^\d+\.\s+/.test(trimmed)) {
                const items = trimmed.split('\n').filter(l => /^\d+\.\s+/.test(l.trim()));
                return (
                  <ol key={paraIdx} className="my-2 ml-5 list-decimal space-y-1 text-muted-foreground">
                    {items.map((item, itemIdx) => (
                      <li key={itemIdx} className="leading-snug text-foreground">
                        {renderInline(item.replace(/^\d+\.\s+/, '').replace(/#+/g, ''), sources)}
                      </li>
                    ))}
                  </ol>
                );
              }

              return <p key={paraIdx} className="leading-normal">{renderInline(trimmed.replace(/#+/g, ''), sources)}</p>;
            })}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function CodeBlock({ code, lang }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="relative my-2.5 overflow-hidden rounded-lg border border-border bg-[#030712] font-mono text-[12px]">
      <div className="flex items-center justify-between border-b border-border/40 bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground">
        <span>{lang || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          {copied ? <Check className="size-3 text-green-400" /> : <Copy className="size-3" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-slate-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderInline(text, sources = []) {
  const regex = /(\[\d+\])|(`[^`]+`)|(\*\*[^*]+\*\*)/g;
  const elements = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      elements.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith('[') && token.endsWith(']')) {
      const num = parseInt(token.slice(1, -1), 10);
      const targetUrl = sources && sources[num - 1];

      elements.push(
        targetUrl ? (
          <a
            key={match.index}
            href={targetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="citation-link"
            title={`Verified official source: ${targetUrl}`}
          >
            [{num}]
          </a>
        ) : (
          <span key={match.index} className="citation-link">
            [{num}]
          </span>
        )
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      elements.push(
        <code key={match.index} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11.5px] text-sky-400">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      elements.push(<strong key={match.index} className="font-semibold text-foreground">{token.slice(2, -2)}</strong>);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    elements.push(text.slice(lastIndex));
  }

  return elements;
}
