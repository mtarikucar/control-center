import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WORK_TYPES } from '@cc/shared';
import { CRAFT_VERSION, METHOD_HEADINGS, coordinationText, methodText, pmText, workingText } from '../src/company/craft.ts';
import { officeGuide } from '../src/company/roles.ts';

describe('the coordination craft (ships with the office)', () => {
  it('has a method for every work type, each with the same headings in the same order', () => {
    for (const type of WORK_TYPES) {
      const text = readFileSync(new URL(`../src/company/craft/methods/${type}.md`, import.meta.url), 'utf8');
      const at = METHOD_HEADINGS.map((h) => text.indexOf(`\n${h}\n`));
      expect(at.every((i) => i > 0), `${type}: ${METHOD_HEADINGS.filter((_, i) => at[i]! < 0).join(', ')}`).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      expect(methodText(type)).toBe(text.trim());
    }
  });

  it('keeps the always-loaded parts short, and the core says its version', () => {
    expect(coordinationText()).toContain(`Koordinatörlük ${CRAFT_VERSION}`);
    expect(coordinationText().length).toBeLessThan(6000);
    expect(workingText().length).toBeLessThan(3000);
    expect(coordinationText()).toContain('methodRead');
    expect(coordinationText()).toContain('planRetro');
    expect(workingText()).toContain('reviewDecide');
    expect(workingText()).toContain('evidence');
  });

  it('without a type lists every type; an unknown type is refused in Turkish', () => {
    const list = methodText();
    for (const type of WORK_TYPES) expect(list).toContain(type);
    expect(() => methodText('poetry')).toThrow(/Bilinmeyen iş türü: poetry/);
  });

  it('falls back to the general method when a method file cannot be read, and to a line when none can', () => {
    const general = methodText('general');
    const missing = (name: string) => {
      if (name === 'methods/content.md') throw new Error('ENOENT');
      return general;
    };
    expect(methodText('content', missing)).toContain('okunamadı');
    expect(methodText('content', missing)).toContain(general);
    expect(methodText('content', () => { throw new Error('ENOENT'); })).toMatch(/Yöntem dosyaları okunamadı/);
  });

  it('gives coordinators and leads the core and everyone the working rules', () => {
    for (const kind of ['coordinator', 'lead'] as const) {
      expect(officeGuide(kind)).toContain(coordinationText());
      expect(officeGuide(kind)).toContain(workingText());
    }
    expect(officeGuide('member')).toContain(workingText());
    expect(officeGuide('member')).not.toContain(`Koordinatörlük ${CRAFT_VERSION}`);
    expect(officeGuide('coordinator')).toContain('methodRead');
  });

  it('points everyone to the office’s clock instead of Claude’s own scheduler', () => {
    expect(workingText()).toContain('taskPark');
    expect(workingText()).toContain('CronCreate');
    expect(coordinationText()).toContain('startAfter');
    expect(coordinationText()).toContain('scheduleCreate');
    expect(coordinationText()).toContain('agendaRead');
    expect(pmText()).toContain('taskPark');
  });

  it('the coordinator’s guide says it is the project manager and how autonomy works; leads and members do not get it', () => {
    expect(pmText()).toContain('goalSet');
    expect(pmText()).toContain('restUntil');
    expect(officeGuide('coordinator')).toContain(pmText());
    expect(officeGuide('lead')).not.toContain(pmText());
    expect(officeGuide('coordinator')).toMatch(/sahibi kartı onaylamadan/i);
  });
});
