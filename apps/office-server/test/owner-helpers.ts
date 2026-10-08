import { request as httpRequest } from 'node:http';

/**
 * What the office page sends with a change (owner-guard.ts): the browser's Origin and Sec-Fetch-Site, and a nonce the
 * page fetched with its own same-origin request. For tests that act as the owner through the page.
 */
export function pageHeaders(port: number): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method: 'GET', path: '/api/owner/nonce', headers: { 'sec-fetch-site': 'same-origin' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        const nonce = (JSON.parse(data || '{}') as { nonce?: string }).nonce;
        if (!nonce) return reject(new Error(`sayfa anahtarı alınamadı (HTTP ${res.statusCode}): ${data}`));
        resolve({ origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin', 'x-owner-nonce': nonce });
      });
    });
    req.on('error', reject);
    req.end();
  });
}
