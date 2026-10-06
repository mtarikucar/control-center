import { describe, expect, it } from 'vitest';
import { canResume, canStop, lifecycleLabel } from './labels.ts';

describe('sleeping', () => {
  it('is shown as Uyuyor, can be woken (Devam) and stopped', () => {
    expect(lifecycleLabel('sleeping')).toBe('Uyuyor');
    expect(canResume('sleeping')).toBe(true);
    expect(canStop('sleeping')).toBe(true);
  });
});
