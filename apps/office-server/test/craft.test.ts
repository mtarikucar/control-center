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

  it('B1–B2: the coordinator does not brake itself — the office sets the limits — and a direction sends it to understand the work’s own world before building a team', () => {
    const flat = (text: string) => text.replace(/\s+/g, ' ');
    const pm = flat(pmText());
    expect(pm).toContain(
      '**Kendini kısıtlama.** Misyon için gereken her işi başlat, gereken kişiyi işe al, gereken modeli kullan. Sınırları ofis koyar (anayasa, sahibinin kota payı, sahibinin onayı gereken geri alınamaz işler); onların altında kendi kendine fren yapma, işi bekletme, "sonra" deme.',
    );
    expect(pm).toContain('**Yön gelince işi önce anla, sonra ekibi kur.** Sahibi bir iş, yön ya da ürün fikri verirse onu hemen işe çevir:');
    expect(pm).toContain('**Ne istendiğini netleştir.** İş ne, kimin için, başarı neye benzer? Bilmediğin en önemli bir-iki şeyi `reportToOwner` ile sahibine sor; cevabı beklemeden, varsayımını yazarak ilerle.');
    expect(pm).toContain('**Bu işin dünyasını kaynaktan öğren, varsayma.** Bu alanda iyi bir işletme gün gün ne yapar: hangi işler, hangi kurallar ve yükümlülükler, hangi riskler, hangi bilgi ve araçlar var? Ürün ya da yazılım geliştiriyorsan bile önce kullanıcıları, rakipleri ve var olan çözümleri öğren. Kendi bildiğin kalıba sığdırma; listeyi işin kendisinden çıkar.');
    expect(pm).toContain('**İşi akışlara böl.**');
    expect(pm).toContain('**Uzmanlığa göre kişi al.**');
    expect(pm).toContain('**Ekibin neye ihtiyacı olduğunu işten çıkar.**');
    expect(pm).toContain('**Öğrendiğini şirkete yaz.**');
    // The guide is the same for every company: no field-specific examples that pull every firm towards software.
    for (const text of [pmText(), coordinationText(), workingText()]) {
      for (const word of ['RAG', 'sosyal medya', 'entegrasyon']) expect(flat(text)).not.toContain(word);
    }
    expect(pm).not.toContain('iş icat etme');
    expect(pm).not.toContain('az hedef tut');
    expect(pm).toContain('Hedef sayısını işin gerektirdiği kadar tut; ulaşılanı `status: done`, vazgeçileni `dropped` ile kapat.');
    expect(pm).toMatch(/misyonda gerçekten yapılacak iş kalmadıysa.*`restUntil` ile ne zamana kadar ve neden/i);
    const core = flat(coordinationText());
    expect(core).not.toContain('En küçük yeterli ekip');
    expect(core).toContain('İşin gerektirdiği ekip ve model');
    expect(core).toContain('pahalı aşamaları bilerek planla, kota payını tahmine yaz');
    expect(core).not.toContain('az tut');
    expect(core).toContain('gereksiz rutin kurma');
    expect(officeGuide('coordinator')).toContain(pmText());
  });

  it('the coordinator’s guide says it is the project manager and how autonomy works; leads and members do not get it', () => {
    expect(pmText()).toContain('goalSet');
    expect(pmText()).toContain('restUntil');
    expect(officeGuide('coordinator')).toContain(pmText());
    expect(officeGuide('lead')).not.toContain(pmText());
    expect(officeGuide('coordinator')).toMatch(/sahibi kartı onaylamadan/i);
  });
});
