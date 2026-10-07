# control-center — Hedef KPI tanımı (B16) tasarım notu

- Tarih: 2026-10-08 · Yazan: Mert · Görev: 576dbb09 (plan "Çekirdek 1", B16) · İnceleyen: Kerem
- Dayandığı: `bosluk-analizi.md` §2 B16 satırı, §2 yerleştirme notu (B16/B26 bölünmesi) ve §3 "B16 — Hedef KPI tanımı
  yok"; `hedef-mimari.md` §4 E3 (`goals.kpis[] {name, target, unit, source: capability|manual, cadence}`), §6;
  `pilot-senaryosu.md` A10 ve KÖ11 (H1 "zamanında hazır oranı ≥ %90", H2 "gecikme gün = 0", ürün "onay oranı ≥ %70").
- Dal `feat/goal-kpis`, **`feat/performance-metrics` (0e6dbf9) üstünde** (B4 bağımlılığı, §3). Göç v12 (§5).

## 1. Kapsam

KPI **tanımı**: hedefe ölçülebilir KPI listesi (`goals.kpis`), `goalSet`'e `kpis`, `goalsRead`'de ve web Hedefler
sekmesinde görünüm. **Kapsam dışı (B26):** ölçüm, okumalar (`kpi_readings`, `kpiRecord`), ölçüm rutini, retro KPI
tablosu. Davranış değişmez: KPI'sız hedefler aynen çalışır, eski hedefler boş listeyle gelir.

## 2. Şema

`goals` tablosuna bir JSON sütun: `kpis TEXT NOT NULL DEFAULT '[]'`. Göç öncesi hedefler `[]` alır.

```ts
interface Kpi {
  name: string;                         // ≤ 120, hedefte tekil (büyük/küçük harf ve Türkçe i farkı gözetmez)
  target: number;                       // sonlu sayı; birim % ise 0–100
  direction: 'atLeast' | 'atMost';      // ≥ ya da ≤ (E3'te yok; "hedef ≥ %90" ile "gecikme ≤ 0" ayrımı için gerekli)
  unit: string;                         // ≤ 20 (%, gün, sipariş, USD …); office kaynağında metrikten gelir
  source: 'manual' | 'office' | 'capability';
  metric: string | null;                // yalnız source 'office': B4 metriği (§3)
  cadence: 'daily' | 'weekly' | 'monthly';
}
```

- `manual`: sayıyı koordinatör ya da sahibi okur (B26'da `kpiRecord`). `capability`: bir bağlantının yeteneğinden
  okunur (B3/B7 sonrası). `office`: ofisin kendi performans metriğinden (B4) okunur.
- Bir hedefte en fazla 8 KPI. Bilinmeyen alan, eksik zorunlu alan, yanlış tür/değer reddedilir; hiçbir alanın
  sessiz varsayılanı yok (B2 incelemesinden ders: varsayılan, kaynağı ya da yönü yanlış kaydedebilir).

## 3. B4 bağımlılığı: `source: 'office'`

`metric`, performans raporunun (B4, `apps/office-server/src/performance.ts` `GroupMetrics`) grup metriklerinden
biridir; birimi metrikten gelir (verilen birim farklıysa ret):

| metric | etiket | birim |
|---|---|---|
| `firstPassRate` | ilk geçişte onay oranı | % (rapordaki 0–1 oran ×100) |
| `avgRounds` | onaya kadar ortalama tur | tur |
| `usdPerDone` | görev başı ortalama maliyet | USD |
| `avgLeadHours` | ortalama süre (açılıştan bitişe) | saat |
| `avgWorkHours` | ortalama iş süresi | saat |
| `done` | biten iş | adet |
| `blocks`, `parks`, `overdue` | takılma, park, gecikme | adet |

Listenin `GroupMetrics` anahtarlarıyla eşleştiği derleme zamanında denetlenir. Ölçüm kapsamı (hedefin planlarının iş
görevleri, sıklık penceresi) B26'nın işi; burada yalnız tanım.

## 4. Araçlar ve görünüm

```
goalSet(goalId?, title?, why?, done?, status?, note?, kpis?: Kpi[])   kim: koordinatör
goalsRead()                                                          kim: koordinatör, ekip liderleri
```

- `kpis` verilirse hedefin KPI listesini **tümüyle değiştirir** (`done` gibi); `[]` siler; verilmezse dokunulmaz.
- `goalsRead`: KPI'sı olan hedefte `bitti` satırından sonra bir satır:
  `KPI: Zamanında hazır oranı ≥ %90 (elle, haftalık); Onay oranı ≥ %70 (ofis: ilk geçişte onay oranı, haftalık)`.
  KPI'sız hedefin çıktısı öncekiyle **birebir aynı** (test).
- Web Hedefler sekmesi: KPI'sı olan kartta "KPI'lar" listesi, aynı metinle (`kpiText`, `packages/shared`).

## 5. Göç numarası ve birleştirme sırası

- Bu dal v12 kullanıyor. **`feat/company-profile` (B2) da v12 kullanıyor.** İkisi `MIGRATIONS` dizisinin aynı yerine
  eklediği için birleştirmede git çakışma verir; ikinci birleştirilen göç **v13** olmalı (sürüm, `db.test.ts`
  beklentileri).
- Neden v13 seçilmedi: göç çalıştırıcısı yalnız "uygulanan en büyük sürümden büyük" göçleri çalıştırır
  (`db.ts` `migrateUp`). Bu dal v13 ile B2'den önce canlıya girerse, sonra gelen v12 sessizce atlanırdı. Çakışma
  sessiz atlamadan iyidir.
- Yeni test: `MIGRATIONS` sürümleri 1'den başlayıp boşluksuz ve tekrarsız artar. Çakışma yanlış çözülürse (iki v12 ya
  da atlanan numara) bu test kırmızı olur.
- Birleştirme sırası: `fix/task-turn-cost` → `feat/performance-metrics` → bu dal; `feat/company-profile` önce ya da
  sonra, ama ikincisi v13'e geçerek.

## 6. Doğrulama

- Birim (K1): göç v12 (eski hedef `[]` alır, down geri yükler, sürüm dizisi boşluksuz); `goalSet` KPI ekler,
  değiştirir, siler, verilmezse korur; doğrulama hataları; office kaynağı birimi metrikten alır; `goalsRead` satırı;
  KPI'sız hedefin `goalsRead` çıktısı öncekiyle aynı; web kartı.
- Mutasyon kontrolü: her doğrulama kuralı, değiştir/koru ayrımı, birim türetme, görünüm.
