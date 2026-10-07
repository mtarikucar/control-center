# Ofis ekonomisi: kabul belgesi (plan 50d3a716)

Durum: Geliştirildi. K1-K3 ile doğrulandı (R3, R4, R5, R7, R8). R1, R2 ve R6 yayın sonrası K4 bekliyor. Yayınlanmadı,
kabul edilmedi.
Kanıt seviyeleri: K1 birim/entegrasyon testi, K2 simülasyon, K3 gerçek claude ya da gerçek veri kopyası, K4 canlı veri.

Kaynak: koordinatörün masasındaki `economy-acceptance.md`. Bu dal kopyası günceldir. Değişikliklerin gerekçesi en altta.

## Gereksinimler

| No | Gereksinim | Geçti koşulu | Ölçüm yöntemi | Gereken kanıt | Şimdiki kanıt |
|----|------------|--------------|---------------|---------------|---------------|
| R1 | Koordinatör turu azalır | Aynı iş yükünde teslim başına koordinatör turu (sahibinin mesajları hariç) tabana göre ≥%60 az; son pencere ≥30 teslim | `economy-report`: "sahibinin mesajları hariç" satırı. Taban: anahtarlar kapalı dönem + yayın öncesi canlı veri | K4 | K2: 15→5 (sahibi hariç 14→4); K4 taban 1,25 (n=4) |
| R2 | Kota maliyeti azalır | Koordinatörün teslim başına GERÇEK USD'si ≥%50 az. Toplam USD/teslim ve token/teslim raporlanır, eşiği yok (iş türü baskın) | `economy-report`: koordinatör $/teslim, toplam $/teslim, token/teslim | K4 | K2 modelli: koordinatör −%92; K3: geçiş turu sıcak bir turun 2-4 katı (bir kez); K4 taban $1,83 (n=4) |
| R3 | Karar notu gecikmez, kaybolmaz | Alıcı turda değilken yazılan karar notu → tur p95 ≤ 2 dk. Uyanık ya da uyuyan alıcıda (pay dışında) 10 dk'dan eski bekleyen karar notu yok. Kayıp mesaj 0 | `economy-report`: "alıcı turda değilken" p95, bekleyen notlar, "Olaylar" | K1 + K4 | K1 ✓; K4 taban p95 0 dk (n=7) |
| R4 | Bilgi notu en geç sonraki uyanık özet saatinde gelir, kaybolmaz | Uyanık alıcıda bekleyen bilgi notu yaşı ≤ en uzun özet aralığı (9/17'de 16 saat) + 5 dk. Kayıp 0. Yeniden başlatmada çift özet ya da çift rapor hatırlatması yok. Uyuyan alıcı ve sahibinin payı istisna (tasarım gereği bekler) | `economy-report`: bekleyen bilgi notu ve en eski yaşı | K1 + K4 | K1 ✓ |
| R5 | Model geçişi güvenli | Geçişte mesaj kaybı 0. Geçiş sonrası geçmiş korunur (`--resume`). Görev ve tur ortasında geçiş yok. Hiçbir görev zorluğunun modelinden güçlü modelde koşmaz; istisna: geçiş başarısız olup eski modelle sürdüğünde ya da zorluk anahtarı kapalıyken | fake-claude argv; GERÇEK claude haiku → sonnet duman testi | K1 + K3 | K1-K2 ✓, K3 ✓ (2026-10-07) |
| R6 | İş kalitesi bozulmaz | Takılan görev oranı, kuyruğa dönen görev, plan süresi tabana göre kötüleşmez (±%10 gürültü payı; taban küçükse oran farkı ≤ 0,1) | `economy-report` "Kalite" satırı | K4 | K4 taban: takılan 0/5, kuyruğa dönen 0 (n=5) |
| R7 | Geri alınabilir | Üç özellik anayasadan tek tek kapatılabilir. DB göçü 6-7 canlı DB kopyasında denendi, yedekten dönüş denendi. Eski kod yeni şemada çalışır | test + canlı DB kopyası + `migration-rehearsal` | K1 + K3 | K1 ✓, K3 ✓ (canlı kopya 2026-10-07) |
| R8 | Güvenlik/kapsam | main'e dokunulmaz, çalışan ofis kendiliğinden yeniden başlamaz, ~/.control-center'a kod yazmaz | git, süreç kontrolü | K1 | ✓ |

## İzlenebilirlik matrisi

Testler `apps/office-server/test/` altında (web: `apps/office-web/src/ui/`). "BOŞ" satırlar yayın sonrası K4 ile kapanır.

| No | Kanıt (dosya › test) | Seviye | Durum |
|----|----------------------|--------|-------|
| R1 | `economy.scenario.test.ts` › a simulated day (koordinatör turu ≤ 5; main tabanı 15) | K2 | ✓ |
| R1 | `economy-report.test.ts` › counts turns, money, tokens… (ölçüm aracı, sahibi hariç metrik) | K1 | ✓ |
| R1 | Canlı pencere ≥30 teslim, anahtarlar açık ve kapalı | K4 | **BOŞ — yayın sonrası** |
| R2 | `economy.scenario.test.ts` › koordinatör modellenmiş maliyeti ≤ %30 × 225 | K2 | ✓ (18,2) |
| R2 | `model-switch.real.test.ts` › remembers across the switch… (tur başına gerçek USD ve önbellek) | K3 | ✓ (gözlem) |
| R2 | `model-switch.real.test.ts` › how long the prompt cache stays warm (6½ dk sonra hâlâ sıcak; `OFFICE_SMOKE_TTL=1`) | K3 | ✓ (gözlem; 5 dk varsayımı çürüdü) |
| R2 | Canlı koordinatör $/teslim, anahtarlar açık ve kapalı | K4 | **BOŞ — yayın sonrası** |
| R3 | `dispatcher.test.ts` › information alone opens no turn; a decision does… | K1 | ✓ |
| R3 | `dispatcher.test.ts` › information never wakes a sleeper…; a decision wakes anyone… | K1 | ✓ |
| R3 | `dispatcher.test.ts` › in the reserve a decision wakes only the coordinator… | K1 | ✓ |
| R3 | `dispatcher.test.ts` › a delivery lost because no session would start puts the task and its notices back… | K1 | ✓ |
| R3 | `economy-report.test.ts` › times notices from written to delivered… (alıcı turda değilken p95) | K1 | ✓ |
| R3 | Canlı karar gecikmesi p95 ve bekleyen notlar | K4 | **BOŞ — yayın sonrası** (taban p95 0 dk, n=7) |
| R4 | `dispatcher.test.ts` › information comes alone only at a digest hour it lived through…; an empty digest is skipped | K1 | ✓ |
| R4 | `dispatcher.test.ts` › the report reminder is not repeated for the same digest hour after a restart | K1 | ✓ |
| R4 | `dispatcher.test.ts` › in the owner's reserve information opens no turn… | K1 | ✓ |
| R4 | Canlı bekleyen bilgi notu yaşı | K4 | **BOŞ — yayın sonrası** |
| R5 | `model-policy.test.ts` (4 test: yükseltme hemen, düşürme TTL sonrası, aksi halde kal, görev başı) | K1 | ✓ |
| R5 | `engine-model.test.ts` › a stronger model at once…; never switches in the middle of a turn…; a stopped or sleeping session…; cannot start on the new model…; no session starts at all… | K1 | ✓ |
| R5 | `dispatcher.test.ts` › a task's model is for that task…; the coordinator's decisions go on its decision model… | K1 | ✓ |
| R5 | `economy.scenario.test.ts` › hiçbir görev zorluğunun üstünde koşmaz (11 görev turu) | K2 | ✓ |
| R5 | `model-switch.real.test.ts` › remembers across the switch; init and result name the new model | K3 | ✓ |
| R6 | `economy-report.test.ts` › takılan oranı, kuyruğa dönen, plan süresi | K1 | ✓ (araç) |
| R6 | Canlı kalite metrikleri | K4 | **BOŞ — yayın sonrası** (taban: takılan 0/5) |
| R7 | `dispatcher.test.ts` › R7: with the digest switched off…; R7: with difficulty models switched off… | K1 | ✓ |
| R7 | `engine-model.test.ts` › R7: with the model policy switched off… | K1 | ✓ |
| R7 | `budget.test.ts` › starts from the defaults… (anahtar doğrulama); `BudgetTabs.test.tsx` › saves the owner's limits… (kutucuklar) | K1 | ✓ |
| R7 | `db.test.ts` › v6…, v7… (yukarı/aşağı, eski satırlar) | K1 | ✓ |
| R7 | `scripts/migration-rehearsal.ts` canlı DB kopyasında: 5→7→5→7, satır sayıları aynı, 7 eski not `decision`, yedekten dönüş | K3 | ✓ (2026-10-07) |
| R7 | Main'in kodu 7 şemalı kopyada (dalın yazdığı veriyle): göç boş geçer, okuma/yazma hatasız | K3 | ✓ (2026-10-07) |
| R8 | `git log main` = e2889e8; ofis süreci 09:17'den beri aynı (pid 1080872); DB'ye yalnız `cp` ile dokunuldu, kopyalar /tmp'de, silindi | K1 | ✓ |

## Bilinen varsayımlar

- **Önbellek ömrü (cacheTtlMinutes = 5) — K3 ile çürütüldü.** Gerçek CLI'de önbellek 6½ dk sonra hâlâ sıcak; tam ömür
  ölçülmedi (muhtemelen 1 saat). Değer artık önbellek tahmini değil, sohbet ortasında modeli titretmemek için bir bekleme
  süresi. Düşürme, sıcak önbellekte bile kazandırıyor (fable → sonnet). Ayrıntı:
  [economy-cache-observation.md](economy-cache-observation.md).
- **Önbellek oturumlar arası paylaşılır (gözlem, K3).** Aynı modelde aynı ön ek (sistem istemi, araçlar) yeni bir oturumda
  da önbellekten okunuyor. Model değişince yalnız konuşmanın kendisi yeniden yazılıyor (haiku → sonnet'te ~18k token).
- **Gerçek CLI her turda `system init` gönderir.** Olay günlüğünden oturum (süreç) sayısı çıkarılamaz. Modelin turlara
  dağılımı çıkarılabilir; sahte claude init'i yalnız ilk turda gönderir.
- **USD abonelikte API eşdeğeridir** (CLI'nin `total_cost_usd`'si). Kotanın gerçek ölçüsü 5 saatlik ve 7 günlük kullanım
  yüzdesi. Sahibiyle ortak olduğu için teslim başına çıkarılamaz. USD vekil ölçü.
- **Modellenmiş maliyet ağırlıkları kaba** (fable 15, opus 5, sonnet 1, haiku 0,2); bağlam ve önbellek yok sayılıyor.
  Yalnız K2 için.
- **Sahte senaryo gerçek iş yükünü temsil etmeyebilir.** Canlı taban zaten farklı: koordinatör turunun yarısı sahibinin
  mesajı.
- **Özet saatleri sunucu yerel saatine bağlı** (makine +03, İstanbul).
- **Canlı taban az** (4 teslim). Anlamlı sonuç için pencere ≥30 teslim.

## Yayın planı

Adım adım komutlar: [economy-release-runbook.md](economy-release-runbook.md).

1. Öncesi: R3-R5, R7, R8 doğrulama sütunu doldu (K1-K3). Canlı DB yedeği alınır, göç provası yedekte koşar (runbook §2-3).
2. Yayın (sahibi yapar): main'e birleştir, üç anahtar KAPALI başlat (runbook §5). Kapalı dönem anahtarlı kodla taban
   penceresidir (≥1 gün, ≥10 teslim). Sonra sırayla aç: özet, model politikası, zorluk. Her adım ≥1 gün ve ≥10 teslim.
3. İzleme: `economy-report` günlük (runbook §8); R1-R6 metrikleri.
4. Geri alma tetikleyicileri: alıcı turda değilken karar notu gecikmesi p95 > 5 dk; kayıp mesaj ≥1; günde ≥3 başarısız
   model geçişi; takılan görev oranı tabanın %25 üstü (taban küçükse oran > 0,25); koordinatör turu azalmıyor (R1
   penceresinde tabanın %80'i üstü); uyanık alıcıda bilgi notu yaşı > özet aralığı + 5 dk. Sırasıyla: ilgili anahtarı
   kapat; olmazsa önceki koda dön (DB 7'de kalabilir); yalnız veri bozulduysa DB yedeğine dön (runbook §9-10).
5. Kabul: pencere bitince R1-R8 K4 ile değerlendirilir, sahibi onaylar; retrospektif yazılır.

## Riskler (RAID, kısa)

- **Risk (azaldı): göç 6-7 geri dönüşsüz.** Aşağı göç var ve canlı kopyada denendi. Eski kod yeni şemada çalışıyor; kod
  geri alınırken DB'ye dokunmak gerekmiyor. Yedek yine şart (veri bozulmasına karşı).
- **Risk: Sonnet/Haiku koordinatörün karar kalitesi düşebilir.** R6 ölçer; `modelPolicyEnabled` ya da
  `coordinatorModels` ile geri alınır.
- **Risk (yeni): model geçişi soğuk başlangıçtır.** K3'te geçiş turu sonraki turun ~4 katı tuttu. Çok geçiş, kazancı
  yiyebilir. R2'nin K4 ölçümü (gerçek USD) bunu içerir; görmek için `Modeller (tur)` satırına bak.
- **Risk (yeni): zorluk verilmeyen görevler** çalışanın kendi modelinde koşar (kazanç yok). Koordinatöre zorluk vermesi
  söylenmeli; araç açıklaması söylüyor.
- Varsayım: önbellek TTL (yukarıda). Sorun: yok. Karar: bb47cf41.

## Değişiklikler (Deniz, 2026-10-07) ve gerekçeleri

1. **R1 tabanı ve ölçüsü.** "Taban 1,4" simülasyondan geliyordu. Canlı veride koordinatör turunun yarısı sahibinin
   mesajı (9 turun 4'ü). Plan bunları azaltmaz, azaltmamalı da. Ölçü "sahibinin mesajları hariç" oldu; taban canlı
   veriden ve anahtarlar kapalı dönemden alınır (aynı kod, aynı iş yükü). Hedef oransal kaldı (≥%60).
2. **R2 ana metriği.** Teslim başına toplam USD'yi iş türü belirliyor (canlı tabanda opus geliştirme turları toplamın
   %73'ü). Plan koordinatörü hedefliyor: eşik koordinatörün USD/teslim'i, toplam raporlanır.
3. **R3 koşulu.** Dağıtıcı turu asla kesmez: turda olan alıcıya yazılan not tur bitene dek bekler (tasarım). Ölçü "alıcı
   turda değilken" oldu; araç ikisini de veriyor. "Teslim edilmemiş karar notu 0" her an ihlal edilir (çalışan biri
   her zaman vardır). "Boştaki alıcıda 10 dk'dan eski karar notu yok, kayıp 0" oldu. Payda üyelere giden karar notu
   tasarım gereği bekler.
4. **R4 koşulu.** Bilgi notu uyuyanı uyandırmaz (tasarım). Uyuyan alıcıda sınır yoktur, ilk turunda alır. "Özet aralığı"
   9/17 için en uzun 16 saat. Çift rapor hatırlatması da koşula eklendi (artık günlükte tutuluyor).
5. **R5 istisnası.** Geçiş başarısız olursa oturum eski modelle sürer; mesaj kaybolmasın diye bilinçli. Zorluk anahtarı
   kapalıyken görev kendi modelinde koşar. İkisi de "zorluğun üstünde" sayılmaz.
6. **R7'ye "eski kod yeni şemada çalışır" eklendi.** Geri dönüşün en ucuz yolu bu; denendi.
7. **Varsayımlara üç K3 gözlemi eklendi:** önbellek oturumlar arası paylaşılır; CLI her turda init gönderir; önbellek
   5 dk'dan uzun yaşar (cacheTtlMinutes'ın gerekçesi değişti, değeri değil).
8. **Yayın planına "anahtarlar kapalı başlangıç = taban penceresi" eklendi.** Önce/sonra aynı kodla ve aynı dönemin iş
   yüküyle karşılaştırılır.
