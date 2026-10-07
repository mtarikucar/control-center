# Önbellek gözlemi — gerçek claude (K3, 2026-10-07)

claude 2.1.292, abonelik, haiku ve sonnet. Testler: `apps/office-server/test/model-switch.real.test.ts`. Model geçişi
`pnpm --filter @cc/office-server smoke` içinde koşar. TTL ölçümü ayrıca açılır:
`OFFICE_SMOKE_TTL=1 SMOKE_TTL_OUT=<dosya>` (gerçek zamanda 6½ dk bekler). Sayılar CLI'nin kendi `result` satırından
(usage, modelUsage). USD, CLI'nin API eşdeğeri. Bu ölçümlerin toplamı ~$0,5; abonelik kotasından düştü.

## Model geçişi (haiku → sonnet, aynı oturum, `--resume --model sonnet`)

Kod kelimesi: zebra-9549 · geçişten sonraki cevap: “zebra-9549”
Turların CLI init modeli: claude-haiku-4-5-20251001 → claude-haiku-4-5-20251001 → claude-sonnet-5-5 → claude-sonnet-5-5

| Tur | İstem | Model (result.modelUsage) | Giriş | Önbellek okuma | Önbellek yazma | Çıkış | USD (tur) |
|---:|---|---|---:|---:|---:|---:|---:|
| 1 | Remember this code word for later: zebra | claude-haiku-4-5-20251001 | 10 | 13899 | 9096 | 56 | 0.0199 |
| 2 | Reply with exactly: OK2 | claude-haiku-4-5-20251001 | 10 | 22995 | 3679 | 47 | 0.0099 |
| 3 | What was the code word I gave you? Reply | claude-haiku-4-5-20251001, claude-sonnet-5-5 | 2 | 18876 | 18151 | 8 | 0.0765 |
| 4 | Reply with exactly: OK3 | claude-haiku-4-5-20251001, claude-sonnet-5-5 | 2 | 37027 | 9534 | 5 | 0.0456 |

İlk koşuda sayılar neredeyse aynıydı (3. tur: okuma 18 876, yazma 18 174, $0,0766). Aynı günün sonraki bir koşusunda
(R13 turunda, 2026-10-07 öğleden sonra) geçiş turu **önbellekten hiç okumadı**: okuma 0, yazma 43 689, $0,1748; sonraki
sonnet turu okuma 43 689, $0,0211. Ortak ön ekin sonnet'te sıcak olması, o sırada başka bir oturumun onu kullanmasına
bağlı.

## Önbelleğin ömrü (haiku, aynı oturum)

| Tur | Önbellek okuma | Önbellek yazma | USD |
|---|---:|---:|---:|
| ilk | 13899 | 8975 | 0.0196 |
| hemen ardından | 22874 | 3031 | 0.0086 |
| 6½ dk sonra | 25905 | 5958 | 0.0147 |

## Okuma

1. **İkinci turda önbellekten okuma var:** 22 874–22 995 token. İlk turda bile 13 899 token önbellekten okunuyor:
   sistem istemi ve araç tanımları aynı modeldeki başka oturumlarla ortak bir ön ek. Önbellek oturuma değil, ön eke bağlı.
2. **Model değişince önbellek sıfırlanmıyor, bölünüyor.** Ortak ön ek (~18,9k) yeni modelde de önbellekten okunuyor:
   aynı makinede sonnet'te çalışan başka oturumlar onu sıcak tutuyor. Konuşmanın kendisi (~18,2k) yeni modelde yeniden
   yazılıyor. Geçiş turu $0,077, bir sonraki sonnet turu $0,020–0,046: geçiş bir kerelik ~2-4 kat. Ön ek soğuksa
   (başka sonnet oturumu yoksa) hepsi yeniden yazılır: $0,175, ~8 kat.
3. **5 dakika varsayımı bu CLI için tutmuyor.** 6½ dk aradan sonraki tur önceki bağlamın tamamını önbellekten okudu
   (25 905 = 22 874 + 3 031); önbellek hâlâ sıcaktı. Gerçek ömür 6½ dk'dan uzun. Claude Code'un 1 saatlik önbelleği
   olası; tam süre **ölçülmedi** (6½ dk ile 60 dk arası, daha uzun bekleme gerekir).

## cacheTtlMinutes (5) ile ilişkisi

- Politikanın gerekçesi "5 dk sonra önbellek zaten soğuk, düşürmek bedava" idi; bu yanlış. Düşürme anında eski modelin
  önbelleği muhtemelen hâlâ sıcak.
- Düşürme yine de kazandırıyor. Bağlam token'ı başına önbellek okuma 0,1×, yazma 1,25× (giriş fiyatına göre):
  - fable'da kalmak 0,1 × 15 = 1,5'e mal olur; sonnet'e geçip yeniden yazmak 1,25 × 1 = 1,25. İlk turda bile ucuz.
  - sonnet → haiku'da ilk tur pahalı (0,25'e karşı 0,1); ~2 haiku turunda amorti olur.
  - Koordinatörün yalnız-özet turu (17:00) çoğunlukla saatlerce uykudan sonra gelir; o zaman iki model de soğuktur.
- **Titreme beklenenden ucuz.** Düşürmeden sonra sahibi yine yazarsa fable'ın önbelleği muhtemelen hâlâ sıcaktır (1 sa).
  Geri yükselme turu ön eki ve konuşmayı önbellekten okur.
- **Karar: `cacheTtlMinutes = 5` kalır.** Artık "önbellek ömrü tahmini" değil, sohbetin ortasında model değiştirmemek
  için bir **bekleme süresi**. Daha uzun bir değer (ör. 60) koordinatörü daha güçlü modelde tutar ve pahalıya gelir.
  K4'te geçiş sayısı ve geçiş turlarının USD'si izlenir (`economy-report`: Modeller, USD, başarısız geçiş satırları).
- Sahibinin mesajı koordinatörü artık yükseltmez (owner varsayılanı sonnet, R11). Yukarıdaki "titreme" yalnız sahibi
  owner'ı fable yaptıysa söz konusu.
- Ölçülemeyenler: önbelleğin tam ömrü; uyku → uyanış soğuk başlangıcının maliyeti (bu testte oturum hiç uyumadı).
