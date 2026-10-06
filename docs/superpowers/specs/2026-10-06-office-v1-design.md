# control-center — Ofis v1 ("Claude ofisi") tasarımı

- Tarih: 2026-10-06
- Durum: sahibi tarafından konuşmada onaylandı; yazılı belge incelemede
- Kapsam: yalnızca v1. Sonraki aşamalar §12'de kayıt altında, bu belgede uygulanmaz.

## 1. Amaç

Claude Code oturumlarını rol tanımı verilmiş "çalışanlar" olarak, canlı bir 3D ofiste çalıştırmak ve
onlarla her an konuşabilmek. Belirli bir işe ya da mevcut projelere bağlı değil; genel bir platform.

v1'in başarı ölçütü — sahibi şunları yapabildiğinde v1 biter:

1. Ofisi tarayıcıda açar; voksel 3D ofiste masalar, karakterler ve köşede abonelik kotası görünür.
2. "İşe al" formuyla bir çalışan ekler (ad, rol tanımı, model, karakter); karakter boş bir masaya oturur.
3. Karaktere tıklar, mesaj yazar; çalışanın oturumu canlı akar (metin, komutlar, dosyalar),
   karakter masasında yazar.
4. Çalışan bir işin ortasındayken yeni mesaj gönderir; çalışan bir sonraki adımda görür ve işine devam eder.
5. Yan soru (`/btw`) sorar; cevap gelir, çalışanın asıl işi bölünmez.
6. Durdurur, devam ettirir; oturumu kendi terminalinde açar ve ofise geri verir.
7. Her karakterin üstünde bugünkü token ve maliyeti, köşede 5 saatlik ve haftalık kotayı görür.
8. Ofis sunucusu kapanıp açıldığında çalışanlar kaldıkları oturumla geri gelir.

## 2. Sahibin kararları (bilinçli tercihler)

| Konu | Karar |
|---|---|
| Motor | Her çalışanın arkasında bir **Claude Code** oturumu. Codex sonra; motor değiştirilebilir tasarlanır. |
| Serbestlik | Çalışanlar **hiçbir şey için onay istemez** (`bypassPermissions`), önlerinde **duvar yok**. |
| Bağlantılar | Çalışanlar sahibinin **bütün bağlantılarını devralır** (claude.ai: Gmail, Slack, Drive, Notion, Jeeta…; yerel MCP sunucuları). Çalışanlar dışarıda sahibi adına iş yapabilir — bu risk sahibince kabul edildi. |
| Kişisel ayarlar | Çalışanlar sahibinin kişisel `CLAUDE.md`'sini, hafızasını ve eklentilerini (superpowers dahil) **devralmaz**; talimatları kendi rol tanımıdır. |
| Erişim | Şimdilik **yalnızca bu bilgisayar** (localhost). İnternete açılırken giriş sistemi zorunlu olacak. |
| Görünürlük | Kimin ne kadar token/maliyet harcadığı karakterin üstünde görünür. |
| Meshy | Sisteme **entegre edilmez**, skill'i de yazılmaz (sahibinin kararı, 2026-10-06). Modeller tek seferlik üretilir; ofis yalnızca `assets/3d/` ve manifest'i okur (§8, §9). |

## 3. Mimari

```
 ┌───────────────────────────── tarayıcı ─────────────────────────────┐
 │  office-web   3D ofis · karakter paneli (canlı oturum + sohbet)    │
 │               işe alma formu · kota göstergesi                     │
 └───────────────▲──────────────────────────────┬─────────────────────┘
        canlı olaylar (WebSocket)        komutlar (HTTP)
 ┌───────────────┴──────────────────────────────▼─────────────────────┐
 │  office-server   (127.0.0.1)                                        │
 │   ├─ roster    çalışan kartları                                    │
 │   ├─ engine    çalışan başına bir claude süreci                    │
 │   ├─ events    olay kaydı (SQLite) → canlı yayın                   │
 │   └─ quota     token · maliyet · 5 saatlik / haftalık pencere      │
 └───────────────┬────────────────────────────────────────────────────┘
                 │ stdin/stdout (stream-json)
        ┌────────▼────────┐ ┌─────────────────┐
        │ claude (Ada)    │ │ claude (Can)    │  …
        │ cwd: desks/ada  │ │ cwd: desks/can  │
        └─────────────────┘ └─────────────────┘
```

Çekirdek iki parçadır: **office-server** ve **office-web**. Ekranda görünen her şey olay akışından türetilir;
tarayıcı kendi başına durum uydurmaz.

**Teknoloji:** TypeScript (Node 24), pnpm workspaces; SQLite için Node'un yerleşik `node:sqlite`'ı
(yerel derleme gerektirmez); sunucu için Node `http` + `ws`; arayüz için Vite + React + React Three Fiber
(three.js) + drei; testler için Vitest.

**Repo düzeni:**

```
apps/office-server/     roster, engine, events, quota, api
apps/office-web/        sahne, karakterler, panel, form, kota göstergesi
packages/shared/        ortak tipler: Employee, OfficeEvent, EmployeeState, AssetManifest
assets/2d/              sahibin referans görselleri (Meshy girdisi)
assets/3d/              üretilmiş modeller + manifest.json (ofisin okuduğu tek yer)
```

Çalışma zamanı verisi **repo dışında** durur: `~/.control-center/` (`OFFICE_DATA_DIR` ile değiştirilebilir).

```
~/.control-center/
  office.db             SQLite
  desks/<slug>/         her çalışanın masası (cwd)
```

Neden repo dışı: Claude, çalıştığı klasörden yukarı doğru `CLAUDE.md` ve `.claude/` ayarlarını okur.
Masalar repo içinde olsaydı çalışanlar bu reponun geliştirme talimatlarını ve skill'lerini devralırdı.
`~/` ve `~/.control-center/` üstünde `CLAUDE.md` bulunmadığı kontrol edildi.

## 4. office-server

### 4.1 roster — çalışan kartları

Kart alanları: `id`, `slug`, `name`, `role` (serbest metin rol tanımı), `model` (`opus`|`sonnet`|`haiku`,
varsayılan `sonnet`), `characterId` (manifest'teki karakter ya da `voxel` = yerleşik voksel figür), `deskIndex`, `sessionId`, `lifecycle`
(§6), `createdAt`. Rol tanımı aynı zamanda masadaki `CLAUDE.md` dosyasıdır; dosya düzenlenirse bir sonraki
başlatmada geçerli olur.

İşe alma: boş masa atanır (yerleşimdeki masa sayısı üst sınırdır, v1'de 8); `desks/<slug>/` açılır;
`CLAUDE.md` (rol kartı) yazılır; oturum başlatılır. İşten çıkarma: süreç kapatılır, kart
`archived` olur, masa boşalır; masa klasörü silinmez.

Çalışana özel ayarlar masaya dosya olarak yazılmaz; her başlatmada `--settings` ile verilir (§4.2).
Masaya gizli anahtar yazılmaz.

### 4.2 engine — oturumlar

Her etkin çalışan için sürekli açık tek bir süreç (2026-10-06 denemesinde doğrulandı):

```
claude -p --input-format stream-json --output-format stream-json --verbose
       --model <model> --permission-mode bypassPermissions
       --setting-sources user,project,local
       --settings '{"enabledPlugins":{"superpowers@claude-plugins-official":false},
                    "claudeMdExcludes":["~/.claude/CLAUDE.md"],
                    "attribution":{"commit":"","pr":""}}'
       (--session-id <uuid> | --resume <sessionId>)
cwd = ~/.control-center/desks/<slug>
```

- Kullanıcı ayarları açık tutulur; böylece sahibinin bütün bağlantıları gelir: claude.ai bağlantıları,
  yerel MCP sunucuları (blender, cad) ve eklenti MCP sunucuları (playwright, github…). `--settings` yalnızca
  superpowers eklentisini, sahibinin kişisel `CLAUDE.md`'sini ve Claude imzasını kapatır. Masadaki rol kartı
  (`CLAUDE.md`) yüklenmeye devam eder. (2026-10-06'da doğrulandı: "HARD RULE" görünmüyor, commit imzası yok,
  superpowers yok, 14 eklenti ve tüm MCP sunucuları var.)
- **Mesaj:** stdin'e `{"type":"user","message":{"role":"user","content":…}}` yazılır. Tur sürerken
  yazılan mesaj bir sonraki araç adımında modele ulaşır ve aynı turda cevaplanır (doğrulandı).
- **Yan soru (`/btw`):** ayrı, tek seferlik bir süreç: `claude -p --resume <sessionId> --fork-session
  --setting-sources user,project,local --settings <aynı çalışan ayarları> --strict-mcp-config --tools ""`;
  soru stdin'den verilir (`--tools` kendinden sonraki argümanları yuttuğu için en sonda). Cevap panelde "yan cevap" olarak
  görünür, asıl konuşmaya eklenmez, asıl iş bölünmez (doğrulandı, ~6 sn). Kopya oturum o an süren adımı
  "yarıda kalmış" sanabilir; kabul edilen küçük kusur.
- **Durdur:** stdin'e `{"type":"control_request","request_id":…,"request":{"subtype":"interrupt"}}` yazılır;
  tur hemen `error_during_execution` ile biter, süreç açık kalır ve sonraki mesajı alır (doğrulandı). Ardından
  süreç kapatılır, oturum korunur.
- **Devam:** `--resume <sessionId>` ile yeniden açılır; bağlam korunur (doğrulandı).
- **Terminalde aç:** engine süreci kapatır, kartı `in_terminal` yapar ve sahibine
  `cd <masa> && claude --resume <sessionId>` komutunu verir. `in_terminal` iken engine o çalışan için
  süreç başlatmaz (aynı oturuma iki yazar olmaz). "Ofise geri al" ile kilit kalkar.
- **Kaynak:** boşta süreç token harcamaz; bütün bağlantılarıyla ~475 MB bellek tutar (ölçüldü; 8 çalışan
  ≈ 3,8 GB). v1'de süreçler açık kalır.
- **Görünürlük:** başsız oturumlar da bir mesajlaşma soketi açar ve sahibinin diğer Claude oturumlarının
  listesinde (`ListAgents`) masa klasörünün adıyla görünür (doğrulandı). v1'de bu olduğu gibi kalır.

Motor arayüzü (`EngineAdapter`: `start`, `send`, `sideQuestion`, `stop`, `resume`, olay akışı) Claude'a
özgü ayrıntıları kapsüller; Codex ileride aynı arayüzle eklenir.

### 4.3 events — olay kaydı

Claude'un stream-json çıktısı ortak bir biçime çevrilir, `events` tablosuna eklenir (yalnızca ekleme)
ve WebSocket'ten yayınlanır. Ortak olay türleri:

| Tür | Kaynak |
|---|---|
| `session.started` | `system/init` (oturum no, model, bağlantıların durumu) |
| `turn.started` / `turn.finished` | ilk mesaj / `result` (tur sayısı, token, maliyet) |
| `message.user` | sahibinin mesajı |
| `message.assistant` | asistan metni |
| `tool.started` / `tool.finished` | `tool_use` / `tool_result` (+ `task_started`/`task_notification`) |
| `side.question` / `side.answer` | yan soru ve cevabı |
| `quota.updated` | `rate_limit_event` |
| `lifecycle.changed` | engine'in durum geçişleri |
| `error` | süreç hatası, stderr özeti |

Ham stream-json satırları ayrıca masada saklanmaz; Claude'un kendi oturum kaydı zaten
`~/.claude/projects/…` altında durur.

### 4.4 quota

- Çalışan başına: Claude `result` olayında `total_cost_usd` ve `modelUsage` değerlerini **oturum boyunca
  birikmiş toplam** olarak verir (devam ettirilen ve kopyalanan oturumlar da eski toplamdan başlar; `usage`
  yalnızca o turun ana döngüsüdür). Bu yüzden engine her sonuçta bir önceki toplamdan farkı alır ve olaya o
  turun payı olarak yazar; yan sorunun payı, kopyanın toplamı eksi ana oturumun kopyalandığı andaki toplamıdır.
  Tokenlar `modelUsage`'dan (bütün modeller, alt ajanlar dahil) gelir. Bugünkü ve toplam değerler bu paylardan
  toplanır. Maliyet, Claude'un hesapladığı API karşılığıdır; abonelikten ayrıca para çekilmez.
- Ofis geneli: `rate_limit_event.rate_limit_info.unifiedWindows.{five_hour,seven_day}`
  `utilization` ve `resetsAt` değerleri son okunan hâliyle tutulur (doğrulandı).

### 4.5 api

HTTP (yalnızca 127.0.0.1): `GET /api/office` (kartlar, durumlar, kota, manifest özeti),
`POST /api/employees` (işe al), `DELETE /api/employees/:id` (çıkar),
`POST /api/employees/:id/messages`, `POST /api/employees/:id/side-questions`,
`POST /api/employees/:id/stop`, `POST /api/employees/:id/resume`,
`POST /api/employees/:id/terminal` / `DELETE …/terminal`,
`GET /api/employees/:id/events?after=<seq>`.

**Güvenlik:** çalışanlar onaysız ve sahibinin bağlantılarıyla çalıştığı için ofis API'si, onları dışarıdan
yönetmenin tek kapısıdır. Bu yüzden: yalnızca `127.0.0.1`'e bağlanır; `Host` başlığı `127.0.0.1:<port>` ya
da `localhost:<port>` olmalı (DNS rebinding'e karşı); `Origin` varsa ofisin kendi adresi ya da `OFFICE_ALLOWED_ORIGINS` ile açıkça izin
verilmiş bir adres olmalı (varsayılan boş: ortak bir geliştirme portunu, örn. Vite'ın 5173'ünü, kendiliğinden güvenmeyiz) (tarayıcıda açık başka bir sitenin istek atmasına — CSRF, WebSocket ele geçirme —
karşı); `POST` istekleri `application/json` olmalı.

WebSocket `/ws`: bağlanınca anlık görüntü, ardından olay akışı. Kopma sonrası istemci son gördüğü
`seq`'ten devam eder.

## 5. Veri modeli (SQLite)

- `employees` — §4.1'deki kart alanları.
- `events` — `seq` (artan), `employeeId`, `ts`, `type`, `payload` (JSON).
- `quota` — tek satır: son pencere değerleri ve okunma zamanı.

Çalışan başına token/maliyet toplamları `events`'ten hesaplanır; gerekirse önbellek tablosu eklenir.

## 6. Durumlar ve karakter davranışı

Engine yaşam döngüsü (`lifecycle`): `starting` → `idle` ⇄ `working` → `stopped` | `in_terminal` |
`limited` | `interrupted` | `error`.

Karakter davranışı olaylardan türetilen saf bir fonksiyondur (olaylar → `{yer, animasyon, işaretler}`):

| Durum | Karakter |
|---|---|
| `working` | Masasına yürür, oturur, **yazma** animasyonu |
| `working` + 30 sn'den uzun süren bir araç | Server odasına gider, rafa bakar; araç bitince masaya döner |
| sahibi paneli açıp yazıyor | Masada sahibine döner, **oturarak konuşma** |
| `idle` (tur bitti) | 60 sn sonra kahve köşesine ya da oturma alanına gider (**kahve içme** / **ayakta durma**) |
| `limited` / `error` | Masasında durur, başının üstünde kırmızı işaret; `limited`'da açılma saati |
| `stopped` / `in_terminal` | Soluk görünür; `in_terminal`'de terminal simgesi |

Karakterin üstünde: ad, durum ışığı, bugünkü token ve maliyet (iki satırlık etiket). Etiketler ekranda üst
üste binmez: kameraya en yakın olan yerinde kalır, arkadakiler gerektiği kadar yukarı kayar (her karede, her
yakınlaştırma ve açıda). Her masanın kahve/oturma/server noktası kendine aittir; iki çalışan aynı noktada durmaz.
Toplantı odası v1'de kullanılmaz.

## 7. office-web

- **Sahne:** referans görsele göre yerleşim (8 masalık açık alan, cam toplantı odası, server odası,
  kahve köşesi, oturma alanı, resepsiyon, bitkili kitaplık). Bina (zemin, duvar, pencere, cam bölme, halı)
  kodla voksel kutulardan kurulur. Eşyalar ve karakterler `assets/3d/manifest.json`'dan yüklenir.
- **Yerleşim verisi:** `office/layout.ts` — bölgeler, masa oturma noktaları, kahve/oturma/server noktaları,
  yürüme ızgarası. Karakterler ızgara üzerinde en kısa yolla yürür (A*).
- **Kamera:** referanstaki gibi yukarıdan izometrik açı; yakınlaştırma ve kaydırma, sınırlı döndürme (yalnız alçak duvarlı güney–doğu tarafında).
- **Karakter paneli:** canlı akış (metin; açılır kapanır komut kutuları; dokunulan dosyalar), mesaj kutusu,
  "Yan soru" anahtarı, Durdur / Devam / Terminalde aç, model–token–maliyet–oturum no.
- **İşe alma formu** ve köşede **kota göstergesi**.

## 8. Model anlaşması (manifest)

`assets/3d/manifest.json`, ofisin modellerle ilgili bildiği tek şeydir:

```json
{
  "version": 1,
  "items": [
    { "id": "work_desk", "kind": "furniture", "file": "furniture/work_desk.glb",
      "size": { "x": 1.52, "y": 0.75, "z": 0.80 } },
    { "id": "coder", "kind": "character", "name": "Kodcu", "file": "characters/coder/base.glb",
      "height": 1.7,
      "clips": { "idle": "characters/coder/idle.glb", "walk": "characters/coder/walk.glb",
                 "sit": "characters/coder/sit.glb", "typing": "characters/coder/typing.glb",
                 "talkSeated": "characters/coder/talkSeated.glb", "drink": "characters/coder/drink.glb" } }
  ]
}
```

- Ofis modeli `size`/`height`'e ölçekler; kaynak dosyanın ölçeğine güvenmez.
- Bir karakter, iskeletli tek bir model dosyası (`file`) ve her rol için yalnızca hareketi taşıyan ayrı bir
  klip dosyasıdır (`clips`; klip dosyasındaki ilk animasyon kullanılır, kemik adları modelinkiyle aynıdır).
  Eksik bir rol için yakın bir klip kullanılır (yazma → oturma → durma).
- Model eksik ya da bozuksa ofis yerine düz bir voksel kutu (karakterde basit voksel figür) gösterir
  ve çalışmaya devam eder.
- Modelin nereden geldiği (Meshy, Blender, başka araç) ofisi ilgilendirmez.

## 9. Modellerin üretimi (sistem dışı)

Sahibinin 2026-10-06 kararıyla Meshy sisteme entegre edilmez ve skill'i yazılmaz. Modeller tek seferlik bir
betikle üretilip `assets/3d/`'ye konur; ofis yalnızca manifest anlaşmasını (§8) bilir. Denemeden öğrenilenler
(eşya: yalnız şekil + orijinal görselle yeniden dokulama; karakter: A pozu → ≤50k yüzey → iskelet → kütüphane
animasyonları + metinden "yazma" hareketi) o betikte uygulanır. Anahtar `.env`'de kalır.

## 10. Hata durumları (çekirdek)

| Durum | Davranış |
|---|---|
| Çalışanın süreci beklenmedik kapanır | Olay kaydı; bir kez `--resume` ile yeniden açma. Claude'un okuduğunu onaylamadığı mesajlar (`--replay-user-messages`) yeni sürece yeniden gönderilir; okunmuş bir iş yarım kaldıysa "kaldığın yerden devam et" de eklenir. 2 dk içinde tekrar kapanırsa `error`, panelde stderr özeti. |
| Tur bitmek üzereyken mesaj gelir | Claude onu ayrı bir ek turda cevaplar (`queued_turn_count` > 0); çalışan bu turlar bitene dek `working` kalır. |
| Durdur / işten çıkar / terminalde aç üst üste gelir | Çalışan başına sırayla çalışır; biri sürerken gelen mesaj ya da "devam" 409 ile reddedilir, hiçbir komut bir öncekinin sonucunu ezmez. |
| Aynı veri klasöründe ikinci bir ofis açılır | Veri klasöründeki kilit dosyası yüzünden ikinci ofis, çalışanlara dokunmadan çıkar; ofis portu aldıktan sonra kurtarmaya başlar. |
| Bozuk bir WebSocket çerçevesi gelir | Yalnızca o bağlantı kapanır; ofis süreci ayakta kalır. |
| office-server kapanır / çöker | Açılışta her etkin kart kendi oturumuyla geri gelir; o an süren tur `interrupted` olarak işaretlenir ve tek tıkla sürdürülür. |
| Abonelik limiti dolar | `limited`; `resetsAt` (+30 sn) geldiğinde engine kendiliğinden "Limit açıldı, kaldığın yerden devam et." mesajını gönderir. |
| Bir bağlantı açılamaz | `session.started`'taki bağlantı durumundan panelde uyarı; çalışan diğerleriyle sürer. |
| Tarayıcı bağlantısı kopar | Otomatik yeniden bağlanma; anlık görüntü + son `seq`'ten sonraki olaylar. |
| Çalışan terminalde | Engine o çalışan için süreç başlatmaz. |
| Model dosyası eksik/bozuk | Yer tutucu voksel kutu; konsolda uyarı. |

## 11. Test

- **Sahte claude:** denemede kaydedilen gerçek stream-json çıktılarını oynatan test programı. Olay
  çevirimi, yaşam döngüsü geçişleri, tur ortası mesaj, devam, limit, çökme sonrası geri gelme token
  harcamadan ve tekrarlanabilir biçimde test edilir.
- **Durum → davranış:** §6 tablosu saf fonksiyon testleriyle.
- **Gerçek claude ile duman testi** (isteğe bağlı, Haiku): işe al → mesaj → cevap → durdur → devam →
  yan soru.
- **Arayüz:** panel bileşen testleri; 3D sahne başsız Chrome ile açılıp ekran görüntüsüyle kontrol
  (Playwright MCP bu makinede sandbox nedeniyle açılmıyor; `chrome --headless=new --no-sandbox` çalışıyor).

## 12. Sonraki aşamalar (bu belgede uygulanmaz)

Konuşmada kararlaştırılanlar, sırası sonra belirlenecek:

- **İş kuyruğu ve zamanlayıcı:** iş sahibinden, iş arkadaşından ya da çalışanın kendisinden gelir;
  her çalışanın öncelik sıralı kuyruğu, zamanlanmış/tekrarlayan işleri; sahibi ekrandan yönetir.
- **Bölme kuralı:** işin ortasına yalnızca sahibi girer; iş arkadaşının mesajı alıcının kuyruğuna iş
  olarak düşer; kısa sorular yan soru (kopya oturum) ile kimseyi bölmeden cevaplanır.
- **Sonsuz döngüye karşı:** iş zinciri uzunluk sınırı, günlük iş açma ve kendi kendine iş sınırı.
- **Masa + ortak arşiv:** biten iş arşive teslim edilir; diğerleri arşivden okur. Görev bazlı, varsayılan
  kapalı "bilgisayardaki klasörde çalış" seçeneği.
- **Rol kartı genişlemesi:** koordinatör, "kimden iş alır" (herkes / koordinatör / sahibi).
- **Görev kartı:** isteyen, üstlenen, tanım, bitti tanımı (madde listesi), öncelik; **taahhüt**
  (teslim sözü, gecikme karakterde görünür).
- **Ekip el kitabı** (sürümlü süreçler, test prosedürleri, ölçütler, teslim kuralları) ve **karar defteri**
  (gözlem → karar → değişiklik; sahibi geri alabilir).
- **Parça parça teslim** ve "ilk parça gelince başla" bağımlılıkları.
- **Yetki sistemi:** iş verme, teslim kontrolü, el kitabı, işe alma/çıkarma, bütçe, organizasyon —
  kapsamıyla (kendisi/ekip/ofis) herhangi bir çalışana verilebilir; "koordinatör" bir şablondur.
  Sahibi her zaman en üsttedir; yetkiler karakterde rozet olarak görünür.
- **Koordinatör kararları:** süreç (yeni test prosedürü), ürün (araştırma, mimari çıkarma), çalışma
  biçimi, işe alım (sahibinin koyduğu kişi sınırı içinde), model seçimi ve token/kota yönetimi.
- **Ofis araç seti (MCP):** çalışanın platformla konuştuğu araçlar (iş aç, teslim et, el kitabını
  güncelle, işe al…); yetkiler araç erişimiyle uygulanır.
- Toplantı odasının kullanımı, Codex motoru, internetten erişim (giriş sistemiyle), boştaki süreçleri
  kapatıp gerektiğinde açma, yeni çalışanlar için karakter üretimi (sistem dışı, tek seferlik).

## 13. Doğrulananlar (2026-10-06)

1. Bağlantıların devri: `--setting-sources user,project,local` + `--settings` (§4.2) — doğrulandı.
2. Turu kesme: stream-json `interrupt` kontrol isteği — doğrulandı.
3. Claude imzası: `--settings` içindeki `attribution` ile kapanıyor — doğrulandı.
4. Başsız oturumlar sahibinin `ListAgents` listesinde görünüyor — doğrulandı, v1'de olduğu gibi kalıyor.
5. Bellek: çalışan başına ~475 MB — ölçüldü.
