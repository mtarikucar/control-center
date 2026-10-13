import { describe, expect, it } from 'vitest';
import { WORK_TYPES } from '@cc/shared';
import { departmentTemplate, listDepartmentTemplates, parseDepartmentTemplate, scopeSection, templateScope } from '../src/company/department-templates.ts';
import { roleTemplate } from '../src/company/role-templates.ts';

const SAMPLE = `---
id: ornek
version: 1
name: Örnek
mission: Örnek işleri yapar.
head: editor
roles:
- arastirmaci: Araştırma birikince.
methods:
- research
routines:
- Haftalık özet (cuma 17:00)
checks:
- Kaynak gösterilmiş.
kpis:
- Zamanında teslim oranı.
---
### Yapar

- Örnek iş.

### Yapmaz

- Başka iş (Pazarlama).

### Sana gelir

- Her gönderim.
`;

describe('Department templates — the format', () => {
  it('reads the front matter and the body', () => {
    expect(parseDepartmentTemplate('ornek', SAMPLE)).toEqual({
      id: 'ornek', version: 1, name: 'Örnek', mission: 'Örnek işleri yapar.', head: 'editor',
      roles: [{ template: 'arastirmaci', when: 'Araştırma birikince.' }], methods: ['research'], routines: ['Haftalık özet (cuma 17:00)'],
      checks: ['Kaynak gösterilmiş.'], kpis: ['Zamanında teslim oranı.'],
      body: '### Yapar\n\n- Örnek iş.\n\n### Yapmaz\n\n- Başka iş (Pazarlama).\n\n### Sana gelir\n\n- Her gönderim.',
    });
  });

  it('refuses what does not hold', () => {
    const bad: Array<[string, string, RegExp]> = [
      ['ornek', SAMPLE.replace('---\nid', 'id'), /ön bilgi bloğu yok/],
      ['ornek', SAMPLE.replace('name: Örnek\n', ''), /“name” eksik/],
      ['ornek', SAMPLE.replace('head: editor', 'head: yok'), /başkanın rol şablonu “yok” katalogda yok/],
      ['ornek', SAMPLE.replace('- arastirmaci: Araştırma birikince.', '- arastirmaci'), /“arastirmaci” maddesi “<şablon>: <ne zaman>” biçiminde olmalı/],
      ['ornek', SAMPLE.replace('- arastirmaci: Araştırma birikince.', '- yok: bazen'), /önerilen rol şablonu “yok” katalogda yok/],
      ['ornek', SAMPLE.replace('- research', '- dance'), /bilinmeyen yöntem “dance”/],
      ['ornek', SAMPLE.replace('version: 1', 'version: 0'), /version pozitif/],
      ['ornek', SAMPLE.replace('mission:', 'color: kırmızı\nmission:'), /“color” bilinmeyen alan/],
      ['baska', SAMPLE, /id “ornek” dosya adıyla aynı olmalı/],
      ['ornek', SAMPLE.replace('### Sana gelir', '### Son'), /gövdede “### Sana gelir” yok/],
    ];
    for (const [id, text, error] of bad) expect(() => parseDepartmentTemplate(id, text), String(error)).toThrow(error);
  });

  it('the scope a department gets: the body, then the checks, measures, routine suggestions and suggested roles', () => {
    const t = parseDepartmentTemplate('ornek', SAMPLE);
    const scope = templateScope(t);
    expect(scope).toBe(
      `${t.body}\n\n### Kalite kontrolleri\n\n- Kaynak gösterilmiş.\n\n### Ölçüler\n\n- Zamanında teslim oranı.\n\n### Rutin önerileri\n\n- Haftalık özet (cuma 17:00)\n\n### Önerilen roller\n\n- arastirmaci (Araştırmacı): Araştırma birikince.`,
    );
    expect(scopeSection(scope, 'Yapmaz')).toBe('- Başka iş (Pazarlama).');
    expect(scopeSection(scope, 'Yok')).toBe('');
    expect(scopeSection('serbest metin', 'Yapmaz')).toBe('');
  });
});

describe('Department templates — the catalog', () => {
  it('ships the five departments the owner chose, each whole (spec Ek A)', () => {
    const all = listDepartmentTemplates();
    expect(all.map((t) => t.id)).toEqual(['ic-dis-iletisim', 'operasyon-finans', 'pazarlama', 'satis', 'yazilim-otomasyon']);
    expect(all.map((t) => t.name)).toEqual(['İç-Dış İletişim', 'Operasyon ve Finans', 'Pazarlama', 'Satış', 'Yazılım ve Otomasyon']);
    const heads = Object.fromEntries(all.map((t) => [t.id, t.head]));
    expect(heads).toEqual({ 'ic-dis-iletisim': 'iletisim-yoneticisi', 'operasyon-finans': 'operasyon-finans-yoneticisi', pazarlama: 'pazarlama-muduru', satis: 'satis-muduru', 'yazilim-otomasyon': 'teknik-lider' });
    for (const t of all) {
      expect(roleTemplate(t.head).team, t.id).toBe(t.name);
      expect(t.roles.length, t.id).toBe(2);
      for (const r of t.roles) expect(roleTemplate(r.template).team, `${t.id} ${r.template}`).toBe(t.name);
      for (const m of t.methods) expect(WORK_TYPES).toContain(m);
      expect(t.checks.length, t.id).toBeGreaterThan(1);
      expect(t.kpis.length, t.id).toBeGreaterThan(1);
      expect(scopeSection(templateScope(t), 'Yapmaz'), t.id).not.toBe('');
    }
    // Everything that comes in from outside is İletişim's (spec Ek A sınır haritası).
    expect(departmentTemplate('ic-dis-iletisim').body).toMatch(/DM/);
    expect(() => departmentTemplate('yok')).toThrow(/Bilinmeyen departman şablonu: yok\. Şablonlar: ic-dis-iletisim, operasyon-finans/);
  });

  it('spec capabilities §9: İç-Dış İletişim, Pazarlama and Satış v2 — only the critical goes to the owner, the rest is in the outbox; a daily outbox sample is suggested', () => {
    for (const id of ['ic-dis-iletisim', 'pazarlama', 'satis']) {
      const t = departmentTemplate(id);
      expect(t.version, id).toBe(2);
      const owner = scopeSection(templateScope(t), 'Sana gelir');
      expect(owner, id).not.toMatch(/^- Her (gönderim|yayın)/m);
      expect(owner, id).toMatch(/giden kutusuna yazılır/);
      expect(t.routines.some((r) => r.startsWith('Giden kutusundan örnek okuma')), id).toBe(true);
    }
    expect(scopeSection(templateScope(departmentTemplate('satis')), 'Sana gelir')).toMatch(/İYS/);
    // The first promotion without consent comes to the owner from İç-Dış İletişim too; a post is deleted only with the owner’s word.
    expect(scopeSection(templateScope(departmentTemplate('ic-dis-iletisim')), 'Sana gelir')).toMatch(/İYS/);
    expect(scopeSection(templateScope(departmentTemplate('pazarlama')), 'Sana gelir')).toMatch(/^- Bir yayını silmek\.$/m);
    // Bulk and special-contact sends are asked of the owner by the one who sends, whether or not the gate is on: no list says the gate takes them.
    for (const id of ['ic-dis-iletisim', 'pazarlama', 'satis']) {
      const owner = scopeSection(templateScope(departmentTemplate(id)), 'Sana gelir');
      expect(owner, id).toMatch(/özel kişi listendekilere giden mesaj: çalışan göndermeden önce sana sorar/);
      expect(owner, id).not.toMatch(/Kapının kuralına takılan/);
    }
    expect(departmentTemplate('yazilim-otomasyon').version).toBe(1);
  });
});
