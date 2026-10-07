# control-center — Yapısal şirket profili (B2) tasarım notu

- Tarih: 2026-10-08 · Yazan: Mert · Görev: 30953c2f (plan "Çekirdek 1", B2) · İnceleyen: Kerem
- Sürüm 2 (inceleme turu 1, Kerem): varsayım bölüm düzeyinden **alan düzeyine** indi, `assumed` zorunlu oldu (§3, §5, §8).
- Dayandığı: `company/archive/kesif-firma-isini-soyler-ofis-kurar-urun/…11f1e11c…/bosluk-analizi.md` §2 B2 satırı ve
  §3 "B2 — Yapısal şirket profili yok"; `…c4e24d8f…/hedef-mimari.md` §4 A (A1 diyalog, A2 profil şeması), §5 veri akışı,
  §6 veri modeli. Göç v12. Dal `feat/company-profile` (main `840e9d8`'den).

## 1. Boşluk ve hedef (bosluk-analizi §3 B2)

- **Bugün:** şirket özeti tek serbest metin, ≤ 8000 karakter (`company.ts` `BRIEF_MAX`, `updateBrief`), her masaya dosya
  olarak kopyalanır (`brief.ts` `writeBrief`). Profil tablosu yok (göç v1–v11).
- **Hedef (B2):** `company_profile(section, json, version, assumed)` + iki araç (`profileRead`, `profileUpdate`) + test.
  Desen `goal-store.ts` (göç + depo + Company yöntemi + MCP aracı + olay).
- **Neden:** blueprint (B5), rol şablonları (B6), el kitabı tohumlama (B13) ve KPI'lar (B16) profili *sorgular*;
  serbest metinden sorgulanmaz.

## 2. Kapsam

Bu iş yalnız **veri ve araç katmanını** ekler. Aşağıdakiler **değişmez** (testle bağlanır):

- Şirket özeti: `briefRead`/`briefUpdate`, `company/brief.md` ve masalardaki `company-brief.md` kopyaları. Profil
  güncellemesi özete dokunmaz, `brief.updated` olayı üretmez.
- Plan kartları: `planPropose`/`planRevise`/onay akışı ve `Plan` alanları. Profil plana alan eklemez.
- Çalışan davranışı: rehber metinleri (`craft/*.md`) değişmez (bosluk-analizi §1 P0 kuralı: "çalışan davranışını
  değiştirmez"). Koordinatöre profili ne zaman dolduracağını söyleyen onboarding soru seti B1'in işidir.

Kapsam dışı (sonraki işler): özetin profilden **türetilmesi** (hedef mimari §3, A3; B1/B5 kararı, çünkü özet her
masaya kopyalanır ve çalışan bağlamını değiştirir), web sekmesi ve sahibi API'si (B1), zorunlu bölüm denetimi (B1/A1).

## 3. Şema

Hedef mimari §6 satırı + bir sütun: `company_profile(id, version, section, json, assumed, assumed_fields, by, ts)`.

```sql
CREATE TABLE company_profile (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL UNIQUE,   -- şirket çapında artan sürüm: 1, 2, 3 … (bölüm başına değil)
  section TEXT NOT NULL,             -- aşağıdaki yedi bölümden biri
  json TEXT NOT NULL,                -- bölümün bu sürümdeki TAM hali (alan → metin | metin listesi)
  assumed INTEGER NOT NULL,          -- 1: bölümün en az bir alanı varsayım (assumed_fields boş değil)
  assumed_fields TEXT NOT NULL DEFAULT '[]',  -- varsayım olan alanların listesi (JSON), bölümün alan sırasıyla
  by TEXT NOT NULL,                  -- yazan çalışan id
  ts INTEGER NOT NULL
);
CREATE INDEX company_profile_section ON company_profile (section, version);
```

- **Yalnız ekleme:** her değişiklik yeni bir satırdır; bir bölümün güncel hali en büyük sürümlü satırıdır. Tablo aynı
  zamanda değişiklik geçmişidir (kim, ne zaman, ne, varsayım mı).
- **Neden ek sütun:** onboarding bir bölümü karışık kaynakla doldurur (bir alan sahibinden, öteki tahmin). Bayrak
  bölüm düzeyinde olunca sahibinden gelen tek bir alan, bölümdeki tahminleri de "doğrulanmış" gösteriyordu
  (Kerem, inceleme turu 1). `json` düz alan haritası olarak kalır (`json_extract(json, '$.sector')` ile sorgulanır);
  hangi alanın varsayım olduğu ayrı sütunda tutulur, `assumed` "herhangi biri" özetidir.
- **Profil sürümü** = `MAX(version)`. Blueprint (B5, hedef mimari §6 `blueprints.profile_version`) hangi profilden
  üretildiğini bu sayıyla tutar; bu yüzden sürüm bölüm başına değil şirket çapındadır.

## 4. Bölümler ve alanlar (hedef mimari A2)

Anahtarlar kodda İngilizce, etiketler Türkçe (`packages/shared/src/profile.ts` `PROFILE_FIELDS`). Değer türü:
*metin* (≤ 1000 karakter) ya da *liste* (≤ 20 madde, madde ≤ 300 karakter). Her bölümde ayrıca `notes` (metin).

| Bölüm (`section`) | Etiket | Alanlar |
|---|---|---|
| `identity` | Kimlik | `name` ad · `sector` sektör · `summary` ne yapıyor (firmanın kendi cümlesi) · `country` ülke · `languages` diller (liste) |
| `offer` | Teklif | `products` ürün ve hizmetler (liste) · `pricing` fiyatlandırma |
| `customers` | Müşteri ve kanallar | `segments` müşteriler (liste) · `channels` nereden gelir (liste) · `platforms` platformlar (liste) |
| `tools` | Araçlar ve hesaplar | `email` · `social` · `payment` · `accounting` · `ecommerce` · `other` (hepsi liste) |
| `constraints` | Kısıtlar | `budget` bütçe · `legal` yasal (liste) · `brandVoice` marka dili · `timezone` saat dilimi · `other` (liste) |
| `goals` | Hedefler ve KPI'lar | `goals` hedefler (liste) · `kpis` ölçü ve hedef değer (liste, ör. "aylık 20 sipariş") |
| `success` | Başarı tanımı | `done` firma için "bitti" (liste) |

Bilinmeyen bölüm ya da alan, yanlış tür, sınır aşımı reddedilir; hata mesajı o bölümün alanlarını sayar. Böylece
profil sorgulanabilir kalır (B5/B6 kodu `fields.sector` gibi bilinen anahtarları okur).

## 5. Araçlar (MCP)

```
profileRead(section?: Section, history?: boolean)          kim: herkes
profileUpdate(section: Section, fields: object, assumed: boolean)   kim: koordinatör
```

- **profileRead** — bölüm vermeden: profilin tamamı (sürüm, her bölüm etiketiyle, dolu alanlar; varsayım olan her
  alanın yanında "(varsayım)", böyle bir alanı olan bölümün başlığında "(varsayım var)"; boş bölümler "boş" diye;
  koordinatör neyin eksik ve neyin doğrulanmamış olduğunu görür). `section` ile yalnız o bölüm;
  `history: true` ile o bölümün sürümleri, yeniden eskiye (en fazla 20).
- **profileUpdate** — verilen alanları bölümün güncel haline **birleştirir** (diyalog bölümü parça parça doldurur);
  `null`, boş metin ya da boş liste o alanı siler. `assumed` **zorunludur** ve **yalnız bu çağrıda verilen alanlar**
  için geçerlidir: `true` → bu alanlar varsayım; `false` → bu alanlar sahibinin sözü (varsayım olan bir alan aynı
  değerle `false` verilerek doğrulanır). Verilmeyen alanlar işaretlerini korur; silinen alan varsayım sayılmaz.
  Sessiz bir varsayılan yoktur: `assumed` verilmezse çağrı reddedilir ("assumed gerekli"), çünkü varsayılan `false`
  bir tahmini sahibinden gelmiş gibi kaydederdi. Hiçbir şey değişmiyorsa (alanlar ve işaretler aynı) yeni sürüm
  açılmaz ("Değişiklik yok"); yalnız işaretin değişmesi de bir değişikliktir.
- Hedef mimari A1'deki `confidence` parametresi `assumed` olarak alındı: tablo zaten `assumed` tutuyor ve iki düzey
  (sahibinden / varsayım) doğrulanabilir bir ayrım; sayısal güven puanı doğrulanamaz.

## 6. Olay ve karar defteri

- Her değişiklik `{ type: 'profile.updated', entry }` olayını yazar (web olay akışında "Şirket profili: Kimlik (sürüm
  3)").
- Hedef mimari A2 "her değişiklik karar defterine düşer" diyor; burada **yazılmıyor**. Gerekçe: tablo kendisi sürümlü
  bir denetim kaydı (kim/ne zaman/ne/varsayım), `profileRead history` ile okunur; onboarding turda beşe kadar soruyla
  çok sayıda küçük güncelleme yazar ve bunlar `decisionsRead`/`memorySearch`'te gerçek kararları gömer. Profilden
  doğan *kararlar* (blueprint onayı gibi) B5'te karar defterine yazılır.

## 7. Doğrulama

- Birim (K1): depo ve Company (birleştirme, silme, sürüm, varsayım, değişiklik yoksa sürüm yok, doğrulama, yetki,
  olay), araçlar (çıktı metni, geçmiş, kimin görebildiği), göç v12 (yukarı/aşağı, eski veri korunur), özet ve plan
  kartının profilden etkilenmediği.
- Mutasyon kontrolü: birleştirme yerine değiştirme, silmenin kalkması, varsayımın yok sayılması, değişmeyen güncellemede
  sürüm açılması, bilinmeyen alanın kabulü, aracın herkese açılması, profilin özeti de yazması; turu 1'den sonra:
  varsayımın bölüm düzeyine yayılması, `assumed`'ın sessizce `false` olması, `false`'un doğrulamaması, işaret
  değişikliğinin sürüm açmaması, okumada/geçmişte işaretlerin kaybolması.

## 8. Değişiklik günlüğü

- Sürüm 2 (inceleme turu 1, Kerem, [önemli]): kısmi güncellemede varsayım işareti sessizce siliniyordu (bölüm düzeyi
  bayrak + `assumed` verilmezse `false`). Düzeltme: alan düzeyinde `assumed_fields`, `assumed` zorunlu ve yalnız
  verilen alanlara uygulanır; profileRead alan ve bölüm işaretini, geçmiş varsayılan alanları gösterir.
