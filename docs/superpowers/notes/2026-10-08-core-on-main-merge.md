# Çekirdek zinciri yeni main üstünde — birleştirme ve çıkış notu (`integration/core-on-main`)

> **DURUM:** birleştirme ve canlıya alma yalnız sahibinde.
>
> **Bu dal, eski 1–5 adımlarının yerine geçer.** Sahibi yönetim döngüsünü main'e aldı ve canlıya çıkardı (main
> **46764f9**, canlı veritabanında göç 16 = "living plans"). Eski zincirin göçleri de 16'dan başlıyordu, bu yüzden
> çakışıyorlardı. Bu dal beş birimi yeni main'in üstüne sırayla alır ve göçlerini **17–22**'ye kaydırır (sahibinin
> talimatı; karar 18591573, not #99).
>
> **Eski notların satırları kullanılmaz:** `core-3`, `core-4`, `core-5` ve `core-5-gate` notları. Eski dallar da ayrıca
> birleştirilmez: `fix/migration-name-guard`, `integration/core-3`, `integration/core-4`, `integration/core-5`,
> `integration/core-5-gate`, `test/main-wiring-gate`.
> - Hepsi bu dalın içinde. Bu dal alındıktan sonra birleştirilirlerse "Already up to date" der, bir şey değişmez.
> - Ama bu daldan **önce** birleştirilirlerse eski numaralarla gelirler. Açılış denetimi ofisi açmaz: "v16 canlıda
>   'living plans', kodda 'role templates'". Bu, canlı kopyada denendi.

- Tarih: 2026-10-08 · Yazan: Can · Görev: 3bf20e5c · İnceleyen: Kerem
- Taban: `main` 46764f9 (yönetim döngüsü canlıda).

## Birimler (sırayla, her biri `--no-ff`)

| Sıra | Birim (uç) | Birleştirme | İçerik | Göç (eski → yeni) | İnceleme |
|---|---|---|---|---|---|
| 1 | `fix/migration-name-guard` (ff3931a) | 7c2d664 | açılış denetimi: atlanan alt göç ya da ad uyuşmazlığı ofisi durdurur | — | onaylı (d3de4118) |
| 2 | `integration/core-3` (9c6db28) | 00dc8a4 | core-3 (B6 rol şablonları, B7 yetenekler, B5 plan kurulumu, sahibi uçlarında Origin+nonce, terminal/arka plan) | 16–18 → **17–19** | core-3 notu |
| 3 | `integration/core-4` (8ecec35) | d30edfb | joker kural, K3 smoke, B26 KPI okumaları, B11 arama | 19–20 → **20–21** | onaylı (296c5597) |
| 4 | `integration/core-5` (ec929c7) | e882f2e | bilinen bağlayıcılar, B12 ilgili hafıza, C5-5 pilot ölçümü, B9b oturum kapatma, B8 ön-kontrol | — | onaylı (ee781926 / c8c652e1) |
| 5 | `integration/core-5-gate` (7e736a4) | 65cf5ad | B9a kapı ve onay kaydı (kapalı gelir), C5-5 test düzeltmesi, `main.ts` kablolama testleri | 21 → **22** | 9937b72a ve 3ab606f2 onaylı; kapının birleşik dalı fc72b35b (Kerem): onay durumu bu notta **doğrulanmadı** |

Birleştirmelerden sonra iki test commit'i:
- fb4f24d: canlıdaki göç adları testi 16'ya uzadı ("living plans", canlıdan salt okunur okundu).
- c1b6282: akışı olmayan bir görev v16 öncesi bir veritabanına da yazılabiliyor (`stream_id` yalnız doluyken yazılır).

### Göçler (1–15 değişmedi)

| No | Ad (değişmedi) | Nereden |
|---|---|---|
| 16 | living plans: a plan’s streams, a task’s stream | main (yönetim döngüsü, canlıda) |
| 17 | role templates: which one an employee was hired from | core-3 (eski 16) |
| 18 | capabilities: what an employee declares and a task requires | core-3 (eski 17) |
| 19 | blueprints: the install plan behind a plan card, and the steps its install made | core-3 (eski 18) |
| 20 | KPI readings | core-4, B26 (eski 19) |
| 21 | search: one index over notes, decisions, the playbook, finished work and the profile | core-4, B11 (eski 20) |
| 22 | approvals: the owner's approvals of calls the gate holds | core-5-gate, B9a (eski 21) |

### Çakışmalar ve çözümleri

Çözümler betikle yazıldı ve her blok, beklediği içeriği doğrulamadan çözülmüyor. Betikler Can'ın masasında,
`core-on-main/`: `resolve-common.py` (ortak; token düzeyinde üç yollu birleştirme, örtüşmede durur),
`resolve-core3.py`, `resolve-core4.py`, `resolve-core5.py`, `resolve-gate.py`. Kerem'in `resolve-mc-*.py` betikleri
yalnız harita olarak okundu, kullanılmadı.

**Adım 2 (core-3): 11 dosyada 23 blok.**
- **`engine.ts#switchTo`** (Kerem'in yönetim döngüsü incelemesi, madde 2): iki taraf da kalır.
  - Yönetim döngüsünün `|| requested.role`'ü: rol turu kendi modeline gider.
  - core-3'ün `|| this.#jobsRunning(rt)`'si: arka planda iş süren oturum yeniden açılmaz.
  - İkisi de testle korunuyor (aşağıda mutasyon).
- **`store.ts`** (madde 3): `stream_id`, B7'nin `requires` kalıbıyla yalnız doluyken yazılır. Akışı ve gereksinimi
  olmayan bir görev, v16 öncesindeki INSERT'in aynısıdır.
- **`migrations.ts`:** main'in 16'sı, ardından core-3'ün 17–19'u.
- **`db.test.ts`:** core-3'ün göç testleri 17–19 oldu. Main'in kendi v16 testi `upTo(16)` ile sınırlandı (eskiden
  "en son"a göç ediyordu).
- **Diğer:** `capabilities.test.ts`'in "eski veritabanı" denemeleri `≤ 17` (yeteneklerden önce) oldu. `api.ts`, `main.ts`,
  `company.ts`, `mcp/tools.ts` (taskCreate'te hem `streamId` hem `requires`), shared tipler ve olaylar: iki taraf.

**Adım 3 (core-4): 6 dosyada 14 blok, ayrıca sessiz bir çakışma.**
- **`migrations.ts`'te git çakışma göstermeden iki tane v19 üretti** ("blueprints" ve "KPI readings"). B26 20'ye, B11
  21'e kaydırıldı.
- **`main.ts`:** yönetim döngüsü Dispatcher'ı döngüden sonra tek yerde kuruyor; core-4'ün kendi Dispatcher satırı düştü,
  B26'nın `kpis`'i o tek Dispatcher'a geçti.
- **Diğer:**
  - `memory.ts`: yönetim döngüsünün `notesFrom`'u ve B11'in yeni `search`'ü birlikte.
  - Retro notu: B26'nın KPI tablosu ve yönetim döngüsünün `retroSource`'u birlikte.
  - Tablo listesi sabitleri: V19 / V20 / V21.

**Adım 4 (core-5): 7 dosyada 9 blok.**
- **`main.ts`:** B8'in `IntegrationRegistry`'si ve `CapabilityPrecheck`'i, tek Dispatcher'dan önce. Dispatcher şöyle
  kuruluyor: `{ …, kpis, related: …relatedMemory…, precheck, cycle }`.
- **Diğer:** bütçe ve web testlerinde anayasa nesneleri token düzeyinde birleşti: yönetim döngüsünün `coordinatorModels`'ı
  ve B8'in anahtarı.

**Adım 5 (core-5-gate): 11 dosyada 15 blok, ayrıca iki sessiz çakışma.**
- **`migrations.ts`'te ikinci bir v21 oluştu;** approvals 22'ye kaydırıldı.
- **"Son göç" testleri** (`toBe(21)`): iki taraf da aynı satırı 20→21 yaptığı için git çakışma göstermedi. 22'ye çekildi.
- **`reducers.ts`:** yönetim döngüsü bu satırı değer import'una çevirmişti; B9a'nın `Approval`'ı `type Approval` olarak
  kalır. Düz birleşim, tip silmeyle çalışma anında kırılırdı.
- **`main.ts`:** API'ye `gate`; `officeTools`'a `approvals, gate, cycle`; `company`'ye `approvals, management: cycle`.

Bağımlılık değişmedi; yalnız `pilot-metrics` betik satırları eklendi. `pnpm install` gerekmez.

## Birleştirme ve çıkış (sahibi; tek satır, bir kez)

```
cd ~/Projects/control-center && { git merge-base --is-ancestor 46764f9 HEAD || { echo 'Önce main 46764f9 (yönetim döngüsü) gerekli; bu dal onun üstüne kuruldu.'; false; }; } && L=~/.control-center/office.lock && { [ ! -e "$L" ] || { P=$(cat "$L"); kill -INT "$P" 2>/dev/null; while kill -0 "$P" 2>/dev/null; do sleep 1; done; }; } && (set -C; git rev-parse HEAD > ~/.control-center/main.pre-core-on-main) && node -e 'new (require("node:sqlite").DatabaseSync)(process.argv[1],{readOnly:true}).prepare("VACUUM INTO ?").run(process.argv[2])' ~/.control-center/office.db ~/.control-center/office.pre-core-on-main.db && git merge --no-ff --no-edit integration/core-on-main && pnpm office
```

Satır sırasıyla şunları yapar:
1. **Önkoşul.** main'de 46764f9 yoksa (main ne o, ne de torunu) "Önce main 46764f9 …" yazar ve durur; hiçbir şey
   değişmez.
2. **Ofisi durdurma.** Ofis açıksa durdurur ve kapanmasını bekler.
3. **main'i kaydetme.** main'in şimdiki commit'ini `~/.control-center/main.pre-core-on-main`'e yazar. Bu dosya varsa
   durur ("cannot overwrite existing file"), çünkü satır daha önce çalışmıştır.
4. **Yedek.** Veritabanının tutarlı yedeğini alır: `office.pre-core-on-main.db` (v16).
5. **Birleştirme.** `integration/core-on-main`'i `--no-ff` ile birleştirir. Main hâlâ 46764f9 ise temiz biner ve sonuç
   ağacı dalla birebir aynıdır.
6. **Açılış.** Ofisi başlatır. Açılışta 17–22 sırayla uygulanır ve arama dizini kaynak tablolardan dolar.

**Satırı yeniden yapıştırma:**
- `pnpm office` açılmazsa yalnız `pnpm office` çalıştırılır.
- Satır 3. adımda durursa birleştirme yapılmıştır (`git log -1` "Merge branch 'integration/core-on-main'" der); yine
  yalnız `pnpm office` çalıştırılır.
- 46764f9'dan sonra main'e çakışan başka commit girdiyse `git merge` durabilir. O zaman önce `git merge --abort`, sonra
  bu dalın o main'e yeniden kurulması istenir.
- `main.pre-core-on-main` ve `office.pre-core-on-main.db` silinmemeli; geri alma ikisini kullanır.

## Açılıştan sonra değişenler

Ayrıntılar her birimin kendi notunda; burada yalnız açılışta görünenler var.
- **Göçler 17–22:** yeni sütunlar ve tablolar. Eski satırlar aynen kalır; canlı kopyada görev, plan ve çalışan satırları
  aynı çıktı.
- **core-3:** sahibi uçlarında Origin+nonce var. Sayfanın dışından (ör. `curl`) gelen bir `POST /api/...` reddedilir ya
  da işaretlenir. Rol şablonları, yetenekler ve plan kurulumu da core-3 ile gelir.
- **B9b anahtarsız, hemen etkin:** her oturum rolünün kapalı araçlarıyla açılır.
  - İlk oturumlarda sözlüğün 30 dışa dönük aracı kapanır.
  - Oturumlar araç adlarını bildirdikten sonra sınıflandırılmamış ≈241 bağlayıcı aracı da kapanır.
  - Ayrıntı core-5 notunda.
- **B8 ön-kontrolü ve B9a kapısı kapalı gelir:** anayasada `capabilityPrecheckEnabled: false`, `gateEnabled: false`.
- **Görev mesajları:** her görev mesajında "## İlgili hafıza" bölümü (B12) bulunur.
- **KPI okumaları ve yönetim döngüsü:** B26'nın KPI okuması her tik'te çalışır. Yönetim döngüsü canlıdaki gibi sürer;
  döngü bağlıyken nabız çalışmaz.
- **Kapsam dışı:** Kerem'in yönetim döngüsü incelemesindeki küçük maddeler (K1–K5) ve maliyet ölçümü bu dalda ele
  alınmadı.

## Geri alma

- **Yalnız kod (veri kaybı yok):**
  1. Ofis durdurulur.
  2. `cd ~/Projects/control-center && git reset --hard $(cat ~/.control-center/main.pre-core-on-main) && pnpm office`.

  Ne olur:
  - main 46764f9'da açılış denetimi yok. v22 veritabanını uyarısız ve göç çalıştırmadan açar; yeni sütun ve tabloları
    görmez.
  - main kodu bu veritabanına not, akışlı plan ve görev yazabiliyor (denendi).
  - Yeniden ileri alınırsa yeni kod v22'yi uyarısız açar. Arama dizini aradaki yazıları görmediğini anlar ve kendini
    yeniden kurar.
  - Birleştirmeden sonra main'e başka commit girdiyse `reset` yerine
    `git revert -m 1 --no-edit <core-on-main birleştirme commit'i>` kullanılır.
- **Veriyle birlikte tam dönüş:**
  1. Ofis durdurulur.
  2. `cp ~/.control-center/office.pre-core-on-main.db ~/.control-center/office.db && rm -f ~/.control-center/office.db-wal ~/.control-center/office.db-shm`
  3. Ardından yalnız kod geri alma.

  Çıkıştan sonra yazılan her şey kaybolur.

## Prova ve doğrulama (görev 3bf20e5c, Can'ın masası `core-on-main/`)

- **Testler:** `pnpm typecheck` exit 0. `pnpm test` exit 0: sunucu 1168 geçti / 18 atlandı, web 222/222. Bu şunları
  içerir:
  - `db.test`'in "no gap, no repeat" testi ve göç ad testleri (1–16 canlıdaki adlarla);
  - `migration-guard.test`;
  - `main.test.ts`'in dört kablolama testi;
  - yönetim döngüsünün kendi testleri (cycle, board, streams, plan-streams, engine-model).
- **Kilitli gerçek testler** (`OFFICE_SMOKE=1`; LOCKED_ARGS, yalnız testin stub'ları, haiku): 6/6 geçti.
  - lockdown $0.0007, session-deny init'te öldürülüyor, gate $0.0028 + $0.0038.
  - Toplam $0.0073, CLI'nin bildirdiği; abonelik kotasından.
- **Mutasyon:**
  - `#switchTo`'da iki taraftan biri düşürülünce engine testleri kırmızı.
  - `main.ts`'ten related, precheck, sessionDeny, Engine'e kanca ya da API'ye `gate` düşürülünce `main.test.ts` kırmızı.
  - `stream_id` koşulsuz yazılınca yeni store testi kırmızı ("no column named stream_id").
- **Canlı DB'nin salt okunur kopyası** (`canli-kopya.sh`, 34 kontrol):
  - Denetim yanlış alarm vermiyor. Eski numaralı kod durduruluyor.
  - Yeni kodla 17…22 tek tek uygulanıyor, 22→16→22 gidiş-dönüş yapılıyor; satırlar aynı.
  - Ofis yeni kodla gerçekten açıldı (v16→v22, kopyanın klasörü, sahte claude); `/api/management` ve öteki uçlar cevap
    verdi.
  - Yalnız kod ve yedekten tam geri alma denendi.
  - Canlı ofise dokunulmadı.
- **Satır provası** (`satir-provasi.sh`, geçici klonlar):
  - main 46764f9'da iki kez koşuldu. İlki birleştirdi (ağaç dalla aynı), ikincisi 3. adımda durdu.
  - 46764f9'un bir torununda birleştirdi.
  - Yönetim döngüsü öncesi main'de (faf89ad) 1. adımda durdu.
  - `git reset --hard` ile geri dönüldü.
