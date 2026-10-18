import React, { useState } from 'react';
import ChatComposer, { ChatSectionProps } from '@/components/ui/chat';

const TOPIC_SECTIONS: Record<string, ChatSectionProps[]> = {
  Connectors: [
    {
      label: 'PostgreSQL Connector',
      sub: 'pgoutput plugin',
      time: 'v1.0+',
      body: 'Full Refresh, Full Refresh + CDC, CDC Only, and Incremental sync modes supported. wal2json is deprecated.'
    },
    {
      label: 'MongoDB Connector',
      sub: 'Change Streams',
      time: 'CDC',
      body: 'Replicates oplog and change stream events directly to Apache Iceberg tables.'
    }
  ],
  Compaction: [
    {
      label: 'Lite Compaction',
      sub: 'Frequent / Low compute',
      time: 'Precedence 3',
      body: 'Merges small fragment files and converts Equality Deletes to Position Deletes.'
    },
    {
      label: 'Medium & Full Compaction',
      sub: 'Deep Optimization',
      time: 'Precedence 1 & 2',
      body: 'Merges segment files up to target file size and executes full copy-on-write table rewrites.'
    }
  ],
  Deployment: [
    {
      label: 'Docker Compose',
      sub: 'Local Evaluation',
      time: 'Port 8000',
      body: 'One-command quickstart spinning up OLake UI, Temporal worker, and Iceberg destination.'
    },
    {
      label: 'Kubernetes Helm Chart',
      sub: 'Production',
      time: 'values.yaml',
      body: 'Helm repository https://datazip-inc.github.io/olake-helm with Temporal and MinIO/S3 support.'
    }
  ]
};

export function TopicExplorer({ onSelectTopicPrompt }: { onSelectTopicPrompt: (query: string) => void }) {
  const [activeTab, setActiveTab] = useState('Connectors');

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Interactive Topic Explorer
        </span>
        <span className="text-[10px] text-muted-foreground">Select a tab or ask below</span>
      </div>
      <ChatComposer
        tabs={['Connectors', 'Compaction', 'Deployment']}
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab)}
        sections={TOPIC_SECTIONS[activeTab] || TOPIC_SECTIONS['Connectors']}
        onSend={(msg) => onSelectTopicPrompt(msg)}
        placeholder="Type a topic question to send directly to Ask OLake..."
        className="w-full max-w-full"
      />
    </div>
  );
}
