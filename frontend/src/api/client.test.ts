import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './client';

interface FetchCall {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
}

/** Minimal Response-like object — the client only touches status/ok/json(). */
function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

function getCall(mock: ReturnType<typeof vi.fn>, index: number): FetchCall {
  const [url, init] = mock.mock.calls[index];
  return { url: url as string, init: init as FetchCall['init'] };
}

describe('ApiClient auth/refresh/error contract', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    api.setTokens('access-old', 'refresh-1');
  });

  afterEach(() => {
    api.clearTokens();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the server envelope untouched and sends Authorization: Bearer <token>', async () => {
    const envelope = {
      status: 'ok',
      data: { user_id: 'u1', display_name: 'Dylan' },
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(envelope));

    const result = await api.getProfile();

    expect(result).toEqual(envelope);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, init } = getCall(fetchMock, 0);
    expect(url).toBe('/api/v1/profile');
    expect(init.method).toBe('GET');
    expect(init.headers['Authorization']).toBe('Bearer access-old');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBeUndefined();
  });

  it('on 401, refreshes with the stored refresh token and replays with the NEW access token', async () => {
    const finalEnvelope = { status: 'ok', data: [{ id: 'p1', name: 'Main' }] };

    // 1st: original request -> 401
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'error' }, 401));
    // 2nd: refresh -> new token pair
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 'ok',
        data: { access_token: 'access-new', refresh_token: 'refresh-2' },
      }),
    );
    // 3rd: replayed original request -> success
    fetchMock.mockResolvedValueOnce(jsonResponse(finalEnvelope));

    const result = await api.getPortfolios();

    expect(result).toEqual(finalEnvelope);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Refresh call shape
    const refreshCall = getCall(fetchMock, 1);
    expect(refreshCall.url).toBe('/api/v1/auth/refresh');
    expect(refreshCall.init.method).toBe('POST');
    expect(JSON.parse(refreshCall.init.body as string)).toEqual({
      refresh_token: 'refresh-1',
    });

    // Replay carries the NEW access token
    const replayCall = getCall(fetchMock, 2);
    expect(replayCall.url).toBe('/api/v1/portfolios');
    expect(replayCall.init.headers['Authorization']).toBe('Bearer access-new');

    // Rotated tokens are persisted
    expect(api.getAccessToken()).toBe('access-new');
    expect(localStorage.getItem('ss_access_token')).toBe('access-new');
    expect(localStorage.getItem('ss_refresh_token')).toBe('refresh-2');
  });

  it('on refresh failure, clears tokens and returns the auth_expired envelope', async () => {
    // jsdom logs "Not implemented: navigation" via console.error when
    // window.location.href is assigned — silence it for this test.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // 1st: original request -> 401; 2nd: refresh -> 401
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'error' }, 401));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'error', error: { code: 'invalid_token', message: 'nope' } }, 401),
    );

    const result = await api.getProfile();

    expect(result).toEqual({
      status: 'error',
      error: { code: 'auth_expired', message: 'Session expired' },
    });
    // Original request was NOT replayed
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Tokens cleared from memory and storage
    expect(api.isAuthenticated()).toBe(false);
    expect(api.getAccessToken()).toBeNull();
    expect(localStorage.getItem('ss_access_token')).toBeNull();
    expect(localStorage.getItem('ss_refresh_token')).toBeNull();
  });

  it('a network failure during refresh is non-fatal and still yields auth_expired', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'error' }, 401));
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await api.getProfile();

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('auth_expired');
    expect(api.isAuthenticated()).toBe(false);
  });

  it('does not attempt a refresh on 401 when no refresh token is stored', async () => {
    api.clearTokens();
    const envelope = {
      status: 'error',
      error: { code: 'unauthorized', message: 'Missing token' },
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(envelope, 401));

    const result = await api.getProfile();

    // Envelope passed through from the server, no refresh call made
    expect(result).toEqual(envelope);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { init } = getCall(fetchMock, 0);
    expect(init.headers['Authorization']).toBeUndefined();
  });

  it('returns the network error envelope when fetch rejects', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await api.getProfile();

    expect(result).toEqual({
      status: 'error',
      error: { code: 'network', message: 'Network error. Please check your connection.' },
    });
  });

  it('serializes request bodies as JSON on POST', async () => {
    const envelope = { status: 'ok', data: { ticker: 'NVDA' } };
    fetchMock.mockResolvedValueOnce(jsonResponse(envelope));

    const result = await api.addToWatchlist('NVDA');

    expect(result).toEqual(envelope);
    const { url, init } = getCall(fetchMock, 0);
    expect(url).toBe('/api/v1/watchlist');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ ticker: 'NVDA' });
  });
});
