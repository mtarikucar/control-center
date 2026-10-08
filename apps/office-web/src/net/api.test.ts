import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, resetOwnerNonce } from './api.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  resetOwnerNonce();
});

/** Answers every request with `body`; the page's nonce request with nonce n1. */
function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
    String(input) === '/api/owner/nonce'
      ? new Response(JSON.stringify({ nonce: 'n1', expiresAt: Date.now() + 3_600_000 }), { status: 200 })
      : new Response(body === undefined ? null : JSON.stringify(body), { status }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}
/** The calls other than the nonce request. */
const requests = (fn: ReturnType<typeof stubFetch>) => fn.mock.calls.filter(([input]) => String(input) !== '/api/owner/nonce');

describe('api', () => {
  it('sends JSON with the right method and path', async () => {
    const fetchFn = stubFetch(202, { ok: true });
    await api.send('e1', 'merhaba');
    expect(fetchFn).toHaveBeenCalledWith('/api/employees/e1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-owner-nonce': 'n1' },
      body: JSON.stringify({ text: 'merhaba' }),
    });
  });

  it('sends an empty JSON body for body-less POSTs and none for GET/DELETE', async () => {
    const fetchFn = stubFetch(200, {});
    await api.stop('e1');
    expect(requests(fetchFn)[0]?.[1]).toMatchObject({ method: 'POST', body: '{}' });
    await api.events('e1', 50);
    expect(requests(fetchFn)[1]?.[0]).toBe('/api/employees/e1/events?tail=50');
    expect(requests(fetchFn)[1]?.[1]).toMatchObject({ method: 'GET', body: undefined });
    stubFetch(204, undefined);
    await expect(api.fire('e1')).resolves.toBeNull();
  });

  it('reads the office metrics with a GET', async () => {
    const fetchFn = stubFetch(200, { generatedAt: 1 });
    await expect(api.metrics()).resolves.toEqual({ generatedAt: 1 });
    expect(fetchFn).toHaveBeenCalledWith('/api/metrics', { method: 'GET', body: undefined });
  });

  it('B9a (review round 1): a page driven by automation (navigator.webdriver, the employees’ browser) asks for no nonce and changes nothing; reads go on', async () => {
    const fetchFn = stubFetch(200, { ok: true });
    vi.stubGlobal('navigator', { webdriver: true });
    const err = await api.approveApproval('a1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'owner_automation', message: expect.stringMatching(/otomasyon/) });
    expect(fetchFn.mock.calls.map(([input]) => String(input))).toEqual([]);
    await api.office();
    expect(fetchFn.mock.calls.map(([input]) => String(input))).toEqual(['/api/office']);
  });

  it('turns error responses into ApiError with the server message', async () => {
    stubFetch(409, { error: 'Bu çalışan şu an terminalde; önce ofise geri al.' });
    const err = await api.send('e1', 'x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, message: 'Bu çalışan şu an terminalde; önce ofise geri al.' });
  });

  it('a change carries the nonce the page fetched for itself, reused until a minute before it expires; reads carry none', async () => {
    let issued = 0;
    const fetchFn = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === '/api/owner/nonce') {
        issued += 1;
        return new Response(JSON.stringify({ nonce: `n${issued}`, expiresAt: Date.now() + (issued === 1 ? 10 * 60_000 : 30_000) }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchFn);
    // A read on its own never asks for a nonce.
    await api.metrics();
    expect(fetchFn.mock.calls.map(([path]) => String(path))).toEqual(['/api/metrics']);
    fetchFn.mockClear();
    await api.send('e1', 'bir');
    await api.fire('e1');
    await api.metrics();
    const calls = fetchFn.mock.calls.map(([path, init]) => [String(path), init?.method, (init?.headers as Record<string, string> | undefined)?.['x-owner-nonce']]);
    expect(calls).toEqual([
      ['/api/owner/nonce', 'GET', undefined],
      ['/api/employees/e1/messages', 'POST', 'n1'],
      ['/api/employees/e1', 'DELETE', 'n1'],
      ['/api/metrics', 'GET', undefined],
    ]);
    // The second nonce has under a minute left: the next change fetches a fresh one first.
    resetOwnerNonce();
    await api.stop('e1');
    await api.stop('e1');
    expect(fetchFn.mock.calls.slice(4).map(([path, init]) => [String(path), (init?.headers as Record<string, string> | undefined)?.['x-owner-nonce']])).toEqual([
      ['/api/owner/nonce', undefined],
      ['/api/employees/e1/stop', 'n2'],
      ['/api/owner/nonce', undefined],
      ['/api/employees/e1/stop', 'n3'],
    ]);
  });

  it('a nonce the server no longer knows (it restarted) is fetched again once and the change retried', async () => {
    let issued = 0;
    const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/owner/nonce') {
        issued += 1;
        return new Response(JSON.stringify({ nonce: `n${issued}`, expiresAt: Date.now() + 3_600_000 }), { status: 200 });
      }
      const nonce = (init?.headers as Record<string, string>)['x-owner-nonce'] ?? '';
      sent.push(nonce);
      return nonce === 'n1'
        ? new Response(JSON.stringify({ error: 'Sayfanın anahtarı yok ya da süresi geçmiş; sayfayı yenile.', code: 'owner_nonce' }), { status: 403 })
        : new Response(JSON.stringify({ paused: true }), { status: 200 });
    }));
    await expect(api.pauseCompany()).resolves.toEqual({ paused: true });
    expect(sent).toEqual(['n1', 'n2']);
  });

  it('another refusal is not retried and keeps its code', async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === '/api/owner/nonce'
        ? new Response(JSON.stringify({ nonce: 'n1', expiresAt: Date.now() + 3_600_000 }), { status: 200 })
        : new Response(JSON.stringify({ error: 'Bu işlem yalnız ofis sayfasından yapılabilir (Origin başlığı yok).', code: 'owner_origin' }), { status: 403 }),
    );
    vi.stubGlobal('fetch', fetchFn);
    const err = await api.pauseCompany().catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 403, code: 'owner_origin' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

