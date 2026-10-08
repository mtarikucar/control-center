import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { WORK_TYPES } from '@cc/shared';
import { Agenda } from '../src/company/agenda.ts';
import { CRAFT_VERSION, METHOD_HEADINGS, coordinationText, methodText, pmText, workingText } from '../src/company/craft.ts';
import { officeGuide } from '../src/company/roles.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const flat = (text: string) => text.replace(/\s+/g, ' ');

/** The office's tools as a coordinator's session gets them (the management cycle wired: cycleClose too). */
function tools() {
  const s = setup();
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f);
  const agenda = new Agenda({ roster: s.roster, tasks: c.tasks, schedules: c.schedules, company: c.company, budget: c.budget });
  return officeTools({
    company: c.company, roster: s.roster, tasks: c.tasks, characters: () => ['coder'], memory: c.memory, budget: c.budget, engine: f.engine, plans: () => c.plans.list(), agenda,
    cycle: { acting: (_id, fn) => fn(), close: () => ({ changes: [] }) },
  });
}

/** Every property name and enum value in a tool's input schema, all the way down. */
function fieldsOf(schema: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(schema)) for (const x of schema) fieldsOf(x, into);
  else if (schema && typeof schema === 'object') {
    for (const [key, value] of Object.entries(schema)) {
      if (key === 'properties' && value && typeof value === 'object') for (const name of Object.keys(value)) into.add(name);
      if (key === 'enum' && Array.isArray(value)) for (const v of value) into.add(String(v));
      fieldsOf(value, into);
    }
  }
  return into;
}

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

  it('W1–W3: the coordinator hires for a missing skill or a bottleneck, keeps idle people on independent work, and re-plans when the limits change', () => {
    const core = flat(coordinationText());
    expect(core).toContain(
      '6. **Ölçek ve maliyet.** İşin gerektirdiği ekip ve model (gerekirse işe al); işe uygun zorluk; pahalı aşamaları bilerek planla, kota payını tahmine yaz. **İşe almanın iki ölçütü var:** eksik bir uzmanlık (o işi bilen kimse yoksa) ve darboğaz (bir kişinin sırası uzarken iş bölünebiliyorsa aynı rolden ikinci birini al). İş bölünemiyorsa nedenini plan kartına yaz.',
    );
    const workforce =
      '12. **İş gücünü yönet.** Biri çalışırken boştakilere bağımsız iş bul: sonraki adımların tasarımı, açık soruların araştırması, test, ölçüm, belge. Bir kişi ancak gerçekten değerli iş kalmadığı için boşta kalsın; `agendaRead` kimin ne zaman boş olduğunu gösterir.';
    expect(core).toContain(workforce);
    expect(core.indexOf('10. **Zamanı ofise bırak.**')).toBeLessThan(core.indexOf('11. **Planı akışlarla kur.**'));
    expect(core.indexOf('11. **Planı akışlarla kur.**')).toBeLessThan(core.indexOf(workforce));
    expect(core.indexOf(workforce)).toBeLessThan(core.indexOf('Ekip lideri bunları kendi ekibinin ölçeğinde uygular.'));
    const pm = flat(pmText());
    const replan =
      '- **Kısıtlar değişince yeniden planla.** Sahibi kota sınırını ya da anayasayı değiştirirse, yeni bilgi ya da bir teslim gelirse süren planları gözden geçir: hızlandır (paralel akış, yeni kişi) ya da yavaşlat; kararını kısa raporla.';
    expect(pm).toContain(replan);
    expect(pm.indexOf('**Kendini kısıtlama.**')).toBeLessThan(pm.indexOf(replan));
    expect(pm.indexOf(replan)).toBeLessThan(pm.indexOf('**Sahibinin sözü önce gelir.**'));
    // Each management cycle asks who is idle and why (the board marks the long idle).
    expect(pm).toContain('Boşta kim var ve neden');
  });

  it('W4: the software method says how to run development in parallel; everyone’s guide says not to wait silently with no work', () => {
    const software = flat(methodText('software'));
    const parallel =
      '**Paralel geliştirme.** İş parçalara bölünebiliyorsa: - Önce ortak arayüzü ya da sözleşmeyi (fonksiyon imzaları, veri biçimi, API) sabitle; parçalar ona göre yazılır. - Ortak numaralı kaynakları baştan paylaştır: veritabanı göç numaraları, portlar, hangi dosyanın ya da modülün kimde olduğu; böylece paralel dallar çakışmaz. - Her geliştirici kendi dalında (gerekirse ayrı bir git worktree\'de) çalışır. - İncelenmiş dallar tek bir entegrasyon dalında toplanır; bütün test takımı orada bir kez çalıştırılır. - Bir geliştiricinin sırası darboğaz olduysa ve iş bu çizgilerde bölünüyorsa doğru adım ikinci bir geliştirici almaktır.';
    expect(software).toContain(parallel);
    // Within the stages, before the roles: the method's headings keep their order (the first test above).
    expect(software.indexOf(parallel)).toBeGreaterThan(software.indexOf('## Aşamalar'));
    expect(software.indexOf(parallel)).toBeLessThan(software.indexOf('## Roller'));
    expect(software).toContain('- Bölünebilen işi tek geliştiriciye zincir gibi yüklemek; ya da ortak numaraları paylaştırmadan paralel dal açıp birleştirirken çakışmak.');
    const working = flat(workingText());
    expect(working).toContain(
      '- **Boşta sessizce bekleme.** Teslimden sonra sıranda iş kalmadıysa (`myTasks`) hangi işi alabileceğini `propose` ile (`kind: idea`) liderine ya da koordinatöre öner: ne, neden ve ne zaman biter; kararı onlar verir.',
    );
  });

  it('the coordinator’s guide says it is the project manager and how autonomy works; leads and members do not get it', () => {
    expect(pmText()).toContain('goalSet');
    expect(pmText()).toContain('restUntil');
    expect(officeGuide('coordinator')).toContain(pmText());
    expect(officeGuide('lead')).not.toContain(pmText());
    expect(officeGuide('coordinator')).toMatch(/sahibi kartı onaylamadan/i);
  });

  it('management cycle §3.7: what the cycle is for, what each one asks, a project start against a cycle; plans in streams; the pulse’s wake-up is gone', () => {
    const pm = flat(pmText());
    const cycle =
      '- **Yönetim turu.** İşin şekli değişince (bir teslim, bir inceleme kararı, biri boşa çıktı, bir plan ya da hedef durumu, bir kısıt, bir takılma) ve düzenli aralıkla (iş açıkken sık, hedef ve iş yokken seyrek) ofis sana yönetim panosunu gönderir: bütün tablo tek metinde. Panoyu oku, planları gerçekle karşılaştır, gerekeni değiştir (iş aç ya da yeniden dağıt, akışı böl ya da `planRevise` ile düzelt, işe al, park et, sahibine sor) ve turu `cycleClose` ile kapat: ne değiştirdin, neden; değişiklik yoksa "değişiklik yok, çünkü …". Ayrıntı gerekirse `agendaRead` ve `goalsRead` ile bak.';
    const questions =
      '- **Her turda sor.** Boşta kim var ve neden ("uzun süredir" işaretli olana bağımsız iş ver ya da ekibin fazla olduğunu gerekçesiyle yaz)? Bir zincir tek kişide mi birikiyor? Kritik yol kısalabilir mi (paralel akış, işi bölmek, yeni kişi)? Bir kısıt değişti mi (anayasa, kota, sahibinin payı)? Sahibinden beklenen bir karar var mı (gerekirse `reportToOwner` ile hatırlat)?';
    const kickoff =
      '- **Başlangıç turu, yönetim turu.** Hedef yokken ya da bir hedefin süren planı yokken gelen pano başlangıç turudur; hiç plan sürmezken sahibinin mesajı da öyle. Bu turda işin dünyasını öğrenmeye, akışları ve ekibi kurmaya zaman ayır (yukarıdaki adımlar), sonra planı akışlarıyla öner. Yönetim turunda kısa ve kararlı ol: tabloyu oku, karar ver, turu kapat.';
    const streams =
      '- **Plan akışlarla yaşar.** Planın paralel akışlarını `planPropose`\'ta `streams` ile yaz: her akışın sahibi ve beklediği akışlar. Gerçek değişince planı da değiştir: akış eklemek, sahibini değiştirmek, bağımlılığı düzeltmek ya da akışı bölmek `planRevise` ile olur. Bir akışı kendin yapsan da onu bir görevle kapat ya da iş bitince `planRevise` ile plandan çıkar: görevi olmayan akış bitmiş sayılmaz.';
    expect(pm).toContain(streams);
    expect(pm.indexOf('**Döngü.**')).toBeLessThan(pm.indexOf(streams));
    expect(pm.indexOf(streams)).toBeLessThan(pm.indexOf('**Serbestlik.**'));
    const own =
      '- **Turu bekleme.** Misyonda yapılacak iş oldukça sıradakini kendin başlat. Misyonda gerçekten yapılacak iş kalmadıysa dinlen ve `restUntil` ile ne zamana kadar ve neden dinlendiğini yaz: dinlenirken hedef ve iş yokken gelen tur durur, dinlenme bitince bir tur gelir. Bir ölçüm penceresi ya da bekleme süresi varsa görevi park et (taskPark); kendi sıranı kilitleme.';
    for (const text of [cycle, questions, kickoff, own]) expect(pm).toContain(text);
    // In this order, after the steps a direction starts with (the project start points to them), before a stopped plan.
    const at = [cycle, questions, kickoff, own].map((x) => pm.indexOf(x));
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(pm.indexOf('**Öğrendiğini şirkete yaz.**')).toBeLessThan(at[0]!);
    expect(at[3]!).toBeLessThan(pm.indexOf('**Durdurulan iş.**'));
    // The pulse's notices are no longer what wakes the coordinator.
    for (const old of ['Nabız', 'sana not bırakır', 'Notu bekleme', 'aktif hedefler sürerken biri uzun süredir işsizken', 'hiç hedef ve iş yokken']) expect(pm).not.toContain(old);

    const core = flat(coordinationText());
    expect(core).toContain(
      '11. **Planı akışlarla kur.** Planı zincir gibi değil paralel akışlar gibi kur: her akışın bir sahibi (bir çalışan ya da "alınacak: <rol>") ve beklediği akışlar olsun. Önce ortak kararı ya da arayüzü netleştir, ortak kaynakları (dosyalar, numaralar, tablolar) baştan paylaştır, sonra akışları aynı anda yürüt. Planlı her görevi `taskCreate`\'te `streamId` ile akışına bağla.',
    );

    // The digest is for the owner's daily report only (§3.6): hand-ins come with the board.
    const guide = flat(officeGuide('coordinator'));
    expect(guide).toContain(
      '- Teslimler, inceleme kararları ve bilgi notları sana tek tek gelmez, yönetim panosuyla gelir. Ofisin özeti yalnız sahibine giden günlük rapor içindir: rapor zamanı gelince `reportToOwner` ile kısa ve sayılarla raporla; o turda yeni iş açma.',
    );
    expect(guide).not.toContain('Anayasada özet açıksa');
    // Leads plan in streams too, at their own scale (their tasks to a stream); the plan's tools and the cycle are the coordinator's.
    expect(officeGuide('lead')).toContain(coordinationText());
    for (const tool of ['cycleClose', 'planPropose', 'planRevise']) expect(officeGuide('lead')).not.toContain(tool);
  });

  it('every tool a guide names in backticks is one the office has (or one of their fields): the coordinator’s tools in its own guide', () => {
    const all = tools();
    const coordinator = all.filter((t) => t.kinds.includes('coordinator'));
    const known = new Set([...coordinator.map((t) => t.name), ...all.flatMap((t) => [...fieldsOf(t.inputSchema)])]);
    // Claude's own scheduler, named only to say it is closed here.
    const closed = new Set(['CronCreate']);
    const named = [...officeGuide('coordinator').matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)].map((m) => m[1]!);
    expect(named.length).toBeGreaterThan(30);
    expect([...new Set(named)].filter((n) => !known.has(n) && !closed.has(n))).toEqual([]);
    for (const tool of ['cycleClose', 'planPropose', 'planRevise', 'taskCreate', 'agendaRead', 'reportToOwner', 'restUntil']) expect(named).toContain(tool);
    expect(named).toContain('streams');
    expect(named).toContain('streamId');
  });
});
