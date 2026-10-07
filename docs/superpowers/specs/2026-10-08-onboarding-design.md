# control-center — Onboarding diyaloğu ve soru seti (B1) tasarım notu

- Tarih: 2026-10-08 · Yazan: Mert · Görev: d43dc071 (plan "Çekirdek 2", B1) · İnceleyen: Kerem
- Dayandığı: `bosluk-analizi.md` §2 B1 satırı ve §3 "B1 — Onboarding diyaloğu ve soru seti yok"; `hedef-mimari.md`
  §4 A1 (koordinatör yürütür, ürünle gelen soru seti, zorunlu/isteğe bağlı bölümler ve "yeterli" tanımı, turda en
  fazla 5 soru, cevapsız bölüm varsayımla `assumed`), §5 adım 1; `pilot-senaryosu.md` §2 (tek cümle), A3, KÖ1
  (tek cümleden zorunlu bölümlere ≤ 2 koordinatör turu, ≤ 10 soru, eksikler `assumed`; ölçüm "profil-tamam olayı").
- B2'nin profili (`company_profile`, alan düzeyinde `assumed_fields`) üstüne. Dal `feat/onboarding`,
  `integration/core-1` (b89716d) üstünde. **Göç v14** (v12 KPI, v13 profil; v15 B3'e ayrıldı).

## 1. Kapsam

Eklenenler: ürünle gelen soru seti (`packages/shared/src/onboarding.ts`), diyalog durumu (göç v14), üç koordinatör
aracı (`onboardingStart`, `onboardingNext`, `onboardingFinish`), sahibi için API (`GET /api/onboarding`,
`POST /api/onboarding/answers`), koordinatör rehberine bir madde (`craft/pm.md`) ve isteğe göre okunan diyalog
rehberi (`craft/onboarding.md`; `onboardingStart` yanıtında gelir, her turda taşınmaz). Cevaplar B2'nin profiline
yazılır; yeni bir veri yeri açılmaz.

Kapsam dışı: blueprint (B5), yeniden onboarding farkı (A4), web formu (API hazır; sekme sonra), gerçek claude ile
smoke testi (K3; KÖ1'in ölçümü).

## 2. Soru seti (ürünle gelir, DB'ye yazılmaz)

Her soru bir profil bölümüne ve alan(lar)ına bağlıdır. **Zorunlu 10 soru** iki blok halinde (5 + 5), KÖ1'in "≤ 10
soru" sınırıyla. Tek cümle `identity.summary`'ye sahibinin sözü olarak yazılır, soru sayılmaz.

| # | id | Bölüm.alan | Soru | |
|---|---|---|---|---|
| 1 | `name` | identity.name | Firmanızın adı ne? | zorunlu |
| 2 | `sector` | identity.sector | Hangi sektörde çalışıyorsunuz? | zorunlu |
| 3 | `products` | offer.products | Ne satıyorsunuz ya da hangi hizmetleri veriyorsunuz? | zorunlu |
| 4 | `segments` | customers.segments | Müşterileriniz kimler (tür ve yaklaşık sayı)? | zorunlu |
| 5 | `channels` | customers.channels | Müşteriler size nereden geliyor, hangi kanallarda çalışıyorsunuz? | zorunlu |
| 6 | `goals` | goals.goals | Önümüzdeki 1–3 ayda neyi başarmak istiyorsunuz? | zorunlu |
| 7 | `success` | success.done | Hangi durumda "bu ofis işe yaradı" dersiniz? | zorunlu |
| 8 | `tools` | tools.email/social/payment/accounting/ecommerce/other (biri yeter) | Hangi hesap ve araçları kullanıyorsunuz (e-posta, sosyal medya, ödeme, muhasebe, e-ticaret)? | zorunlu |
| 9 | `budget` | constraints.budget | Araç, abonelik ve reklam için aylık ne kadar harcanabilir? | zorunlu |
| 10 | `limits` | constraints.other | Ofisin sizden onaysız yapmaması gereken işler var mı? | zorunlu |
| 11 | `pricing` | offer.pricing | Fiyatlandırmanız nasıl? | isteğe bağlı |
| 12 | `platforms` | customers.platforms | Hangi platformlarda satış ya da yayın yapıyorsunuz? | isteğe bağlı |
| 13 | `brandVoice` | constraints.brandVoice | Marka diliniz nasıl olmalı? | isteğe bağlı |
| 14 | `legal` | constraints.legal | Uymanız gereken yasal kurallar var mı (KVKK vb.)? | isteğe bağlı |
| 15 | `timezone` | constraints.timezone | Hangi saat diliminde çalışıyorsunuz? | isteğe bağlı |
| 16 | `country` | identity.country | Hangi ülkede, hangi şehirde çalışıyorsunuz? | isteğe bağlı |
| 17 | `languages` | identity.languages | Hangi dillerde iş yapıyorsunuz? | isteğe bağlı |
| 18 | `kpis` | goals.kpis | Hedeflerinizi hangi sayılarla ölçersiniz? | isteğe bağlı |

**Sorunun durumu** (profilden okunur): `open` (alanlarından hiçbiri dolu değil), `assumed` (dolu ama dolu
alanlardan biri varsayım), `answered` (dolu, hiçbiri varsayım değil). **Yeterli (zorunlu bölüm denetimi):** zorunlu
soruların hiçbiri `open` değil, yani her zorunlu alan sahibinden ya da varsayımla dolu. Varsayımlar işaretli kalır.

## 3. Akış

1. Sahibi işini tek cümleyle söyler. Koordinatör `onboardingStart(description)` çağırır: cümle `identity.summary`'ye
   sahibinin sözü (`assumed: false`) olarak yazılır, onboarding açılır, yanıtta diyalog rehberi gelir. Koordinatör
   cümleden çıkarabildiklerini (sektör, ürünler, kanallar …) `profileUpdate(…, assumed: true)` ile önceden yazabilir.
2. `onboardingNext()` sıradaki bloğu verir: `open` ya da `assumed` durumdaki, en fazla 2 kez sorulmuş zorunlu
   sorular, sırayla, **en fazla 5**. Varsayım olanlar "(şu an varsayım: …; doğru mu?)" diye sorulur. Verilen blok
   tur olarak kaydedilir (sorulma sayısı buradan). Zorunlular dolunca `optional: true` ile isteğe bağlı sorular gelir.
3. Koordinatör bloğu sahibine tek mesajda sorar. Cevapları `profileUpdate(…, assumed: false)` ile yazar. Sahibi
   cevapları API'den de verebilir (`POST /api/onboarding/answers`): alanlar sahibinin sözü olarak yazılır,
   koordinatöre bildirim gider.
4. İki kez sorulup hâlâ `open` kalan zorunlu soru `onboardingNext` yanıtında "varsayımla doldur" listesine düşer;
   koordinatör `profileUpdate(…, assumed: true)` ile doldurur (A1). Bir daha sorulmaz.
5. `onboardingFinish()`: zorunlu soruların hiçbiri `open` değilse onboarding biter, `onboarding.changed finished`
   olayı yazılır (KÖ1'in "profil-tamam olayı") ve yanıt varsayım kalan alanları sayar. Değilse eksikleri sayarak
   reddeder.

Olaylar: `onboarding.changed` (`started`, `round` (sorulan id'lerle), `answered`, `finished`). KÖ1'in soru ve tur
sayısı olaylardan ölçülür.

## 4. Göç v14

```sql
CREATE TABLE onboarding (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,   -- sahibinin tek cümlesi
  status TEXT NOT NULL,        -- active | done
  started_by TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE TABLE onboarding_rounds (
  onboarding_id TEXT NOT NULL,
  round INTEGER NOT NULL,
  questions TEXT NOT NULL,     -- JSON: sorulan soru id'leri
  asked_at INTEGER NOT NULL,
  PRIMARY KEY (onboarding_id, round)
);
```

Aynı anda tek bir etkin onboarding olabilir. Bitenler kalır; yeniden onboarding (A4) yeni bir satır açar. Neden
`company_state` değil: turlar (hangi soru ne zaman soruldu) KÖ1 ölçümü ve denetim için sorgulanabilir kalmalı.
v15 B3'e (entegrasyon kaydı) ayrıldı.

## 5. Araçlar ve API

```
onboardingStart(description: string)        koordinatör   onboarding açar, summary yazar, rehberi verir
onboardingNext(optional?: boolean)          koordinatör   sıradaki ≤ 5 soru + varsayımla doldurulacaklar + durum
onboardingFinish()                          koordinatör   zorunlular dolu ise bitirir
GET  /api/onboarding                        sahibi        etkin/son onboarding, her soru: durum, sorulma, değer
POST /api/onboarding/answers {answers: {soruId: değer}}   sahibi   alanlar sahibinin sözü olarak yazılır
```

Çok alanlı soruda (`tools`) değer bir nesnedir (`{social: ['Instagram'], email: ['Gmail']}`); tek alanlıda metin ya
da liste. Bilinmeyen soru id'si ya da alan reddedilir (B2 doğrulaması).

## 6. Doğrulama

- Birim (K1): göç v14; soru setinin şekli (10 zorunlu, alanlar profilde var); akış: başlat → blok 5 → cevaplar →
  blok → iki kez cevapsız → varsayım listesi → bitir; varsayımların alan düzeyinde işaretli kalması; API cevapları
  sahibinin sözü; pilotun tek cümlesiyle KÖ1 vekili (işbirlikçi sahipte 2 tur, 10 soru).
- Mutasyon kontrolü: blok sınırı, sorulma sınırı, durum hesabı, yeterlilik, sahibi cevabının varsayım sayılması,
  tur kaydı, bitirme koşulu.
- Doğrulanmadı (sonraki iş): gerçek claude koordinatörüyle smoke testi (K3).
