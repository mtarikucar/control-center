# control-center — Entegrasyon kaydı (B3) tasarım notu

- Tarih: 2026-10-08 · Yazan: Mert · Görev: 0c54acb0 (plan "Çekirdek 2", B3) · İnceleyen: Kerem
- Dayandığı: `bosluk-analizi.md` §2 B3 satırı ve §3 "B3 — Entegrasyon kaydı yok"; `hedef-mimari.md` §4 D1
  (`integrations(id, name, kind, status, capabilities[], authNeeded, costNote, lastSeen, registeredBy)`, oturum
  açılışındaki MCP listesinden otomatik besleme, `integrationRegister`, `integrationsList`, "Bağlantılar"), §6.
- Dal `feat/integration-registry`, `feat/onboarding` (6e45547) üstünde. **Göç v15** (v14 onboarding).
- Sürüm 2 (inceleme turu 1, Kerem): "açık" masanın deny kurallarını hesaba katıyor. Oturumun araç listesinden
  sunucu başına araç sayısı okunuyor, `denied` durumu eklendi, masanın neden kapalı olduğu ayrı alanda
  (`closedBy`), kayıttaki kapatma `registryClosed` adını aldı (§3, §5, §7, §9).

## 1. Bugün

Çalışan oturumu sahibinin ayarlarındaki bütün bağlantıları devralır, ofis araçlarını üstüne ekler
(`apps/office-server/src/claude/args.ts`). Bağlantıların durumu yalnız oturum açılışında olaya yazılır
(`normalize.ts`: `session.started.mcp = [{name, status}]`). Canlı kayıtta 48 oturum açılışı var; her masa 52 sunucu
bildiriyor. Ham durumlar `connected` 528, `needs-auth` 1440, `failed` 528. Tablo, araç ve ekran yok.

## 2. Kapsam

Kayıt ve **salt okunur** okuma. Kayıt hiçbir bağlayıcı aracını çağırmaz: durumu yalnız ofisin kendi olay kaydından
ve elle kayıttan okur. Yayın ya da gönderim yapan bir araç çağrılmaz (test: okuma olay yazmaz).

Kapsam dışı: bir bağlayıcıyı oturumlarda gerçekten kapatmak (`--disallowedTools`, D4/B9), yetenek sözlüğü ve eşleme
(D2/B7), ön-kontrol (D3/B8), web "Bağlantılar" sekmesi (API hazır).

## 3. Kaynaklar: gözlenen ve elle

- **Gözlenen (olay kaydından, her okumada):** her **güncel masanın** (işten çıkarılmamış çalışan) son
  `session.started` olayındaki liste, o masanın o andaki bağlantı durumudur. Olay, CLI'nin `system/init`
  mesajından gelir (`normalize.ts`). Bu sürümden itibaren her sunucu için oturumun araç listesindeki (`init.tools`)
  araç sayısını da taşır (`mcp[].tools`; sunucu adı `mcpToolPrefix` ile öneke çevrilir: `claude.ai Gmail` →
  `mcp__claude_ai_Gmail__`). Masanın `.claude/settings.json` deny kuralları dosyadan okunmaz; etkileri bu listeden
  gözlenir. Sunucu düzeyinde deny, sunucuyu `connected` bırakıp araçlarını listeden kaldırır (Selin'in K3'ü ve bu
  işin K3'ü). Ayrıca kopyalanmaz: tek doğruluk kaynağı
  olay kaydıdır, kayıt bayatlamaz, göç öncesi geçmiş de hemen okunur. `firstSeen`/`lastSeen` adın geçtiği ilk ve son
  `session.started` zamanıdır. Bir masanın son oturumunda olmayan bağlantı o masada yoktur.
- **Elle (tablo, göç v15):** koordinatörün `integrationRegister` ile yazdıkları: tür (oturumlarda görünmeyen
  adaptör ya da CLI için), kapalı işareti, yetenekler, yetki notu, maliyet notu, not.

## 4. Şema (göç v15)

```sql
CREATE TABLE integrations (
  name TEXT PRIMARY KEY,          -- CLI'nin bildirdiği ad ('claude.ai Gmail', 'plugin:design:figma', 'office') ya da elle verilen
  kind TEXT NOT NULL,             -- office | claude_ai | plugin | local_mcp | adapter | cli
  closed INTEGER NOT NULL DEFAULT 0,
  capabilities TEXT NOT NULL DEFAULT '[]',
  auth_needed TEXT,               -- sahibinin ne yapması gerektiği
  cost_note TEXT,
  note TEXT,
  registered_by TEXT NOT NULL,
  registered_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

Hedef mimari §6'daki `status` ve `last_seen` sütun olarak tutulmaz; olay kaydından türetilir (§3). `id` yerine ad
anahtardır: CLI adı zaten tekil.

**Tür (gözlenende addan):** `office` (ofisin kendi sunucusu), `claude.ai …` → `claude_ai`, `plugin:…` → `plugin`,
diğerleri → `local_mcp`. `adapter` ve `cli` yalnız elle.

## 5. Durumlar

**Masa durumu** (ham değerden ve araç sayısından): `connected` ve oturumda **0 aracı** → `denied` (masada kapalı:
masa ayarı aracı kaldırıyor). `connected` → `connected` (bağlı), `needs-auth` → `needs_auth` (yetki bekliyor),
`pending` → `pending` (bağlanıyor), `failed` → `failed` (hata), **tanınmayan her değer** → `unknown` (ham değer
saklanır). Araç sayısı olmayan eski oturumlarda (`tools: null`) yalnız sunucu durumu bilinir.

**Masada açık** (`open`) = durum `connected` (bağlı **ve** oturumda aracı var ya da sayı bilinmiyor) **ve** kayıtta
kapalı değil. Değilse `closedBy` nedenini söyler: `server` (sunucu bağlı değil), `desk` (bağlı ama oturumda aracı
yok: masa ayarı), `registry` (koordinatör kayıtta kapattı; **oturumda araçlar duruyor**, `tools` sayısı görünür).
JSON tüketicisi (web sekmesi, B8) bu ayrımı alanlardan okur; yalnız metne bakmak gerekmez.

**Bağlantı durumu:**
1. Elle kapatıldıysa `closed` (kapalı), masalarda bağlı görünse bile. Kayıt bunu yalnız işaretler; oturumlarda
   kapatma D4/B9'un işi. Okuma bunu açıkça yazar.
2. Hiçbir güncel masa bildirmiyorsa `unknown` (bilinmiyor). Örnekler: yalnız elle kaydedildi; yalnız işten
   çıkarılan birinin oturumunda göründü; masaların son oturumlarından düştü.
3. Değilse masalardaki en iyi durum: `connected` > `denied` > `needs_auth` > `pending` > `failed` > `unknown`.
   Bir masada açık, ötekinde deny edilmiş bağlantı `connected` görünür; masa satırları farkı söyler. Her masada deny
   edilmişse bağlantı `denied` olur.

## 6. Araçlar ve API

```
integrationsList(status?, employee?)       herkes       salt okunur; durum ve masaya göre süzülür
integrationRegister(name, kind?, capabilities?, authNeeded?, costNote?, note?, closed?)   koordinatör
GET /api/integrations                       sahibi       Integration[] (JSON)
```

`integrationRegister`, verilen alanları yazar, verilmeyenleri korur. Oturumlarda hiç görünmemiş bir ad için `kind`
gerekir. Bilinmeyen tür, en fazla 20 yetenek (her biri ≤ 60), metin sınırları denetlenir. `integration.changed`
olayı yazılır.

## 7. Sınırlar

- Okuma bütün `session.started` olaylarını tarar (bugün 48; oturum açılışı başına bir olay). Kayıt büyürse ilk/son
  görülme için özet tablo eklenebilir; bugün gerek yok.
- Masa durumu son oturum açılışı anındadır. Oturum sürerken düşen bağlantı ancak sonraki açılışta görünür.
- `init` ilk mesajla gelir ve bağlantıları o anki halleriyle söyler. Hemen yazılan ilk mesajda bütün sunucular
  `pending` ve hiçbir MCP aracı listede yok; 8 sn sonra yazılanda yerel sunucular `connected` (deny edilenlerde 0
  araç), claude.ai bağlayıcılarının bir kısmı hâlâ `pending` (`outputs/integrations/k3-init-stream.txt`). Böyle bir
  masa kayıtta `pending` (açık değil) görünür, araçları oturuma sonradan girse de. Temkinli taraftır.
- Deny dosyası oturum açıldıktan sonra konursa o oturumun listesi değişmez; kayıt yeni durumu masanın sonraki oturum
  açılışında görür (Pilot 0 kurulumu kapalı kipi oturumlar başlamadan kurar).
- Kayıttaki kapatma (`registryClosed`) oturumlarda araçları kaldırmaz; bu B9'un işi. Metin ve `closedBy: registry`
  bunu açıkça söyler.

## 8. Doğrulama

- Birim (K1): addan tür; masa başına son oturum; masalardan en iyi durum; tanınmayan ham durum ve hiç görülmeyen
  kayıt → bilinmiyor; işten çıkarılanın ve eski oturumların sayılmaması; kapalı → kapalı ve masa "kapalı"; yeniden
  açma; kayıt doğrulaması ve yetki; araç metni; API; okumanın olay yazmaması; göç v15.
- Mutasyon kontrolü: her durum kuralı, tür çıkarımı, son oturum seçimi, kapalı önceliği, işten çıkarılan masa,
  süzgeçler, yetki.
- K4 (kopya): canlı DB'nin salt okunur kopyasında okuma 48 oturumdan 52 bağlantıyı ve 5 masayı çıkarır.
- K3 (`integrations.real.test.ts`, `OFFICE_SMOKE=1`): masa klasörüne `permissions.deny: ["mcp__cad",
  "mcp__claude_ai_Gmail"]` konur, gerçek CLI ofisin argümanlarıyla açılır, `init` normalleştirilip kayda verilir.
  Beklenen: `cad` ve Gmail `denied` (0 araç, `closedBy: desk`), `blender` `connected` (araçlı, açık).

## 9. Değişiklik günlüğü

- Sürüm 2 (inceleme turu 1, Kerem, [önemli]): "açık" yalnız sunucu durumundan türüyordu. Pilot 0'ın deny dosyalı
  masalarında Gmail/Jeeta/Higgsfield "açık" görünür, B8 kayda dayanırsa işi aracı olmayan masaya verirdi. Düzeltme:
  `session.started` sunucu başına araç sayısını taşır; `denied` durumu; `open` = bağlı ve aracı var ve kayıtta kapalı
  değil; `closedBy` (server/desk/registry); `closed` → `registryClosed`. Gerçek CLI ile deny dosyalı masa K3'ü.
