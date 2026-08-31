import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useIntelligenceStream } from './useIntelligenceStream';
import { api } from '../api/client';

/**
 * Build a Response-like object whose body is a ReadableStream that emits
 * the given string chunks (encoded) in order, then closes.
 */
function sseResponse(chunks: string[], status = 200) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return { ok: status >= 200 && status < 300, status, body };
}

function frame(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

describe('useIntelligenceStream', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(api, 'getAccessToken').mockReturnValue('tok-123');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('processes a complete SSE conversation into agents map and final result', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        frame('status', { message: 'Warming up' }),
        frame('agent_start', { agent: 'sentiment', index: 1, total: 7 }),
        frame('agent_done', { agent: 'sentiment', status: 'completed', duration_ms: 1200 }),
        frame('agent_start', { agent: 'macro', index: 2, total: 7 }),
        frame('agent_done', { agent: 'macro', status: 'failed', error: 'FRED timeout' }),
        frame('complete', {
          alert_id: 'alert-42',
          title: 'Daily Intelligence',
          synthesis: { headline: 'Steady' },
          duration_ms: 9000,
          tokens_used: 4321,
        }),
      ]),
    );

    const { result } = renderHook(() => useIntelligenceStream());

    act(() => {
      result.current.start();
    });
    expect(result.current.isStreaming).toBe(true);

    await waitFor(() => expect(result.current.isStreaming).toBe(false));

    // Auth header from api.getAccessToken()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/intelligence/stream',
      expect.objectContaining({
        headers: { Authorization: 'Bearer tok-123' },
      }),
    );

    expect(result.current.agents).toEqual({
      sentiment: { agent: 'sentiment', status: 'completed', durationMs: 1200, error: undefined },
      macro: { agent: 'macro', status: 'failed', durationMs: undefined, error: 'FRED timeout' },
    });
    expect(result.current.result).toEqual({
      alertId: 'alert-42',
      title: 'Daily Intelligence',
      synthesis: { headline: 'Steady' },
      durationMs: 9000,
      tokensUsed: 4321,
      cached: undefined,
      cacheMessage: undefined,
    });
    expect(result.current.statusMessage).toBe('Complete');
    expect(result.current.currentIndex).toBe(2);
    expect(result.current.totalAgents).toBe(7);
    expect(result.current.error).toBeNull();
  });

  it('parses an SSE frame split across two chunks mid-line (buffer carryover)', async () => {
    // The data line for agent_start is cut in the middle of a JSON key,
    // exercising the buffer.split('\n')/pop() carryover logic.
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'event: agent_start\ndata: {"agen',
        't": "sentiment", "index": 1, "total": 6}\n\n' +
          frame('agent_done', { agent: 'sentiment', status: 'completed', duration_ms: 800 }) +
          frame('complete', { alert_id: 'alert-split' }),
      ]),
    );

    const { result } = renderHook(() => useIntelligenceStream());

    act(() => {
      result.current.start();
    });
    await waitFor(() => expect(result.current.isStreaming).toBe(false));

    // The split frame still parsed into a single valid event
    expect(result.current.agents.sentiment).toEqual({
      agent: 'sentiment',
      status: 'completed',
      durationMs: 800,
      error: undefined,
    });
    expect(result.current.currentIndex).toBe(1);
    expect(result.current.totalAgents).toBe(6);
    expect(result.current.result?.alertId).toBe('alert-split');
    expect(result.current.error).toBeNull();
  });

  it('skips a malformed frame without killing the stream', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'event: agent_start\ndata: {not json at all\n\n' + frame('complete', { alert_id: 'ok-1' }),
      ]),
    );

    const { result } = renderHook(() => useIntelligenceStream());

    act(() => {
      result.current.start();
    });
    await waitFor(() => expect(result.current.isStreaming).toBe(false));

    expect(result.current.agents).toEqual({});
    expect(result.current.result?.alertId).toBe('ok-1');
    expect(result.current.error).toBeNull();
  });

  it('an error event sets error state and ends streaming', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        frame('status', { message: 'Starting' }),
        frame('error', { message: 'Intelligence generation failed' }),
      ]),
    );

    const { result } = renderHook(() => useIntelligenceStream());

    act(() => {
      result.current.start();
    });
    await waitFor(() => expect(result.current.isStreaming).toBe(false));

    expect(result.current.error).toBe('Intelligence generation failed');
    expect(result.current.result).toBeNull();
  });

  it('a non-OK HTTP response surfaces as an error and ends streaming', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, body: null });

    const { result } = renderHook(() => useIntelligenceStream());

    act(() => {
      result.current.start();
    });
    await waitFor(() => expect(result.current.isStreaming).toBe(false));

    expect(result.current.error).toBe('Stream failed: 503');
  });
});
