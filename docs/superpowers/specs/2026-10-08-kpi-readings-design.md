# control-center: KPI ölçümü ve okumalar (B26) tasarım notu

- Tarih: 2026-10-08 · Yazan: Elif · Görev: 03812212 (plan "Çekirdek 4: KPI ölçümü (B26) ve P1 hazırlığı") · İnceleyen: Kerem
- Dayandığı:
  - `bosluk-analizi.md` §2 B26 satırı ve §3 "B26: KPI ölçüm rutini ve okumalar yok" (`kpi_readings`, `kpiRecord`,
    retro'da KPI tablosu; manuel kaynakla başlar, otomatik okuma B3/B14 sonrası)
  - `hedef-mimari.md` §4 E3 (ölçüm yarısı)
  - B16 tasarımı `2026-10-08-goal-kpis-design.md` (§3 ölçüm kapsamını B26'ya bırakıyor)
  - B4 tasarımı `2026-10-08-performance-metrics-design.md` §3.2
- Dal `feat/kpi-readings`, **main'den** (faf89ad). B16 (`goals.kpis`, v12) ve B4 (`performanceReport`) main'de.

## 1. Kapsam

KPI **ölçümü**:
- okumaların saklanması (`kpi_readings`)
- elle okuma aracı `kpiRecord`
- ölçüm rutini: ofis kaynaklı KPI'ları kendisi okur, elle okunacakları koordinatöre hatırlatır
- `planRetro` çıktısında KPI tablosu
- `goalsRead`'de son okuma satırı

**Kapsam dışı:**
- `capability` kaynağının otomatik okunması (B3/B14 sonrası). O zamana kadar bu KPI'lar `kpiRecord` ile elle girilir.
- Web Hedefler sekmesinde okuma geçmişi ve grafik (ayrı iş).
- Okumaların API'de gösterilmesi.

Davranış değişmez:
- KPI'sız hedef, okuması olmayan KPI ve hedefi ya da KPI'sı olmayan planın retrosu öncekiyle **birebir aynı** çıktıyı verir (testli).
- B16'nın KPI tanımı ve `goalSet` kuralları dokunulmadan kalır.

## 2. Şema: `kpi_readings`

```sql
CREATE TABLE kpi_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id TEXT NOT NULL,        -- goals.id
  kpi TEXT NOT NULL,            -- KPI'nın adı, okunduğu andaki haliyle
  value REAL,                   -- NULL: ofis metriğinin penceresinde verisi yok
  unit TEXT NOT NULL,           -- okunduğu andaki birim, hedef ve yön (geçmiş, hedef sonradan değişse de okunabilsin)
  target REAL NOT NULL,
  direction TEXT NOT NULL,
  source TEXT NOT NULL,         -- manual | capability | office
  period_start INTEGER,         -- ofis okuması: pencerenin başı; elle okuma: NULL
  recorded_at INTEGER NOT NULL, -- okuma anı (ofis okumasında pencerenin sonu)
  recorded_by TEXT NOT NULL,    -- koordinatörün id'si ya da 'office'
  note TEXT
);
CREATE INDEX kpi_readings_goal ON kpi_readings (goal_id, recorded_at);
```

- **Kimlik:** bir KPI'yı hedef ve ad birlikte tanımlar; ad karşılaştırması B16'daki gibi büyük/küçük harf ve Türkçe i
  farkını gözetmez (`fold`, JS tarafında). `goalSet` ile adı değişen KPI'nın eski okumaları tabloda kalır ama yeni adın
  altında görünmez.
- **Durum** ("tuttu / tutmadı") saklanmaz; okunurken KPI'nın **bugünkü** hedefi ve yönüyle hesaplanır. Retro tablosu
  bugünkü hedefi gösterir. Okumadaki hedef/yön kopyası geçmişi okumak için tutulur.

## 3. `kpiRecord`

```
kpiRecord(goalId: string, kpi: string, value: number, note?: string)   kim: koordinatör
```

Kurallar (her biri Türkçe gerekçeyle reddeder, hiçbir şey yazmaz):
- hedef var ve `active` olmalı
- `kpi` hedefin KPI'larından birinin adı olmalı; bilinmiyorsa hedefin KPI adları listelenir
- `office` kaynaklı KPI elle yazılmaz: ofis onu kendi metriğinden okur
- `value` sonlu bir sayı olmalı; birim % ise 0–100
- `note` en fazla 500 karakter

Kaydedilen okuma: KPI'nın `source`'u (`manual` ya da `capability`), `period_start` NULL, `recorded_by` koordinatör.
Cevap: `“Zamanında hazır oranı” okuması kaydedildi: %92; hedef ≥ %90: tuttu.`

## 4. Ofis kaynaklı okuma

- **Değer:** KPI'nın B4 metriği (`metric`); kapsam **hedefin planlarının iş görevleri** (`plans.goal_id`), pencere
  KPI'nın sıklığı kadar geriye: günlük 1 gün, haftalık 7 gün, aylık 30 gün. Hesap B4'ün grup kuralıyla aynı;
  `performanceReport`'a isteğe bağlı bir `goals` kapsamı eklenir ("bitti" pencerede bitenler, açıklar şu an açık olanlar).
  B4'ün bugünkü çıktısı bu seçenek verilmezse değişmez.
- `firstPassRate` raporda 0–1 oranı; KPI birimi % olduğu için ×100.
- **Veri yoksa** (ör. pencerede incelenmiş iş yok, oran null) okuma `value` NULL ile yazılır: "veri yok". Böylece aynı
  pencere her dakika yeniden denenmez.

## 5. Ölçüm rutini

`KpiReadings.measure(now)` dağıtıcının tik'inde (dakikada bir) çalışır, nabızla aynı yerde. Hata ofisi durdurmaz.
- **Zamanı geldi mi:** her aktif hedefin her KPI'sı için son okuma, yoksa hedefin açılış anı + sıklık süresi ≤ şimdi.
- **Ofis KPI'sı:** zamanı gelince okunur ve yazılır (`recorded_by: 'office'`).
- **Elle okunan KPI** (`manual`, `capability`): zamanı gelince koordinatöre `kpi.due` notu (karar) düşer. Not,
  o tikte zamanı gelen bütün KPI'ları tek notta sayar.
  - Aynı KPI için dönem başına en fazla bir not gider. İşaret `company_state` tablosunda
    `kpi.due.<goalId>.<ad>` anahtarıyla tutulur (son not anı), yeniden başlatmada kaybolmaz; nabzın deseniyle aynı.
  - Koordinatör yoksa not gitmez (ofis okumaları yine yazılır).

## 6. Retro'da KPI tablosu

`planRetro` (Company.retro): planın hedefi varsa ve hedefin KPI'sı varsa:
1. Ofis KPI'ları o anda okunup yazılır.
2. Retro notuna `## KPI'lar` bölümü eklenir; aracın cevabında da aynı tablo görünür:

```
| KPI | Hedef | Son okuma | Önceki | Durum |
|---|---|---|---|---|
| Zamanında hazır oranı | ≥ %90 | %92 (2026-10-08 14:00) | %85 (2026-10-01 09:00) | tuttu |
| Onay oranı | ≥ %70 | %66.7 (2026-10-08 14:05, ofis) | — | tutmadı |
| Rapor gecikmesi | ≤ 0 gün | okuma yok | — | kpiRecord ile yaz |
```

Planın hedefi yoksa ya da hedefin KPI'sı yoksa retro notu ve cevap öncekiyle aynıdır.

`goalsRead`: okuması olan KPI'lar için KPI satırının altına bir satır eklenir:
`son okuma: Zamanında hazır oranı %92 (2026-10-08 14:00, tuttu); Onay oranı veri yok (2026-10-08 14:05)`.
Hiç okuması olmayan hedefin çıktısı öncekiyle aynıdır.

## 7. Göç numarası ve birleştirme sırası (koordinatör kararı, 2026-10-08)

- Görev v19 diyordu; v16–v18 core-3'e ayrılmış durumda:
  - `feat/role-templates` v16
  - `feat/capability-model` v17
  - `feat/blueprint` v18 (henüz yalnız tasarım notu)
- main v15'te. `db.test.ts` "göçler 1, 2, 3 … boşluksuz ve tekrarsız" testi, main'den açılan dalda v19 olursa kırmızı olur.
  Koordinatör seçenek (a)'yı onayladı:
  - **Bu dalda göç v16.** Boşluk testi yeşil kalır.
  - **B26 yalnızca core-3'ten (v16–v18) sonra birleştirilir ve birleştirmede v19'a çekilir.** İki dal `MIGRATIONS`
    dizisine ve `db.test.ts`'teki tablo listelerine aynı yerden eklediği için git çakışması beklenir. Çakışma
    sessizce geçilmez: numara v19 yapılır, boşluk testi yeşil dönmeden iş bitmiş sayılmaz.
- **Uyarı:** B26 core-3'ten önce ya da tek başına birleştirilirse göç v16 core-3'ün v16'sıyla çakışır. Bu haliyle
  canlıya girerse göç çalıştırıcısı yalnız "uygulanan en büyükten büyük" göçleri çalıştırdığı için
  (`db.ts` `migrateUp`) core-3'ün v16'sı sessizce atlanır. Bu yüzden B26 core-3'ten önce canlıya alınmaz.
- Geri alma: v16 (birleştirmede v19) down `DROP TABLE kpi_readings`; hedefler ve KPI tanımları etkilenmez.

## 8. Doğrulama

- **Birim (K1):**
  - göç: boş tablo, down v15'i birebir geri yükler, hedefler kalır
  - `kpiRecord`: kayıt, her ret kuralı, cevap metni
  - ofis okuması: değer, ×100, veri yok, kapsam ve pencere
  - rutin: zamanı gelmeden okumaz; ofis KPI'sını okur; elle okunacak KPI için tek not, dönemde bir; koordinatörsüz
  - retro tablosu ve hedefsiz/KPI'sız retronun aynı kalması
  - `goalsRead` son okuma satırı ve okumasız çıktının aynı kalması
  - B16 testleri değişmeden geçer
- **Mutasyon kontrolü:** her ret kuralı, zamanı gelme kuralı, dönem başına tek not, ofis değeri dönüşümü, tablo
  durumu, "değişmeden" yolları.
- **Gerçek claude testi yok** (K3 gerekmedi). Canlı DB'ye dokunulmaz; canlı DB kopyasında göç denemesi birleştirme
  provasında yapılır (core-3 ile birlikte).
