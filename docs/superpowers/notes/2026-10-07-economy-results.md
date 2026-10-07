# Ofis ekonomisi — sonuçlar (2026-10-07)

Plan "Ofis ekonomisi"nin hedefi: aynı iş için ≥%50 daha az kota. Ölçüm: aynı senaryo testi
(`apps/office-server/test/economy.scenario.test.ts`, son sürümü) üç kod üzerinde, her biri geçici bir worktree'de iki kez
koşturuldu ve iki koşu birebir aynı çıktı. Senaryo ve sayım yöntemi: [economy-measure.md](economy-measure.md). Main'e commit
yok.

| Aşama | Kod | Ne değişti |
|---|---|---|
| Taban | main `e2889e8` | — |
| Özet | `4866e7f` | not türleri: bilgi notları tur açmaz, özet saatlerinde tek tur; rapor hatırlatması son özette |
| Son | office-economy `HEAD` | + koordinatör modeli turun türüne göre, görev modeli zorluğa göre (soğuk sınır kuralı) |

Main ve özet aşamasında senaryonun yeni alanları (model ipucu, görev zorluğu) yok sayılır. Test kopyasında yalnız o
kodlarda olmayan adlar uyarlandı: `DIGEST_HEADING`, `coordinatorModels` okuması ve main'in eski rapor hatırlatması metni. Eşikler beklendiği gibi main'de (koordinatör 15 tur) ve özet aşamasında
(koordinatör maliyeti 75 > 67,5) kırmızı, dalda yeşil.

## Önce / sonra

| | Taban (main) | Özet | Son (dal) | Değişim (taban → son) |
|---|---:|---:|---:|---:|
| Koordinatör turu | 15 | 5 | 5 | −%67 |
| Koordinatör modelleri | fable 15 | fable 5 | fable 1 · sonnet 3 · haiku 1 | |
| Koordinatör modellenmiş maliyeti | 225 | 75 | **18,2** | **−%92** |
| Üye turu (Ada + Can) | 6 + 5 | 6 + 5 | 6 + 5 | 0 |
| Üye modelleri | sonnet 11 | sonnet 11 | opus 1 · sonnet 4 · haiku 6 | |
| Üye modellenmiş maliyeti | 11 | 11 | 10,2 | −%7 |
| **Toplam tur** | 26 | 16 | 16 | −%38 |
| **Toplam modellenmiş maliyet** | 236 | 86 | **28,4** | **−%88** |
| Açılan oturum (koord. + üyeler) | 8 + 2 | 4 + 2 | 5 + 11 | +%60 |

Modellenmiş maliyet = Σ tur × ağırlık(model); ağırlıklar fable 15, opus 5, sonnet 1, haiku 0,2.

Koordinatörün turları:

| Saat | Neden | Taban | Son |
|---|---|---|---|
| 08:45 | sahibinin mesajı (plan iste) | fable | fable |
| 09:00 | plan onayı (görevleri aç) | fable | sonnet |
| 09:47 – 14:00 | 10 teslim (+ plan bitti) | 10 × fable | — (özete biner) |
| 10:07 | takılma | fable | sonnet (+ 2 teslim özeti) |
| 11:00 | öneri | fable | sonnet (+ 2 teslim özeti) |
| 17:00 | özet + rapor hatırlatması | — | haiku |
| ertesi gün 08:46 | rapor hatırlatması | fable | — |

Kazancın kaynağı: tur sayısı not türleriyle (225 → 75), modelin turun işine göre seçilmesiyle (75 → 18,2). Üyelerde tur
sayısı değişmez; kazanç kolay işlerin haiku'da koşmasından gelir, tek zor iş opus'a çıkar (önce sonnet'teydi).
Hiçbir görev zorluğunun modelinden güçlü bir modelde koşmaz (test eşiği).

## Yöntemin sınırları

- **Bağlam boyutu ve önbellek yok sayıldı.** Her tur aynı ağırlıkta sayılır. Gerçekte bir turun maliyeti okunan bağlamla
  büyür ve önbellekten okunan bağlam çok daha ucuzdur.
- **Model değişimi soğuk başlangıçtır.** Bu tabloda görünmez ama dalda oturum sayısı arttı (10 → 16). Her model değişimi
  oturumu yeniden açar; bağlam yeni modelde önbelleksiz bir kez yeniden okunur. Koordinatörde bu zaten uyku/uyanış
  sınırlarına denk gelir: koordinatör 30 dk boşta uyur, uyanışta önbellek zaten soğuktur. Üyelerde her görev başı bir
  soğuk başlangıç olabilir. Görev başında daha zayıf modele hemen geçmek (TTL beklemeden) bilinçli bir istisna: uzun bir
  görevde bir soğuk okuma, işi gereğinden güçlü modelde koşturmaktan ucuzdur. Kaba hesap (giriş fiyatı ağırlıkla
  orantılı, önbellek yazma 1,25×, okuma 0,1×): opus → haiku geçişi ilk çağrıda bile kazandırır; opus → sonnet birkaç
  API çağrısında amorti olur.
- Sahte claude anında ve sabit tokenla cevap verir; bir tur, gerçekte içindeki tüm API çağrılarıyla tek sayılır.
- Senaryoda sahibiyle sohbet tek mesaj. Uzun bir sohbette koordinatör TTL içinde fable'da kalır (titreme yok); sohbet
  bitip 5 dk geçince sıradaki rutin not sonnet'te işlenir.
- askColleague (yan cevaplar), teslim etmeyen üyeler (hatırlatma ve tırmandırma turları) ve sahibinin payı senaryoda
  yok. Kota ortaktır; tabloda yalnız ofisin payı var.

## İnceleme düzeltmelerinden sonra (aynı gün)

Bağımsız incelemenin 8 bulgusu kapatıldı (sınır notları ve beklenen teslim karar notu; özetin kapanış satırı yalnız tek
başına gelen özette; görev modeli yalnız oturumu taşır, kadrodaki model kalır; model geçişi başarısız olursa eski modelle
sürer, mesaj kaybolmaz; payda karar notu yalnız koordinatörü uyandırır; rapor hatırlatması günlükte; çalışanın kritik
pası zor sayılır). Senaryo yeniden çalıştırıldı: **sayılar değişmedi** (koordinatör 5 tur, 18,2; toplam 16 tur, 28,4;
oturumlar 5 + 11). Beklenen: senaryodaki her görevin zorluğu var (kadro modeli devreye girmez), sınırlara ve payda
uyandırmaya değmez, paslanan iş ve takılı isteyen yok. Düzeltmeler senaryonun dışındaki yolları kapatır; her biri kendi
testinde.

## Gerçek kullanımda bakılacaklar

- `budgetStatus` artık bugün kimin kaç tur kullandığını söylüyor; Bütçe sekmesi ekip başına tur gösteriyor. Birkaç gün
  sonra koordinatör turu / gün ve haftalık kota %'si bu tabloyla karşılaştırılmalı.
- Model haritaları ve `cacheTtlMinutes` Anayasa sekmesinden değişir. Özet turunun haiku'da yetersiz kaldığı görülürse
  `coordinatorModels.digest` sonnet yapılabilir: koordinatör maliyeti 18,2'den 19'a çıkar, yine −%92.
