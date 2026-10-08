import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api.ts';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(body === undefined ? null : JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('api', () => {
  it('sends JSON with the right method and path', async () => {
    const fetchFn = stubFetch(202, { ok: true });
    await api.send('e1', 'merhaba');
    expect(fetchFn).toHaveBeenCalledWith('/api/employees/e1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'merhaba' }),
    });
  });

  it('sends an empty JSON body for body-less POSTs and none for GET/DELETE', async () => {
    const fetchFn = stubFetch(200, {});
    await api.stop('e1');
    expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', body: '{}' });
    await api.events('e1', 50);
    expect(fetchFn.mock.calls[1]?.[0]).toBe('/api/employees/e1/events?tail=50');
    expect(fetchFn.mock.calls[1]?.[1]).toMatchObject({ method: 'GET', body: undefined });
    stubFetch(204, undefined);
    await expect(api.fire('e1')).resolves.toBeNull();
  });

  it('reads the office metrics with a GET', async () => {
    const fetchFn = stubFetch(200, { generatedAt: 1 });
    await expect(api.metrics()).resolves.toEqual({ generatedAt: 1 });
    expect(fetchFn).toHaveBeenCalledWith('/api/metrics', { method: 'GET', body: undefined });
  });

  it('turns error responses into ApiError with the server message', async () => {
    stubFetch(409, { error: 'Bu çalışan şu an terminalde; önce ofise geri al.' });
    const err = await api.send('e1', 'x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, message: 'Bu çalışan şu an terminalde; önce ofise geri al.' });
  });
});
