import { useState, useCallback, useRef } from 'react';
import { api } from '../api/client';

export interface AgentProgress {
  agent: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  durationMs?: number;
  error?: string;
}

interface StreamResult {
  alertId?: string;
  title?: string;
  synthesis?: Record<string, unknown>;
  durationMs?: number;
  tokensUsed?: number;
  cached?: boolean;
  cacheMessage?: string;
}

interface UseIntelligenceStreamReturn {
  /** Start the SSE stream */
  start: () => void;
  /** Abort the stream */
  abort: () => void;
  /** Whether the stream is active */
  isStreaming: boolean;
  /** Per-agent progress map */
  agents: Record<string, AgentProgress>;
  /** Current status message */
  statusMessage: string;
  /** Final result when complete */
  result: StreamResult | null;
  /** Error message if stream fails */
  error: string | null;
  /** Current agent index (1-based) */
  currentIndex: number;
  /** Total agent count */
  totalAgents: number;
}

const AGENT_LABELS: Record<string, string> = {
  sentiment: 'Analyzing news sentiment',
  polymarket: 'Checking prediction markets',
  insider: 'Scanning insider activity',
  institutional: 'Reviewing institutional flow',
  macro: 'Evaluating macro context',
  profile: 'Running profile analysis',
  synthesis: 'Synthesizing intelligence',
};

/**
 * Hook that connects to the /intelligence/stream SSE endpoint
 * and provides real-time agent progress updates.
 *
 * Uses fetch + ReadableStream (not EventSource) to support
 * Authorization headers for authenticated requests.
 */
export function useIntelligenceStream(): UseIntelligenceStreamReturn {
  const [isStreaming, setIsStreaming] = useState(false);
  const [agents, setAgents] = useState<Record<string, AgentProgress>>({});
  const [statusMessage, setStatusMessage] = useState('');
  const [result, setResult] = useState<StreamResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [totalAgents, setTotalAgents] = useState(7);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(() => {
    // Reset state
    setIsStreaming(true);
    setAgents({});
    setStatusMessage('Connecting...');
    setResult(null);
    setError(null);
    setCurrentIndex(0);

    const controller = new AbortController();
    abortRef.current = controller;

    const token = api.getAccessToken();

    fetch('/api/v1/intelligence/stream', {
      headers: {
        Authorization: token ? `Bearer ${token}` : '',
      },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Stream failed: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';

        const read = (): Promise<void> =>
          reader.read().then(({ done, value }) => {
            if (done) {
              setIsStreaming(false);
              return;
            }

            buffer += decoder.decode(value, { stream: true });

            // Parse SSE events from buffer
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            let currentEvent = '';
            let currentData = '';

            for (const line of lines) {
              if (line.startsWith('event: ')) {
                currentEvent = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                currentData = line.slice(6);
              } else if (line === '' && currentEvent && currentData) {
                // End of event — process it
                try {
                  const data = JSON.parse(currentData);
                  handleEvent(currentEvent, data);
                } catch {
                  // Skip malformed events
                }
                currentEvent = '';
                currentData = '';
              }
            }

            return read();
          });

        return read();
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setError(err.message || 'Stream connection failed');
          setIsStreaming(false);
        }
      });
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const handleEvent = useCallback((event: string, data: Record<string, unknown>) => {
    switch (event) {
      case 'status':
        setStatusMessage(data.message as string || '');
        break;

      case 'agent_start':
        setAgents((prev) => ({
          ...prev,
          [data.agent as string]: {
            agent: data.agent as string,
            status: 'running',
          },
        }));
        setCurrentIndex(data.index as number || 0);
        setTotalAgents(data.total as number || 7);
        setStatusMessage(AGENT_LABELS[data.agent as string] || `Running ${data.agent}...`);
        break;

      case 'agent_done':
        setAgents((prev) => ({
          ...prev,
          [data.agent as string]: {
            agent: data.agent as string,
            status: data.status as 'completed' | 'failed',
            durationMs: data.duration_ms as number | undefined,
            error: data.error as string | undefined,
          },
        }));
        break;

      case 'complete':
        setResult({
          alertId: data.alert_id as string | undefined,
          title: data.title as string | undefined,
          synthesis: data.synthesis as Record<string, unknown> | undefined,
          durationMs: data.duration_ms as number | undefined,
          tokensUsed: data.tokens_used as number | undefined,
          cached: data.cached as boolean | undefined,
          cacheMessage: data.cache_message as string | undefined,
        });
        setStatusMessage('Complete');
        setIsStreaming(false);
        break;

      case 'error':
        setError(data.message as string || 'Unknown error');
        setIsStreaming(false);
        break;
    }
  }, []);

  return {
    start,
    abort,
    isStreaming,
    agents,
    statusMessage,
    result,
    error,
    currentIndex,
    totalAgents,
  };
}
