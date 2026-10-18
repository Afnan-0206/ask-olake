import React from 'react';
import { Terminal, Database, Layers, Server, RefreshCw, AlertCircle } from 'lucide-react';

export const STARTER_PROMPTS = [
  {
    icon: Terminal,
    text: 'How do I get started with OLake using Docker Compose?'
  },
  {
    icon: Database,
    text: 'Which sync modes are documented for PostgreSQL?'
  },
  {
    icon: Layers,
    text: 'How does OLake configure an Iceberg catalog?'
  },
  {
    icon: Server,
    text: 'How do I deploy OLake using Helm?'
  },
  {
    icon: RefreshCw,
    text: 'What does OLake Fusion do?'
  },
  {
    icon: AlertCircle,
    text: 'How should I investigate a source configuration error?'
  }
];

export function StarterQuestions({ onSelectQuestion, disabled }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {STARTER_PROMPTS.map((prompt, idx) => {
        const Icon = prompt.icon;
        return (
          <button
            key={idx}
            className="flex items-start gap-2.5 rounded-xl border border-border/80 bg-card/60 p-3 text-left text-xs leading-relaxed text-foreground/90 transition-all hover:border-primary/50 hover:bg-card hover:shadow-sm disabled:pointer-events-none disabled:opacity-50"
            onClick={() => onSelectQuestion(prompt.text)}
            disabled={disabled}
            type="button"
          >
            <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
            <span className="flex-1">{prompt.text}</span>
          </button>
        );
      })}
    </div>
  );
}
