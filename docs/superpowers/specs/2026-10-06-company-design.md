# control-center — Şirket ("kendi kendini örgütleyen ofis") tasarımı

- Tarih: 2026-10-06
- Durum: sahibiyle konuşmada bölüm bölüm onaylandı; yazılı belge incelemede
- Dayandığı: `2026-10-06-office-v1-design.md` (v1 ofis: çalışanlar, oturumlar, 3D ofis — bitti, yerel main'de).
  Bu belge v1 spec'inin §12'sindeki "sonraki aşamalar"ın tasarımıdır.

## 1. Amaç

Sahibi bir ihtiyaç getirir; bir **koordinatör** "bunu şöyle çözeceğiz" diye plan sunar, sahibiyle tartışıp karar verir,
ekibi kurar ve işi dağıtır. Şirket iş büyüdükçe kendini yeniden örgütler; roller, iş tanımları ve çalışma yöntemleri
sabit değildir, koordinatör yazar ve değiştirir. Çalışanlar yalnız emir uygulamaz: ihtiyaç, fikir ve itirazlarını
yukarı taşır, gerekirse yön değişir. Şirketin kalıcı bir hafızası vardır.

Başarı ölçütü — sahibi şunları yapabildiğinde biter:

1. Koordinatörle konuşur; koordinatör bir **plan kartı** sunar (yaklaşım, kimler, görevler, tahmini kota/para/süre).
2. Tartışır, kart güncellenir; **Onayla** ile karar verir.
3. Koordinatör gerekiyorsa çalışan işe alır (rol kartı, model, karakter kendisi seçer) ve görevleri dağıtır.
4. Çalışanlar görevleri sırayla yapar, birbirine görev paslar, teslim eder; ekranda görev panosu canlı akar.
5. Bir çalışan öneri/itiraz/satın alma talebi açar; koordinatör karar verir ya da büyükse sahibine getirir.
6. Plan bitince koordinatör sahibine raporlar; büyük bir sapmada bir **plan revizyonu** getirir.
7. Kararlar, el kitabı, bilgi notları ve teslimler şirket hafızasında kalır; ofis yeniden başlasa da kaybolmaz.
8. Ofis, sahibinin kendi kullanımı için ayırdığı kota payını yemez; kota sıkışınca öncelikliler çalışır.

## 2. Sahibinin kararları (bilinçli tercihler)

| Konu | Karar |
|---|---|
| Serbestlik | **Sınırsız özgürlük ve sınırsız izin** (v1 kararı, sahibince yinelendi): bütün çalışanlar — koordinatör dahil — izin denetimi kapalı çalışır (`--permission-mode bypassPermissions`, `--dangerously-skip-permissions` ile aynı kip); hiçbir araç onay istemez, ofis araçları ve dış dünyaya dokunan işler (e-posta, paylaşım, canlıya gönderim) dahil. Risk sahibince kabul edildi. |
| Muhatap | Sahibi **yalnız koordinatörle** konuşur (diğer panelleri açabilir ama varsayılan muhatap koordinatördür). |
| Karar döngüsü | Plan → tartışma → sahibinin **Onayla**'sı → dağıtım. |
| Sapma kuralı (B) | Küçük değişikliğe koordinatör karar verir, kaydeder, bildirir. **Büyük** değişiklikte (hedef/kapsam değişiyor, harcama onaylı bütçeyi aşıyor, süre ciddi uzuyor) sahibine plan revizyonu getirir. |
| İş paslama | Çalışanlar ihtiyaç olunca birbirine **doğrudan** görev paslar; herkes kendi tanımındaki işi yapar. |
| Hiyerarşi | **Az katman**: koordinatör → (ekip lideri) → çalışan; en fazla iki kademe. |
| Kalıcılık | Çalışanlar **kalıcıdır**; iş bitince çıkarılmaz, yeniden görevlendirilir. **İşten çıkarma yalnız sahibinin kararıyla.** Uzun boşta kalan uyutulur (hafıza korunur). |
| Bütçe | Her planın bütçesi onayında belirlenir; sahibi sabit sınırları (anayasa) koyar. |
| Hafıza | Şirket hafızası **mutlaka** var ve kalıcı. |
| Mimari | **Ofis araç seti** (MCP) yaklaşımı (ortak klasör ve Claude alt ajanları elendi). |

## 3. Örgüt

### 3.1 Roller

| Rol | Kim | Ne yapar |
|---|---|---|
| Sahibi | Siz | Koordinatörle konuşur; plan ve revizyonları onaylar; işten çıkarır; anayasayı koyar; kararları geri alır. |
| Koordinatör | Ofiste bir tane; şirketin ilk çalışanı (ofis boşsa kendiliğinden kurulur). Varsayılan model **Fable**. | Plan yapar; işe alır; iş atar, önceliklendirir; rol kartlarını yazar/değiştirir; model seçer; ekip lideri atar; uyutur/uyandırır; el kitabını yönetir; sahibine raporlar. |
| Ekip lideri | Bir ekip 4–5 kişiyi geçince koordinatörün atadığı çalışan | Kendi ekibine iş atar, önceliklendirir; işe alamaz (koordinatörden ister). Etiketinde rozet görünür. |
| Çalışan | Diğerleri | Kendi tanımındaki işi yapar; herkese görev paslar; öneri/talep açar. |

Koordinatörsüz bir ofiste (çalışanlar var ama koordinatör yok) Şirket görünümü sahibine bir çalışanı koordinatör
yapmayı ya da yeni bir koordinatör işe almayı önerir; ofis koordinatörsüz de v1 gibi çalışmaya devam eder.

`employees` kartına eklenir: `title` (unvan), `team`, `kind` (`coordinator` \| `lead` \| `member`), `reportsTo`
(lider ya da koordinatör), `sleeping`. Rol tanımı (`role`) v1'deki gibi serbest metindir ve masadaki `CLAUDE.md`'dir.

### 3.2 Rol kartı

Koordinatör yazar ve istediği zaman değiştirir: ad, unvan, ekip, iş tanımı (sorumluluklar, nasıl çalışacağı,
"bitti" beklentisi), kimden iş alacağı. Masadaki `CLAUDE.md` = ofisin standart girişi + rol kartı + `@company-brief.md`
içe aktarması (§5.1). Kart değişince dosya yeniden yazılır; çalışan bunu bir sonraki oturum açılışında ya da
sıkıştırmada okur, ayrıca ofis değişikliği bir sonraki görevle birlikte kısaca iletir (CLAUDE.md oturum ortasında
yeniden okunmaz — doğrulandı, Claude Code belgeleri).

### 3.3 İşe alma, model ve karakter

- Koordinatör `hire` aracıyla: rol kartı, model ve karakter verir. **Karakteri koordinatör seçer** (manifest'teki
  karakterlerin adı ve kısa tanımı araçta listelenir); verilmezse ofis en az kullanılanı seçer.
- Kişi sınırı: anayasadaki `maxEmployees` (varsayılan masa sayısı, 8; koordinatör dahil). Dolu iken `hire` reddedilir;
  koordinatör sahibine getirir (büyük değişiklik).
- Model: `fable` \| `opus` \| `sonnet` \| `haiku` (Claude Code takma adları; dördü de bu abonelikte çalışıyor —
  denendi). Kaba kural koordinatörün el kitabında başlar: muhakeme/mimari/araştırma → Fable; karmaşık geliştirme →
  Opus; rutin yazılım ve yazı → Sonnet; basit, tekrarlı → Haiku. `setModel` oturumu yeni modelle sürdürür
  (`--resume` + `--model` — belgede var; ilk planda gerçek claude ile doğrulanacak).
- Sahibinin işe alma formu kalır (Fable eklenir); koordinatörün yaptığıyla aynı yolu kullanır.

### 3.4 Uyku ve işten çıkarma

- **Uyku:** koordinatör `sleep` ile ya da ofis kendiliğinden (sıra boş, 30 dk işsiz) çalışanın sürecini kapatır;
  oturum ve masa durur. Ona görev düşünce ya da sahibi yazınca aynı oturumla uyanır. Karakter masasında soluk.
- **İşten çıkarma:** yalnız sahibi (ekrandan). Önce çalışana bir devir görevi düşer (elindekileri ve öğrendiklerini
  hafızaya yaz, açık görevlerini koordinatöre geri ver), bitince arşive alınır. Koordinatör yalnız önerir.

## 4. İş akışı

### 4.1 Plan

1. Sahibi koordinatörün panelinde yazar.
2. Koordinatör `planPropose` ile **plan kartı** açar: başlık, hedef, yaklaşım, kimler (mevcut + işe alınacak roller),
   görev taslağı, tahmini kota payı / para / süre, riskler.
3. Tartışma sürer; koordinatör `planRevise` ile kartı günceller (sürümlü).
4. Sahibi kartta **Onayla** (ya da **Vazgeç**). Onay bir karar kaydıdır; koordinatöre sistem mesajı gider.
5. Koordinatör görevleri açar, işe alır, dağıtır.

Plan durumları: `taslak` → `onaylı` → `sürüyor` → `bitti` | `vazgeçildi`; revizyon onay bekliyorsa `revizyonda`.

### 4.2 Görev kartı

Alanlar: başlık, açıklama, **bitti tanımı** (madde listesi), isteyen (sahibi / çalışan), üstlenen, öncelik (1–5),
plan, bağımlılıklar (başka görevler: "şu parça gelince başla"), durum (`bekliyor` \| `sürüyor` \| `takıldı` \| `bitti`
\| `iptal`), zincir derinliği, teslim (özet, çıktı yolları, öğrenilenler).

### 4.3 Kuyruk ve teslim

- Her çalışanın öncelik sıralı kuyruğu vardır (öncelik, sonra açılış zamanı; bağımlılığı bitmemiş görev atlanır).
- Çalışan boşa çıkınca (`idle`) ofis sıradaki görevi **sistem mesajı** olarak verir (başlık, açıklama, bitti tanımı,
  bağlam: plan, isteyen, ilgili kararlar) ve görevi `sürüyor` yapar. Uyuyorsa önce uyandırır.
- Çalışan `taskFinish` ile teslim eder; isteyen ve koordinatör bilgilenir (görev panosu, isteyene sistem mesajı
  sıradaki boşluğunda). Takılırsa `taskUpdate(takıldı, neden)`; koordinatör görür.
- v1 kuralı sürer: işin ortasına yalnız sahibi girer; görevler ve paslar kuyruğa düşer.

### 4.4 Paslama ve öneriler

- `taskPass(kime, …)`: herkes herkese; alıcının kuyruğuna düşer, önerilen öncelikle. Koordinatör/lider sırayı değiştirebilir.
- `propose(tür, başlık, metin)`: tür `ihtiyaç` \| `satınalma` \| `fikir` \| `itiraz`; liderine ya da koordinatöre düşer.
  Koordinatör karar verir (karar defterine yazılır) ya da büyükse plan revizyonuna katıp sahibine getirir.
  **Satın almalar her zaman sahibine** gider (parayı ödeyen ve alan sahibi).

### 4.5 Değişiklik (B kuralı) ve rapor

- Küçük değişiklik: koordinatör görevleri günceller, `decisionRecord` ile yazar, sahibine özet geçer (`reportToOwner`).
- Büyük değişiklik: `planRevise` + "onay bekliyor"; sahibi onaylayana dek planın yeni kapsamına geçilmez (eski
  görevler sürebilir).
- Rapor: plan bitince, büyük değişiklikte ve günde bir kısa özet (sahibi açıksa panelde, değilse koordinatörün
  etiketinde bildirim).

### 4.6 Sonsuz döngüye karşı (anayasa)

Zincir derinliği ≤ 5 (paslanmış görevden paslanan…); bir çalışanın günde açabileceği görev ≤ 30; bir planın açık
görev sayısı ≤ 60. Aşınca araç reddeder ve koordinatöre not düşer.

## 5. Şirket hafızası

### 5.1 Katmanlar

| Katman | Ne | Kim yazar | Nerede |
|---|---|---|---|
| Kişisel | Claude oturumu, masa dosyaları, masaya özel Claude hafızası | Çalışan | Masası (v1) |
| Şirket özeti | Misyon, süren planlar, temel kurallar, kim ne yapıyor (kısa, ≤ 2 sayfa) | Koordinatör | `company/brief.md`; her masaya `company-brief.md` olarak kopyalanır ve rol kartından `@company-brief.md` ile içe aktarılır (başsız oturum proje dışı içe aktarmayı yüklemez — doğrulandı) |
| Karar defteri | Kim, ne zaman, ne seçildi, neden, hangi alternatifler; geri almalar | Koordinatör, lider; sahibinin onay/geri almaları | DB `decisions` |
| El kitabı | Çalışma yöntemleri (test prosedürü, sürüm, video üretimi, marka dili…), konu başına sürümlü | Koordinatör, lider | DB `playbook` + `company/playbook/<konu>.md` |
| Bilgi notları | Öğrenilen her şey; etiketli, tam metin aranır | Herkes | DB `notes` (FTS) |
| Arşiv | Teslim edilen işlerin çıktıları | Teslim eden | `company/archive/<plan>/<görev>/` |
| Geçmiş | Planlar, görevler, sonuçlar; çalışan dosyaları (kim nerede iyi) | Ofis; çalışan dosyasını koordinatör | DB `plans`, `tasks`, `employee_notes` |

`company/` = `~/.control-center/company/` (veri klasörünün içinde; yedeklenir, taşınır, hiçbir oturuma bağlı değil).

### 5.2 Kurallar

- Özet değişince bütün masalardaki kopya güncellenir; çalışanlar sıkıştırmada ya da yeni oturumda okur, ayrıca
  sıradaki görev mesajı "özet değişti: …" satırı taşır.
- Geri alma: sahibi bir kararı geri alınca yeni bir karar kaydı (`reverts`) düşer ve koordinatöre sistem mesajı gider.
- İşten çıkan çalışanın devir notları ve çalışan dosyası saklanır.

## 6. Bütçe ve kota

- **Kota** (5 saat / 7 gün; herkes ve sahibinin kendi Claude kullanımı aynı kotayı paylaşır): ofis canlı izler (v1).
  Koordinatör `budgetStatus` ile görür; model seçerek, sıralayarak ve uyutarak idare eder.
- **Sahibinin payı (anayasa):** `ownerReservePct` (varsayılan %25). Haftalık ya da 5 saatlik kullanım
  `100 − pay` sınırını geçince ofis: yeni görev vermeyi durdurur (öncelik 1 hariç), boştakileri uyutur, koordinatöre
  bildirir. Süren turlar biter; pencere açılınca kendiliğinden döner.
- **Para:** çalışanlar dış servisleri serbestçe kullanır; ofis dış harcamayı göremez. Kural (el kitabında değişmez
  madde): para harcayan her iş `recordSpend(servis, tutar, ne için, plan)` ile bildirilir. Plan kartında harcanan /
  onaylanan yan yana; aşım büyük değişikliktir. `monthlyUsdCap` (anayasa) aşılırsa `recordSpend` uyarı döner ve
  koordinatör sahibine getirir. (Ofis harcamayı **engelleyemez** — çalışanlar serbest; sınır görünürlük ve
  koordinatörün görevi içindir.)
- **Görünürlük:** karakter başına token/maliyet (v1) + plan ve ekip başına toplam kota, para, kalan bütçe.

## 7. Ofis araç seti (MCP)

- Ofis sunucusu `/mcp` adresinde bir **HTTP MCP sunucusu** açar. Her çalışan oturumu `--mcp-config` ile
  `{"mcpServers":{"office":{"type":"http","url":"http://127.0.0.1:<port>/mcp","headers":{"Authorization":"Bearer <çalışan jetonu>"}}}}`
  alır (belgede var). Jeton çalışana özeldir (işe alımda üretilir, DB'de özetlenmiş saklanır); araç kimin
  çağırdığını jetondan bilir, yetkiyi sunucu tarafında da denetler. Diğer bağlantılar v1'deki gibi devralınır.
- İzin: bütün çalışanlar izin denetimi kapalı çalışır (`--permission-mode bypassPermissions` =
  `--dangerously-skip-permissions`); ofis araçları da onaysız çağrılır. İlk planın ilk adımı bunu gerçek claude ile
  doğrular; bir araç yine onay bekletirse `--allowedTools mcp__office__*` eklenir (izin modeli değişmez).
- `/mcp` yalnız `127.0.0.1`, Host denetimi (v1), Origin istenmez (tarayıcıdan değil), jeton zorunlu.

| Araç | Herkes | Lider (kendi ekibi) | Koordinatör |
|---|---|---|---|
| `myTasks`, `taskStart`, `taskUpdate`, `taskFinish`, `taskPass` | ✓ | ✓ | ✓ |
| `memorySearch`, `noteWrite`, `playbookRead`, `decisionsRead`, `briefRead` | ✓ | ✓ | ✓ |
| `propose`, `recordSpend`, `askColleague` (yan soru; bölmeden), `officeStatus` | ✓ | ✓ | ✓ |
| `taskCreate`, `taskAssign`, `taskReprioritize` | | ✓ | ✓ |
| `playbookUpdate`, `decisionRecord` | | ✓ | ✓ |
| `planPropose`, `planRevise`, `hire`, `setModel`, `editRoleCard`, `appointLead`, `sleep`, `wake`, `briefUpdate`, `employeeNote`, `reportToOwner`, `budgetStatus` | | | ✓ |

Yalnız sahibi (ekrandan, araç değil): plan/revizyon onayı ve vazgeçme, işten çıkarma, anayasa, karar geri alma,
koordinatörü değiştirme.

## 8. Ekran

- **Koordinatör paneli ana konuşma yeri:** sohbet akışının içinde plan ve revizyon kartları (Onayla / Vazgeç),
  ekipten gelen öneriler, raporlar. Panel v1 bileşenidir; yeni olay türleri için kart görünümleri eklenir.
- **Üst çubukta "Şirket" görünümü** (sağdan açılan geniş panel, sekmeli): Örgüt şeması · Görev panosu (sütunlar:
  bekliyor/sürüyor/takıldı/bitti; plana/kişiye süzgeç) · Planlar ve bütçeleri · Karar defteri (geri al düğmesi) ·
  El kitabı ve bilgi notları (okuma) · Anayasa (sınırlar).
- **3D ofis:** koordinatör plan yazarken toplantı odasına geçer; etikette şu anki görevin kısa başlığı; liderde rozet;
  uyuyan çalışanın masası soluk; görev paslanınca alıcının etiketinde kısa bildirim.

## 9. Veri modeli (SQLite, geri alınabilir göçler)

Yeni göç sürümleri (her biri `up` + `down`, `down` yalnız kendi eklediğini kaldırır; gidiş-dönüş testli):

- `employees`: `title`, `team`, `kind`, `reports_to`, `sleeping`, `token_hash` sütunları.
- `plans` (id, başlık, hedef, yaklaşım, taslak görevler JSON, kota payı, para, süre, riskler, durum, sürüm, onay zamanı).
- `tasks` (id, plan, başlık, açıklama, bitti tanımı JSON, isteyen, üstlenen, öncelik, bağımlılıklar JSON, durum,
  zincir derinliği, zamanlar, teslim JSON).
- `decisions` (id, zaman, veren, başlık, seçilen, gerekçe, alternatifler, plan, `reverts`).
- `playbook` (konu, sürüm, metin, yazan, gerekçe, zaman). `notes` (+ FTS5 dizini). `spend`. `proposals`.
  `employee_notes`. `constitution` (anahtar → değer: `maxEmployees`, `ownerReservePct`, `monthlyUsdCap`, döngü sınırları).
- Olaylar (`OfficeEvent`): `plan.*`, `task.*`, `proposal.*`, `decision.recorded`, `spend.recorded`, `brief.updated`,
  `employee.slept/woke`, `role.changed` — v1 olay kaydına ve canlı akışa girer (ekran bunlardan beslenir).

## 10. Hata durumları

| Durum | Davranış |
|---|---|
| Koordinatör çöker / limitte | v1 davranışı (yeniden açılır, limitte bekler); sahibinin mesajı sıraya girer, plan kartları DB'de durur. |
| Ofis yeniden başlar | Plan/görev/hafıza DB'de; süren görevler `sürüyor` kalır, çalışan dönünce v1 "kaldığın yerden devam" mesajıyla sürer. |
| Görevin üstlenicisi işten çıkarıldı | Açık görevleri koordinatörün kuyruğuna döner. |
| Bağımlılık hiç bitmiyor / döngü | Bağımlılık döngüsü görev açılırken reddedilir; uzun bekleyen görev koordinatöre bildirilir. |
| Araç çağrısı geçersiz (yetki yok, sınır doldu, bilinmeyen çalışan) | Araç Türkçe hata döner; ofis olay kaydına düşer. |
| Jeton sızar / yanlış jeton | `/mcp` 401; jeton yalnız o çalışanın oturum argümanında; işten çıkınca geçersiz. |
| Masalar dolu | `hire` reddedilir; koordinatör sahibine getirir. |

## 11. Test

- Fake claude (v1) MCP araçlarını çağıramaz; araçlar **doğrudan HTTP/MCP uç noktasından** çalışan jetonlarıyla
  sınanır (görev döngüsü, paslama, yetkiler, sınırlar, plan onayı, kota payı, hafıza araması), ofis tarafı da fake
  claude ile (görevin sistem mesajı olarak verilmesi, uyutma/uyandırma, devir).
- Göçler: gidiş–dönüş (up → down → up) testi.
- Ekran: bileşen testleri (plan kartı, görev panosu, örgüt şeması) + tarayıcıda uçtan uca (v1 düzeni).
- Gerçek claude kabul testi (isteğe bağlı, `OFFICE_SMOKE=1`; koordinatör Sonnet ile — ucuz): sahibi bir ihtiyaç yazar →
  koordinatör plan kartı açar → onay → koordinatör bir çalışan işe alır ve görev verir → çalışan teslim eder →
  koordinatör raporlar. §1'in 1–6. maddeleri.

## 12. Aşamalar (her biri kendi planı)

1. **Koordinatör ve görevler:** `/mcp` + jetonlar; görev kartı, kuyruk, otomatik görev verme, paslama, teslim;
   koordinatör rolü (işe alma: rol kartı/model/karakter, atama, öncelik); plan kartı ve Onayla; şirket özeti;
   Şirket görünümünde örgüt şeması ve görev panosu; Fable model listesi.
2. **Şirket hafızası:** karar defteri (geri alma), el kitabı (sürümlü), bilgi notları (arama), arşiv, çalışan dosyaları.
3. **Bütçe ve anayasa:** sahibinin kota payı, plan bütçeleri, `recordSpend`, aylık sınır, bütçe görünümleri,
   `setModel`, uyku/uyandırma otomatiği.
4. **Öneriler, revizyon ve ekip liderleri:** `propose` akışı, B kuralı (plan revizyonu), `askColleague`, liderler;
   3D tepkiler (toplantı odası, rozet, soluk masa, pas bildirimi).

## 13. Bu belgede yapılmayanlar

Toplantılar (birden çok çalışanın aynı anda konuştuğu oturumlar), Codex motoru, internetten erişim ve giriş sistemi,
masa sayısını 8'in üstüne çıkaran yerleşim büyütmesi, gerçek telefon hattı gibi donanım bağlantıları (bunlar şirket
içinden **talep** olarak gelir; sahibi karar verip kurar).
