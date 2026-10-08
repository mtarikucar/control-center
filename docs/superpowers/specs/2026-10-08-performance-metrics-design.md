# control-center — Performans metrikleri (B4) tasarım notu

- Tarih: 2026-10-08 · Yazan: Mert · Görev: 02594425 (plan "Çekirdek 1", B4) · İnceleyen: Kerem
- Dayandığı: `bosluk-analizi.md` §2 B4 satırı ve §3 "B4 — Performans metrikleri toplanmıyor"; `hedef-mimari.md` §4 E1
  (`performanceRead(employee|role|plan, since)`, ilk turda onay oranı, onaya kadar ortalama tur, ortalama maliyet ve
  süre, takılma/park/gecikme sayıları, her sayının yanında kanıt seviyesi).
- Dal `feat/performance-metrics`, **`fix/task-turn-cost` (355837f) üstünde** — bkz. §2.

## 1. Kapsam

Yeni veri yok, yeni tablo yok: metrikler `events` ve `tasks`'tan **okunurken** türetilir. Eklenenler: okuma katmanı
(`src/performance.ts`), MCP aracı `performanceRead` (koordinatör ve ekip liderleri), API `GET /api/performance`,
canlı DB kopyasında çalıştırmak için salt okunur betik `scripts/performance-report.ts`.

Kapsam dışı: rol başına gruplama (rol bugün serbest metin; B6 rol şablonlarıyla gelir), çalışan dosyasında metrik
bloğu ve web sekmesi (E1'in görünüm kısmı; ayrı iş), rubrik puanları (E2/B17).

## 2. Maliyet kuralı ve `fix/task-turn-cost` bağımlılığı

- Görev başı maliyet **`tasks.cost_usd` sütunundan okunmaz.** Canlıda bu sütun her görevde 0 (görev 65eb1e68). Düzeltme
  `fix/task-turn-cost` dalında, birleştirme ve geri doldurma sahibinde.
- Bunun yerine olay kaydı, o daldaki kuralla (`apps/office-server/src/company/budget.ts` `TurnLedger`) yeniden
  oynatılır: `turn.started`, `task.changed`, `turn.finished` sırayla. Turun sonucu, turun başında süren göreve yazılır;
  yoksa tur içinde teslim edilen göreve, o da yoksa sonuç anında süren göreve. Hiçbiri yoksa sonuç görevsiz sayılır.
  Oynatma kodu tek yerde (`src/turn-log.ts` `replayTurns`); geri doldurma betiği (`task-cost-backfill.ts`) ve bu
  katman onu ortak kullanır.
- Sonuç: metrikler bugün canlı DB'de doğru. Düzeltme birleşip geri doldurma uygulanınca `tasks.cost_usd` aynı sayıları
  taşır (geri doldurma testi bunu sınıyor; bu katmanın testi de bütçenin canlı yazdığıyla karşılaştırır).
- Bu yüzden dal `fix/task-turn-cost` üstünde: `TurnLedger` ve `turnTokens` o dalda. Sahibi o dalı birleştirmeden bu
  dal birleştirilemez (önce o).

## 3. Metrikler ve kaynakları

Kısaltmalar: **E** = `events` tablosu, **T** = `tasks` tablosu. Görev türleri: `work` (iş), `review` (inceleme),
`handover` (devir).

### 3.1 Görev başına

| Metrik | Tanım | Kaynak |
|---|---|---|
| `usd`, `tokens` | Göreve yazılan tur sonuçlarının toplamı | E `turn.finished.costUsd`, `usage` (4 token türü); görev §2 kuralıyla |
| `turns` | Göreve yazılan tur sonucu sayısı | E `turn.finished` |
| `rounds` | İncelemeye teslim sayısı | T `round` |
| `approvals`, `changes` | İnceleme kararları | T inceleme görevleri (`kind='review'`, `review_of`), `result.review.decision` |
| `firstPass` | İlk karar `approve` mı (incelenmediyse yok) | aynı, `created_at` sırasıyla ilk karar |
| `leadHours` | Açılıştan bitişe (bitenler) | T `finished_at − created_at` |
| `workHours` | İlk başlamadan bitişe (bitenler) | E ilk `task.changed` `started` zamanı → T `finished_at`. T `started_at` kullanılmaz: geri gönderilince (`changes`) ve geri konunca sıfırlanır |
| `parks` | Park sayısı | T `park_count` |
| `blocks` | `blocked` durumuna geçiş sayısı | E `task.changed`, görevin önceki durumu `blocked` değilken `blocked` |
| `overdue` | Süresi geçti | T `overdue_notified = 1`, ya da `finished_at > due_at`, ya da açıkken `due_at` geçmiş (ofis saatinin bir sonraki turundan önce de) |

### 3.2 Çalışan ve plan başına

Grubun görevleri: çalışan için **atanan** (`T.assignee`), plan için `T.plan_id`; yalnız `work` görevleri. Pencere
(`days`) verilirse "bitti" sayılanlar `finished_at` pencere içinde olanlar, maliyet ve tur da pencere içindeki tur
sonuçlarıdır. Pencere verilmezse tüm zamanlar.

| Metrik | Tanım |
|---|---|
| `done`, `open` | Pencerede biten iş görevi sayısı; şu an açık olan (bekliyor, sürüyor, incelemede, takıldı, ertelendi) |
| `usd`, `tokens`, `turns` | Çalışan: kendi bütün tur sonuçları (E `turn.finished.employee_id`), görevli ya da görevsiz. Plan: plana ait görevlere yazılan tur sonuçları |
| `unassignedUsd` | Çalışan: hiçbir göreve yazılmayan tur sonuçlarının maliyeti (ör. sahibiyle sohbet) |
| `usdPerDone` | Biten iş görevlerinin (tüm turlarıyla) ortalama maliyeti |
| `reviewed`, `firstPassRate` | Biten ve incelenmiş iş görevi sayısı; bunların ilk kararla onaylananlarının oranı |
| `avgRounds` | Biten ve incelenmiş iş görevlerinde ortalama `rounds` (onaya kadar tur) |
| `avgLeadHours`, `avgWorkHours` | Biten iş görevlerinde ortalama |
| `parks`, `blocks`, `overdue` | Grubun pencerede biten ve şu an açık iş görevleri üzerinden toplam |
| `reviewsGiven` | Yalnız çalışan: pencerede karara bağladığı inceleme görevi sayısı |

### 3.3 Toplam ve uzlaşma

`total` = pencere içindeki bütün `turn.finished` sonuçları (sayı, USD, token). Rapor uzlaşmayı kendisi gösterir:
`total.usd = Σ çalışan usd = görevlere yazılan + görevsiz`. Her sayının kanıt seviyesi, verinin geldiği yerdir: ofisin
kendi DB'sinde **K4** (canlı veri), testlerde K1.

## 4. Okuma yüzeyleri

```
performanceRead(employee?: id|ad, plan?: id, days?: number)     kim: koordinatör, ekip liderleri
GET /api/performance?days=N                                     JSON (PerformanceReport, bütün gruplar)
node apps/office-server/scripts/performance-report.ts [--db <dosya>] [--days N] [--employee id] [--plan id] [--json]   salt okunur
```

- Bağımsız: toplam ve uzlaşma satırı, her çalışan için bir satır, her plan için bir satır.
- `employee` ile: o çalışanın satırı ve görevleri (yeniden eskiye, en fazla 20). `plan` ile: planın satırı ve görevleri.

## 5. Sınırlar

- Oynatma her okumada olay kaydının tur ve görev olaylarını baştan okur (bugün ~1.700 olay; doğrusal). Kayıt
  büyüyünce `tasks.cost_usd` (düzeltme canlıdayken) ya da önbellek kullanılabilir; bugün gerek yok.
- `blocks` dispatcher'ın sessiz geri koymasını (`#putBack`, olaysız) görmez; bu takılma değildir.
- Ortalamalar küçük örneklerde oynaktır; her satır `n`'yi (biten/incelenen sayısı) yanında yazar.

## 6. Doğrulama

- Birim (K1): sabit saatli bir ofis günü (iki inceleme turlu görev, ilk geçişte onaylanan, takılıp açılan, park edilip
  süresi geçen, açık kalan, görevsiz tur). Her metrik elle hesaplanan değere eşit; görev başı maliyet, bütçenin canlı
  yazdığı `tasks.cost_usd` ile aynı; pencere; araç ve API çıktısı.
- Mutasyon kontrolü: metrik formüllerinin her biri tek tek bozulur, testler yakalar.
- K4 (kopya): canlı DB'nin salt okunur `VACUUM INTO` kopyasında betik çalışır; toplam, doğrudan SQL ile toplanan
  `turn.finished` toplamına eşit.
