# B11 — Birleşik hafıza araması: tasarım notu

- Tarih: 2026-10-08 · Yazan: Selin (Mimar) · Görev: fe1163a8 · İnceleyen: Kerem
- Dayandığı: `bosluk-analizi.md` §2 B11 satırı ve §3 "B11 — Arama zayıf"; `hedef-mimari.md` §4 C3 (birleşik dizin,
  BM25 + tür ağırlığı + yenilik) ve C4 (vektör: isteğe bağlı eklenti, ayrı keşif).
- Kod: `~/Projects/control-center` main `3069341` (şema v15). Yollar repo köküne göre tam yol. **Kod değiştirilmedi.**
- Önerilen göç: **v20** (karar defteri d63e5d27 ve şirket notu #55: v16 B6, v17 B7, v18 B5, v19 B26, **v20 B11**, v21 B9,
  v22 yönetim döngüsü). Dal, B26 (v19) dalının ya da B26 main'e girdikten sonra main'in üstüne; bkz. §7.
  Uygulamada dal görev fedad5cc gereği main'den açıldı (`feat/search`); canlıya alma sırası “Uygulama” bölümünde.

## Uygulama (Can, `feat/search`, 2026-10-08)

Kapsam notun §2'si; aşağıdakiler nottan bilinçli sapmalar ya da notun bıraktığı ayrıntılar:

- **Göç v20**, dal main'den. `feat/search` dalında `db.test.ts`'in “boşluksuz” testi yalnız ayrılmış numaraların (16–19)
  eksik olmasına izin veriyordu; `integration/core-4`'te (core-3 v16–v18 + B26 v19 + B11 v20) katı test geri geldi.
  **Canlıya alma sırası:** v16–v19 (B6, B7, B5, B26) canlıya girmeden bu dal canlıya
  girmemeli; `migrateUp` yalnız en büyük uygulanmış sürümden büyük göçleri çalıştırır, sıra bozulursa v16–v19 sessizce
  atlanır. `fix/migration-name-guard` (Elif, f5be0a4) canlıdaysa atlanmaz: v20 sırasız girerse ofis açılmaz ve
  atlanacak göçü adıyla söyler (`MigrationOrderError`; denendi: v15 + v20 uygulanmış veritabanında v16–v19'lu kod).
- **İnceleme ve devir teslimleri dizinde** (not §3.3 dışarıda bırakıyordu). Gerekçe: görevin bitti tanımı
  “`memorySearch` mevcut çağrıları aynı sonuç sınıfını versin”; bugünkü arama bunları buluyor (canlı kopyada 60 bitmiş
  görevin 37'si inceleme) ve gerçek bir sorgu (“6b475116 inceleme Kerem bulgu”) tam bunu arıyor. Etiketleri
  `teslim inceleme`; gövde özet + bulgular.
- **Tür ağırlığı bölen:** `score = bm25 / ağırlık`. Notun formülü (`bm25 × ağırlık`) negatif `bm25` ile niyetin tersini
  verir (teslimler öne geçer). Değerler notunki (el kitabı 0.8, karar 0.85, not ve profil 1, teslim 1.1); sıra:
  el kitabı, karar, not/profil, teslim.
- **Kısmi eşleşme sayımı** `indexOf` ile değil, her kelime için aynı FTS ön ek eşleşmesiyle (alt sorgu); “kısmi 2/4”
  tam olarak aramanın eşleştirdiği kelimeleri sayar. Tekrarlanan kelime bir kez sayılır.
- **`rebuildIfStale`** sürüm eskiyse ya da dizin kaynak tablolarla tür başına kayıt sayısı ve en yeni zamanda
  uyuşmuyorsa yeniden kurar (boş dizin bunun özel hâli). Böylece eski koda geri alınıp yeniden ileri alınınca aradaki
  yazılar kaybolmaz.
- **Snippet** sorgunun gövdede geçen ilk kelimesinin çevresinden (eskiden yalnız ilk kelime; tam eşleşmede ilk kelime
  gövdedeyse aynı sonuç).
- **Eşleşme biçimi:** karar, el kitabı ve teslimlerde eski kod alt dize (`includes`) arıyordu, dizin kelime ön ekiyle
  arar (notlarda zaten böyleydi). Kelimenin ortasındaki bir parça artık bulunmaz.
- **Performans testi** duvar saatiyle değil CPU süresiyle ölçer (paralel test koşusunda duvar saati 6 kata kadar
  uzuyor): gerçekçi derlem (12.000 kayıt) 5 kelime < 50 ms; her kayıtta sorgu kelimeleri olan en kötü durum < 200 ms.
- Araç/API: `memorySearch` + `kinds`, `since` (`7d` ya da `2026-10-01`); `GET /api/memory/search?q=&kinds=&limit=&since=`;
  `limit` 1–30 dışı `ValidationError`.
- Prova: `node apps/office-server/scripts/search-rebuild.ts [--from office.db] [--replay]` (kaynak salt okunur,
  `VACUUM INTO` kopyası).

## 1. Bugün (kanıt)

`memorySearch` dört türü arar ama dört ayrı yolla ve sonucu alakaya göre değil tarihe göre keser:

| Tür | Bugünkü yol | Kanıt |
|---|---|---|
| Notlar | FTS5 `notes_fts` (dış içerik tablosu; `ft_title, ft_text, ft_tags` JS'te katlanmış metin; tokenizer `unicode61 remove_diacritics 2`); sorgu her kelime için `"kelime"*`, boşlukla birleşik = **AND**; `ORDER BY rank LIMIT ?` | `apps/office-server/src/migrations.ts:159-171`; `apps/office-server/src/company/memory-store.ts:11-14` `ftsQuery`, `:166-175` `NoteStore.search`; katlama `apps/office-server/src/company/text.ts:18-24` (`fold`, `words` ≤ 8 kelime) |
| Kararlar | Son 500 karar belleğe alınır, `matches()` her kelimeyi `fold`'lu metinde arar (AND) | `apps/office-server/src/company/memory.ts:159-162`, `:25-28` |
| El kitabı | Her konunun son sürümü belleğe, `matches()` | `apps/office-server/src/company/memory.ts:163-165` |
| Bitmiş görevler | `tasks.list({statuses:['done'], limit: 100_000})`, `result.summary + learned`, `matches()` | `apps/office-server/src/company/memory.ts:166-170` |
| Birleştirme | Dört listenin toplamı **`ts` azalan** sırayla kesilir; alaka puanı yok; not listesi daha önce `limit`'e kesilmiş olur | `apps/office-server/src/company/memory.ts:171` |

Araç: `memorySearch(query, limit 1–30)` (`apps/office-server/src/mcp/tools.ts:339-348`). Sahibi için birleşik uç yok:
`GET /api/memory/notes?q=` yalnız notlar, `GET /api/memory/decisions?q=` yalnız kararlar (`apps/office-server/src/api.ts:200,205`).

**Canlı kullanım (K4, salt okunur kopya, 2026-10-08):** 46 not (38 bin karakter), 2 karar, 4 el kitabı konusu, 50
bitmiş görev sonucu (168 bin karakter), 0 profil satırı. `memorySearch` 19 kez çağrıldı, **13'ü boş döndü** (%68).
Son sorgular 3–5 kelimelik ve kod adı içeriyor: "economy.scenario R10 olay sırası kararsız", "kapı bypassPermissions
Bash", "terminal takeover lifecycle idle", "cost_usd chargeTurn". AND kuralı bunların hepsinin tek bir kayıtta geçmesini
istiyor; o yüzden boş. Bu, B11'in ölçülebilir ana sorunudur: **sıralama değil, eşleşme** önce bozuk; sıralama ikinci.

## 2. Kapsam

**İçinde:**
1. Tek dizin: `search_index` (içerik) + `search_fts` (FTS5 dış içerik) — not, karar, el kitabı (yalnız son sürüm),
   bitmiş görev sonucu, **şirket profili bölümü** (B2, yeni; ucuz ve sorgulanması işe yarar).
2. Eşleşme kuralı: önce AND (bugünkü), yeter sonuç yoksa **OR ile tamamla** ve eşleşen kelime sayısıyla sırala;
   kısmi eşleşme çıktıda işaretli.
3. Sıralama: FTS5 `bm25()` (sütun ağırlıkları başlık 3, etiket 2, gövde 1) × tür ağırlığı; eşitlikte yenilik.
4. Tek `Memory.search` arkası; `memorySearch` aracı geriye uyumlu (aynı imza + isteğe bağlı `kinds`, `since`);
   sahibi için `GET /api/memory/search?q=&kinds=&limit=`.
5. Yeniden kurma: dizin boşsa ya da sürümü eskiyse açılışta kaynaklardan doldurma (`SearchIndex.rebuild`).
6. Ölçüm: her aramada `memory.searched` olayı (`query`, `hits`, `mode: and|or`, `ms`) → boş dönüş oranı KPI'sı.

**Dışında:** vektör/gömme (gerekçe §5), belge yükleme ve parçalama (B10), göreve bağlam enjeksiyonu (B12), web
sekmesinde arama kutusu (API hazır; Notlar sekmesi isterse `GET /api/memory/search`'e geçer, ayrı küçük iş),
`notes_fts`'in kaldırılması (geriye uyumluluk için durur; sonraki göçte düşer).

## 3. Tasarım

### 3.1 Neden tek dizin ve neden uygulama katmanında doldurma

- **Tek tablo**: `bm25()` puanı aynı FTS tablosunda karşılaştırılabilir; dört ayrı FTS tablosunun puanları farklı
  derlem istatistikleriyle gelir, birleştirilemez.
- **Katlama SQL'de yok:** `fold()` Türkçe `ı→i` ve `İ→i` dönüşümünü JS'te yapıyor (`apps/office-server/src/company/text.ts:18-20`); FTS5
  `remove_diacritics` `ş ç ğ ö ü`'yü düşürür ama dotless `ı`'yı `i`'ye çevirmez. Notlar bu yüzden JS'te katlanıp
  `ft_*` sütunlarına yazılıyor. Başka tablolardan SQL tetikleyiciyle dizine yazmak katlamayı kaybeder; `db.function`
  ile SQL'e `fold` eklemek her bağlantının (betikler, testler) fonksiyonu kaydetmesini zorunlu kılar, kaydetmeyen
  bağlantı kaynak tabloya yazamaz (tetikleyici "no such function" ile düşer). **Karar:** dizin uygulama katmanında
  beslenir: bütün yazıcılar zaten depolardan geçer (`NoteStore.create`, `DecisionStore.create`, `PlaybookStore.write`,
  `TaskStore.update`, `ProfileStore`); her depo yazdıktan sonra `SearchIndex.upsert/remove` çağırır. Göç yalnız
  tabloları kurar; doldurma açılışta `rebuild()` ile (bkz. 3.4).

### 3.2 Şema (göç v20)

```sql
CREATE TABLE IF NOT EXISTS search_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,            -- note | decision | playbook | task | profile
  ref TEXT NOT NULL,             -- note.id | decision.id | playbook.topic | task.id | profile.section
  title TEXT NOT NULL,           -- özgün (gösterim)
  body TEXT NOT NULL,            -- özgün (snippet bundan)
  tags TEXT NOT NULL DEFAULT '', -- özgün, boşlukla
  ft_title TEXT NOT NULL,        -- fold()
  ft_body TEXT NOT NULL,
  ft_tags TEXT NOT NULL,
  ts INTEGER NOT NULL,           -- kaynağın zamanı (sıralama ve since)
  UNIQUE (kind, ref)
);
CREATE INDEX IF NOT EXISTS search_index_kind_ts ON search_index (kind, ts);
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
  ft_title, ft_body, ft_tags, content = 'search_index', content_rowid = 'id', tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS search_index_ai AFTER INSERT ON search_index BEGIN
  INSERT INTO search_fts (rowid, ft_title, ft_body, ft_tags) VALUES (new.id, new.ft_title, new.ft_body, new.ft_tags);
END;
CREATE TRIGGER IF NOT EXISTS search_index_ad AFTER DELETE ON search_index BEGIN
  INSERT INTO search_fts (search_fts, rowid, ft_title, ft_body, ft_tags) VALUES ('delete', old.id, old.ft_title, old.ft_body, old.ft_tags);
END;
CREATE TRIGGER IF NOT EXISTS search_index_au AFTER UPDATE ON search_index BEGIN
  INSERT INTO search_fts (search_fts, rowid, ft_title, ft_body, ft_tags) VALUES ('delete', old.id, old.ft_title, old.ft_body, old.ft_tags);
  INSERT INTO search_fts (rowid, ft_title, ft_body, ft_tags) VALUES (new.id, new.ft_title, new.ft_body, new.ft_tags);
END;
```

`down`: üç tetikleyici, `search_fts`, indeks, `search_index` düşer; kaynak tablolara dokunmaz. Tetikleyiciler yalnız
`search_index` ↔ `search_fts` arasında (notlarınkiyle aynı desen, `apps/office-server/src/migrations.ts:162-171`); `fold` SQL'de gerekmez.
Dizin sürümü `company_state` anahtarı `search.version` (bugün `1`); göç gerekmez (`apps/office-server/src/company/goal-store.ts` `CompanyStateStore`).

### 3.3 Hangi tür ne taşır

| kind | ref | title | body | tags | ts | Ne zaman yazılır |
|---|---|---|---|---|---|---|
| note | `notes.id` | başlık | metin | etiketler | `ts` | `NoteStore.create` (zaten `ft_*` üretiyor; aynı değerler) |
| decision | `decisions.id` | başlık | `chosen + reason + alternatifler` | `karar` + (`geri-alma` reverts doluysa) | `ts` | `DecisionStore.create` (kararlar değişmez) |
| playbook | `topic` | konu | son sürüm metni | `el-kitabı` | `ts` | `PlaybookStore.write`: aynı `ref`'i **günceller** (UNIQUE) → yalnız son sürüm dizinde |
| task | `tasks.id` | görev başlığı | `result.summary` + madde–kanıt satırları | `teslim`, plan başlığı | `finished_at` | `Company.#complete` sonrası (`TaskStore.update` ile `status='done'` ve `result` dolu); `cancelled` → `remove`. **`learned` dizine girmez:** `learnedFrom` onu zaten not yapıyor (`apps/office-server/src/company/memory.ts:175-178`), çift sonuç olur |
| profile | `section` | bölüm adı | bölüm JSON'unun okunur metni (anahtar: değer satırları) | `profil`, `varsayım` (assumed) | `ts` | `ProfileStore` yazımı; aynı bölüm güncellenir |

İnceleme görevleri (`kind='review'`) ve devir görevleri dizine girmez (teslimleri karar metni; `latestReview` zaten
yapana gidiyor). İstenirse ikinci sürümde.

### 3.4 Yeniden kurma

`SearchIndex.rebuild()` kaynak tablolardan sıfırdan yazar (tek transaction, `DELETE FROM search_index` sonra
`INSERT`). Çağrılma: `apps/office-server/src/main.ts` açılışında `migrateUp(db)`'den sonra, dizin boşsa **ya da** `company_state.search.version`
koddaki `SEARCH_VERSION`'dan küçükse. Böylece v20 göçünden sonraki ilk açılış canlı DB'yi doldurur (46 not + 2 karar +
4 konu + 50 teslim: tek seferde, milisaniyeler). Salt okunur betik: `apps/office-server/scripts/search-rebuild.ts --db <kopya>`
(`apps/office-server/scripts/performance-report.ts` deseni) prova için.

### 3.5 Sorgu

```
Memory.search(query, { limit = 10, kinds?: Kind[], since?: number }) → MemoryHit[]
```
1. `words(query)` (≤ 8 kelime, katlanmış). Boşsa `ValidationError` (bugünkü).
2. **AND turu:** `ftsQuery` bugünkü gibi (`"w1"* "w2"* …`), `WHERE search_fts MATCH ? [AND kind IN (…)] [AND ts >= ?]`,
   `ORDER BY score LIMIT ?`.
3. **OR turu** (AND sonucu `< limit` ise): `"w1"* OR "w2"* OR …`, AND'de gelenler dışlanır, `matched` = eşleşen farklı
   kelime sayısı (sorgu kelimelerinin katlanmış `ft_*` metninde `indexOf` ile sayımı; FTS5 yardımcı fonksiyonu
   gerekmez), `ORDER BY matched DESC, score` ile kalan yerler dolar. Her OR sonucu `partial: true` döner.
4. **Puan:** `score = bm25(search_fts, 3.0, 1.0, 2.0) * kindWeight[kind]`; `bm25` negatif, küçük daha iyi;
   `kindWeight`: playbook 0.8, decision 0.85, note 1.0, profile 1.0, task 1.1 (teslimler uzun ve çoktur, hafifçe
   geri). Eşitlikte `ts DESC`. Ağırlıklar sabit (`apps/office-server/src/company/search.ts` başında), test eder.
5. **Snippet:** özgün `body`'den `snippetOf(body, words)` (`apps/office-server/src/company/text.ts:27-32`; bugünkü), ilk eşleşen kelime etrafında
   180 karakter. `highlight()` kullanılmaz (katlanmış metinden gelir).
6. **Dönüş:** `MemoryHit` + `partial?: boolean` + `matched?: number`; `kind` birleşimine `'profile'` eklenir
   (`packages/shared/src/memory.ts:47-53`).

Araç metni (geriye uyumlu, bir ek): `• [not] Başlık (2026-10-08, 12): snippet` → kısmi eşleşmede `• [not, kısmi 2/4]`.
Hiç sonuç yoksa bugünkü cümle. `since`: `+7d` gibi göreli ya da tarih (mevcut `parseUntil` tersine değil; basit
`YYYY-MM-DD` ya da `Nd` kabul et).

### 3.6 Olay

`{ type: 'memory.searched'; query: string; hits: number; mode: 'and' | 'or' | 'none'; ms: number }`
(`packages/shared/src/events.ts`). Her aramada bir olay, çalışan kimliğiyle. Web akışı bilmediği türü yok sayar
(`apps/office-web/src/ui/EventItem.tsx` bilinmeyen türde genel satır; kontrol et). Bu olay KÖ'nin kaynağıdır (§6).

## 4. Dosya ve değişiklik listesi

| Dosya | Değişiklik |
|---|---|
| `apps/office-server/src/migrations.ts` | v20 (3.2) |
| `apps/office-server/src/company/search.ts` (yeni) | `SearchIndex` (upsert/remove/rebuild/search), `SEARCH_VERSION`, `kindWeight`, OR tamamlama, `toDoc(kind, row)` dönüştürücüler |
| `apps/office-server/src/company/memory-store.ts` | `NoteStore`, `DecisionStore`, `PlaybookStore` yazımlarında `SearchIndex` çağrısı (bağımlılık enjeksiyonu: kurucuya `index?: SearchIndex`); `NoteStore.search` dokunulmaz |
| `apps/office-server/src/company/store.ts` | `TaskStore.update`: `done` + `result` → upsert; `cancelled` → remove |
| `apps/office-server/src/company/profile-store.ts` | yazımda upsert |
| `apps/office-server/src/company/memory.ts` | `search()` yeni yola; `MemoryDeps.index` |
| `apps/office-server/src/mcp/tools.ts:339-348` | `memorySearch` imzasına isteğe bağlı `kinds`, `since`; kısmi işareti |
| `apps/office-server/src/api.ts` | `GET /api/memory/search` |
| `apps/office-server/src/main.ts` | `SearchIndex` kurulumu, depolara verilmesi, açılışta `rebuildIfStale()` |
| `packages/shared/src/memory.ts`, `packages/shared/src/events.ts` | `MemoryHit.kind` + `'profile'`, `partial`, `matched`; `memory.searched` |
| `apps/office-server/scripts/search-rebuild.ts` (yeni) | salt okunur kopyada prova |
| Testler | §6 |

Değişmeyen davranış: `playbookRead`, `decisionsRead`, Notlar sekmesi, `notes_fts`.

## 5. Vektör gerekli mi? Hayır, şimdilik; gerekçe

| Soru | Cevap | Kanıt |
|---|---|---|
| Boş sonuçların nedeni eş anlamlılık mı? | Hayır; AND zorunluluğu ve çoklu kelime. 13 boş sorgunun hepsi 3–5 kelimelik; OR ile en az bir kelime eşleşir | §1 canlı sorgular |
| Derlem büyüklüğü | ~210 bin karakter, ~100 kayıt; FTS5 milisaniyede tarar; gömme maliyeti anlamsız | §1 K4 |
| Sorgu türü | Anahtar kelime ve kod adı ("cost_usd", "LOCKED_ARGS", "R10"); gömme bunlarda FTS'ten kötü | §1 |
| Bağımlılık | `sqlite-vec` için `node:sqlite` eklenti yükleme bu makinede denenmedi; gömme API'si ağ (kurum ağı) ve para (sahibine) ister | `hedef-mimari.md` §8 |
| Ne zaman gerekir | B10 belge derlemi (marka rehberleri, uzun belgeler) gelince ve ölçüm (§6, `memory.searched`) B11 sonrası boş oranını hâlâ > %20 gösterirse; o zaman hibrit (FTS + vektör, sıra birleştirme) ayrı iş | `hedef-mimari.md` C4 |

## 6. Test planı

**K1 birim (vitest, sahte claude gerekmez):**
1. Göç v20 gidiş–dönüş, önceden dolu `notes`/`decisions`/`playbook`/`tasks` ile (`apps/office-server/test/db.test.ts` deseni); `down` kaynak
   tablolara dokunmaz.
2. `rebuild()` canlı kopyada: `search_index` satır sayısı = notlar + kararlar + konu sayısı (sürüm değil) + sonucu
   olan bitmiş iş görevleri + profil bölümleri; `search.version` yazılır; ikinci açılışta tekrar kurmaz.
3. Her yazıcı dizine yazar: not, karar, el kitabı (ikinci sürüm **tek** satır, eski metin bulunmaz), görev bitişi
   (`learned` dizinde **yok**, notta var), görev iptali (silinir), profil bölümü (güncellenir). **Mutasyon kontrolü:**
   depo çağrısı kaldırılınca test kırılmalı.
4. Katlama: "İSTANBUL" ↔ "istanbul", "ılık" ↔ "ilik", "Türkçe" ↔ "turkce" dört türde de bulunur.
5. Eşleşme: 4 kelimelik sorgu, 3'ü bir kayıtta → AND boş, OR `partial:true, matched:3` döner; AND sonuçları önce.
6. Sıralama: başlıkta geçen kayıt gövdede geçenden önce; aynı metin iki türde → ağırlık sırası; eşit puanda yeni önce.
   Yenilik **alakayı ezmez**: eski ama tam eşleşen kayıt, yeni ama tek kelime eşleşenden önce (bugünkü kodda tersi;
   bu test bugünkü koda karşı kırmızı olmalı).
7. `kinds` ve `since` süzgeçleri; `limit` 1–30; boş sorgu `ValidationError`; 8 kelime üstü kesilir.
8. `memorySearch` metni: kısmi işareti, `playbookRead konu:` ipucu korunur; `GET /api/memory/search` JSON ve 400'ler.
9. `memory.searched` olayı yazılır (`mode`, `hits`, `ms`); okuma başka olay yazmaz.
10. Performans: 10.000 sentetik not + 2.000 görev; 5 kelimelik sorgu `< 50 ms` (vitest içinde `performance.now()`;
    eşik tartışmalı ise `< 200 ms`).

**K2 golden:** `apps/office-server/test/economy.scenario.test.ts` ve `smoke` dışı her test yeşil; `pnpm test` ve `pnpm typecheck` exit 0.

**K4 kabul (canlı DB salt okunur kopyası, `VACUUM INTO`):** `apps/office-server/scripts/search-rebuild.ts` ile dizin kurulur; olay
kaydındaki 19 gerçek `memorySearch` sorgusu yeniden çalıştırılır; **boş dönüş oranı %68 → ≤ %30** ve en az 10 sorgu
için ilk 3 sonuçta ilgili kayıt (inceleyici elle doğrular; kayıt listesi teslimde). Bu, B11'in ölçülebilir kabulüdür.

**K3 (isteğe bağlı, `OFFICE_SMOKE=1`, `LOCKED_ARGS`):** `apps/office-server/test/core2.smoke.real.test.ts` deseninde koordinatör (haiku)
`memorySearch`'ü bir kez çağırır ve kısmi eşleşmeli bir sonuç alır; yalnız ofis sunucusu, bağlayıcı yok.

## 7. Göç numarası ve dal

`db.ts migrateUp` yalnız uygulanmış en büyük sürümden büyük göçleri çalıştırır (el kitabı: "yazılım: paralel dallar ve
göç"). v16 (B6) ve v17 (B7) `feat/capability-model`'de, v18 B5 için ayrılmış. B11 **v20** alır ve dal Çekirdek 3'ün
entegrasyon dalı üstüne açılır; B5 v18'i almazsa B11 v20'da kalır (boşluk zararsız: `schema_migrations` sürüm sırasını
değil uygulanan en büyüğü izler; `apps/office-server/test/db.test.ts` "boşluksuz" iddiası varsa güncellenir). Birleştirme notu Çekirdek 3
notuna eklenir (prova: geçici klon + `VACUUM INTO` kopyası + `search-rebuild`).

## 8. Efor

**M, 3–5 gün** (K0 tahmin): şema + `SearchIndex` 1 gün; depo bağlantıları ve `Memory.search` 1 gün; araç/API/olay
0,5 gün; testler ve K4 kabul 1–1,5 gün; inceleme turları ayrı.

## 9. Mert'e verilebilir bitti tanımı taslağı

1. Göç v20 `search_index` + `search_fts` + tetikleyiciler; gidiş–dönüş testi önceden dolu tablolarla yeşil (K1).
2. Not, karar, el kitabı son sürümü, bitmiş iş görevi sonucu ve profil bölümü tek dizinde; her yazıcı dizine yazar,
   iptal siler; mutasyon kontrolü testleri yeşil (K1).
3. `Memory.search`: AND turu, yetmezse OR tamamlama (`partial`, `matched`), `bm25 × tür ağırlığı`, eşitlikte yenilik;
   "eski tam eşleşme yeni tek kelimeden önce" testi bugünkü koda karşı kırmızı, yeni kodda yeşil (K1).
4. Türkçe katlama dört türde (ı/İ, ş/ç/ğ/ö/ü) testle (K1).
5. `memorySearch` geriye uyumlu + `kinds`, `since`; kısmi işareti; `GET /api/memory/search` (K1).
6. `memory.searched` olayı; okuma başka olay yazmaz (K1).
7. Açılışta `rebuildIfStale`; `apps/office-server/scripts/search-rebuild.ts` canlı kopyada çalışır (K4).
8. Kabul: canlı kopyada 19 gerçek sorgunun boş dönüş oranı ≤ %30 (bugün %68); 10 sorguda ilk 3'te ilgili kayıt,
   liste teslimde (K4).
9. `pnpm test`, `pnpm typecheck` exit 0; `economy.scenario` değişmedi (K2).
10. Birleştirme notu: göç numarası, prova çıktısı, geri alma (yalnız kod: `search_*` tabloları eski kodda yok sayılır).

## 10. Belirsizlikler ve güven

| Konu | Güven | Not |
|---|---|---|
| Bugünkü kodun davranışı ve canlı sayılar | Yüksek | Dosya:satır; K4 sayım 2026-10-08 |
| AND→OR'un boş oranını düşürmesi | Yüksek | 13 boş sorgunun hepsi çok kelimeli; OR en az bir kelimeyi bulur. Alaka kalitesi ölçümle (K4 kabul) |
| `bm25` sütun ağırlıkları ve tür ağırlıkları | Düşük | Başlangıç değerleri; K4 kabulde ayarlanır, sabit testlerle korunur |
| `unicode61 remove_diacritics 2` + JS fold yeterliliği | Yüksek | Bugün notlarda çalışıyor; aynı yol |
| Dizin boyutu ve performans | Yüksek | ~100 kayıt; 10k testi sınır koyar |
| Vektör gerekmediği | Orta | Bugünkü derlem ve sorgular için yüksek; B10 belge derlemi gelince yeniden değerlendirilir |
| Göç numarası v20 | Orta | B5'in v18'i almasına ve Çekirdek 3 birleşme sırasına bağlı; kural §7 |
| Efor | Düşük | K0 |
