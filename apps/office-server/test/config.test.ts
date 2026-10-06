import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, loadConfig } from '../src/config.ts';

describe('loadConfig', () => {
  it('defaults to ~/.control-center on 127.0.0.1:4319 with the real claude and no extra origins', () => {
    const c = loadConfig({});
    expect(c.dataDir).toBe(join(homedir(), '.control-center'));
    expect(c.host).toBe('127.0.0.1');
    expect(c.port).toBe(4319);
    expect(c.claudeCommand).toEqual(['claude']);
    expect(c.deskCount).toBe(8);
    expect(c.allowedOrigins).toEqual([]);
  });

  it('reads overrides from the environment', () => {
    const c = loadConfig({
      OFFICE_DATA_DIR: '/tmp/office-x',
      OFFICE_PORT: '5000',
      OFFICE_CLAUDE_COMMAND: '["node","fake.mjs"]',
      OFFICE_ALLOWED_ORIGINS: 'http://a.test, http://b.test',
    });
    expect(c.dataDir).toBe('/tmp/office-x');
    expect(c.port).toBe(5000);
    expect(c.claudeCommand).toEqual(['node', 'fake.mjs']);
    expect(c.allowedOrigins).toEqual(['http://a.test', 'http://b.test']);
  });

  it('refuses a data directory inside the repository', () => {
    expect(() => loadConfig({ OFFICE_DATA_DIR: join(REPO_ROOT, 'office-data') })).toThrow(/repo/);
    expect(() => loadConfig({ OFFICE_DATA_DIR: REPO_ROOT })).toThrow(/repo/);
  });

  it('rejects a bad port or claude command', () => {
    expect(() => loadConfig({ OFFICE_PORT: 'abc' })).toThrow(/OFFICE_PORT/);
    expect(() => loadConfig({ OFFICE_CLAUDE_COMMAND: 'claude' })).toThrow(/OFFICE_CLAUDE_COMMAND/);
  });
});
