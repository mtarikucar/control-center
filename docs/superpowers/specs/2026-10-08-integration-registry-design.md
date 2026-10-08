# control-center — Entegrasyon kaydı (B3) tasarım notu

- Tarih: 2026-10-08 · Yazan: Mert · Görev: 0c54acb0 (plan "Çekirdek 2", B3) · İnceleyen: Kerem
- Dayandığı: `bosluk-analizi.md` §2 B3 satırı ve §3 "B3 — Entegrasyon kaydı yok"; `hedef-mimari.md` §4 D1
  (`integrations(id, name, kind, status, capabilities[], authNeeded, costNote, lastSeen, registeredBy)`, oturum
  açılışındaki MCP listesinden otomatik besleme, `integrationRegister`, `integrationsList`, "Bağlantılar"), §6.
- Dal `feat/integration-registry`, `feat/onboarding` (6e45547) üstünde. **Göç v15** (v14 onboarding).

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
  `session.started` olayındaki liste, o masanın o andaki bağlantı durumudur. Ayrıca kopyalanmaz: tek doğruluk kaynağı
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

**Masa durumu** (ham değerden): `connected` → `connected` (bağlı), `needs-auth` → `needs_auth` (yetki bekliyor),
`pending` → `pending` (bağlanıyor), `failed` → `failed` (hata), **tanınmayan her değer** → `unknown` (ham değer
saklanır). Masa ancak `connected` ise ve bağlantı kapalı değilse **açık** sayılır; değilse **kapalı**, nedeniyle.

**Bağlantı durumu:**
1. Elle kapatıldıysa `closed` (kapalı), masalarda bağlı görünse bile. Kayıt bunu yalnız işaretler; oturumlarda
   kapatma D4/B9'un işi. Okuma bunu açıkça yazar.
2. Hiçbir güncel masa bildirmiyorsa `unknown` (bilinmiyor). Örnekler: yalnız elle kaydedildi; yalnız işten
   çıkarılan birinin oturumunda göründü; masaların son oturumlarından düştü.
3. Değilse masalardaki en iyi durum: `connected` > `needs_auth` > `pending` > `failed` > `unknown`.

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

## 8. Doğrulama

- Birim (K1): addan tür; masa başına son oturum; masalardan en iyi durum; tanınmayan ham durum ve hiç görülmeyen
  kayıt → bilinmiyor; işten çıkarılanın ve eski oturumların sayılmaması; kapalı → kapalı ve masa "kapalı"; yeniden
  açma; kayıt doğrulaması ve yetki; araç metni; API; okumanın olay yazmaması; göç v15.
- Mutasyon kontrolü: her durum kuralı, tür çıkarımı, son oturum seçimi, kapalı önceliği, işten çıkarılan masa,
  süzgeçler, yetki.
- K4 (kopya): canlı DB'nin salt okunur kopyasında okuma 48 oturumdan 52 bağlantıyı ve 5 masayı çıkarır.
