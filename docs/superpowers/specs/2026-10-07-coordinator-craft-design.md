# control-center — Koordinatörlük yetisi tasarımı

- Tarih: 2026-10-07
- Durum: sahibiyle konuşmada yön onaylandı ("iki katman: bilgi + ürünün zorladığı mekanizmalar"); yazılı belge incelemede
- Dayandığı: `2026-10-06-company-design.md` (şirket katmanı, aşama 1–4 main'de) ve `office-economy` dalı (bildirim
  türleri, model politikası, görev zorluğu — incelemede, bu işten önce birleşecek)

## 1. Amaç

Koordinatör, her işi düzgün yönetme yetisiyle **hazır gelsin**: bu bir ürün özelliğidir, kurulan her şirkette aynıdır ve
ürünle birlikte güncellenir. Şirket hafızası yalnız o şirkete özgü bilgiyi tutar (marka, müşteriler, kararlar, o şirketin
öğrendikleri). Bugün koordinatör "nasıl çalışılır"ı her şirkette el kitabına yeniden yazmak zorunda; üstelik yazsa da
uygulanması kendi disiplinine kalıyor (ilk denemede tek çalışan yazdı, kendisi "bitti" dedi, rapordaki iki iddia yanlıştı).

Başarı ölçütü — şunlar olduğunda biter:

1. Sahibi hangi işi getirirse getirsin (yazılım, tanıtım videosu, araştırma, müşteri yanıtı, satın alma), koordinatör
   **sahibi söylemeden** işin nasıl yapılacağını içeren bir plan getirir: iş türü, aşamalar, kimin yapıp kimin
   denetleyeceği, kalite kontrolleri ve "bitti"nin kanıtı.
2. Kalite riski olan bir iş, **yapandan başka biri onaylamadan kapanmaz**; inceleyici değişiklik isterse iş yapana döner.
3. Teslimde bitti tanımının her maddesi için bir kanıt vardır; sahibine giden rapor yalnız doğrulanmış iddia içerir.
4. Plan bitince kısa bir değerlendirme yapılır: şirkete özgü dersler el kitabına, genel yöntem önerileri ürüne
   iyileştirme önerisi olarak gider.
5. Bunlar ek kota yemez: her zaman yüklü olan bilgi kısa kalır, ayrıntı yalnız gerektiğinde okunur.

## 2. Sahibinin kararları

| Konu | Karar |
|---|---|
| Nerede yaşar | Koordinatörlük **ürünün** özelliğidir; şirket hafızasında değil. Her şirkette aynıdır, sürümle güncellenir. |
| Kapsam | Yalnız yazılım değil: **her iş** önce "bu iş iyi nasıl yapılır" sorusuyla başlar. |
| Görev ayrılığı | Yapan kendi işini onaylamaz; inceleme ve doğrulama başka kişidedir. |
| Kanıt | Kanıtsız "bitti" geçmez; rapora yalnız doğrulanmış iddia girer, doğrulanmayan açıkça yazılır. |
| Dışa dönük işler | Yayın, gönderim, ödeme, canlıya alma gibi geri alınamaz işler sahibinin onayından geçer (mevcut kural sürer). |
| Ölçü | Yetinin kendisi az kota yer: çekirdek kısa, ayrıntı isteğe bağlı. |

## 3. Ürüne ait olan, şirkete ait olan

| Ürün (her şirkette aynı, sürümlü) | Şirket hafızası (bu şirkete özgü) |
|---|---|
| Koordinatörlük ilkeleri ve çalışma döngüsü | Bu şirketin el kitabı: "videoları Canva'da yaparız", marka dili, müşteri kuralları |
| İş türü yöntemleri (yazılım, içerik ve pazarlama, araştırma, müşteri ve satış, operasyon ve satın alma, genel) | Karar defteri, notlar, arşiv, çalışan dosyaları |
| Plan kartındaki yöntem alanları, inceleme kapısı, kanıt kuralı, değerlendirme | Bu şirketin değerlendirmelerinden çıkan dersler |
| İyi inceleme nasıl yapılır (önem dereceleri, somut senaryo) | — |

Koordinatör önce ürünün yöntemine, sonra şirketin el kitabındaki yerel kurallara bakar; ikisi çelişirse şirketin yerel
kuralı geçerlidir ve bu kararda gerekçesiyle yazılır.

## 4. Katman 1 — Bilgi

### 4.1 Çekirdek: her zaman yüklü

Ürünle gelen `craft/coordination.md`, koordinatörün ve ekip liderlerinin `office-guide.md`'sinin sonuna eklenir (bugünkü
rehber gibi her oturum açılışında yeniden yazılır). En fazla bir buçuk sayfa; içerik:

1. **Önce yöntem.** Bir iş gelince önce `methodRead` ile o iş türünün yöntemine, `playbookRead` ile şirketin yerel
   kurallarına bak. Plan kartının Yöntem bölümünü doldur: iş türü, aşamalar ve her aşamanın rolü, kalite kontrolleri.
2. **Ölçülebilir bitti.** Her görevin bitti tanımı kontrol edilebilir olsun ("README var" değil, "README kurulumu 3
   adımda anlatıyor ve adımlar temiz bir makinede çalıştı").
3. **Yapan ≠ denetleyen.** Kalite riski olan her görevde bir inceleyici ata. Kimse kendi işini onaylamaz. Kritik işte
   inceleyici en az yapan kadar güçlü bir modelde çalışır.
4. **Kanıt.** Teslim, bitti tanımının her maddesi için kanıt içerir. Sahibine raporda yalnız doğrulanmış iddia olur;
   doğrulanmayan "doğrulanmadı" diye yazılır.
5. **Döngü.** İnceleme bulguları önem sırasıyla gelir (kritik / önemli / küçük); kritik ve önemli kapanmadan iş ilerlemez.
   Bir iş üç turda geçemiyorsa yaklaşımı değiştir ya da sahibine götür.
6. **Ölçek ve maliyet.** En küçük yeterli ekip; işe uygun model; pahalı aşamaları (uzun geliştirme turları) bilerek planla.
7. **Geri alınamaz işler sahibinden geçer.** Yayın, gönderim, ödeme, canlıya alma.
8. **Değerlendirme.** Plan bitince `planRetro`: ne iyi gitti, ne takıldı, ne değişecek. Şirkete özgü dersi el kitabına,
   genel yöntem önerisini öneri olarak yaz.
9. **Raporlama.** Kısa, sayılarla, doğrulanmış; belirsizliği gizleme.

Ekip lideri aynı çekirdeği kendi ekibi ölçeğinde uygular. Çalışanın rehberine (`office-guide.md`) yalnız onu ilgilendiren
kısım eklenir: teslimde her madde için kanıt, inceleyici atanmışsa kararı onun verdiği, "değişiklik iste" gelince ne
yapılacağı, ve inceleyici olunca **nasıl incelenir** (bulgu başına önem derecesi, somut bir başarısızlık senaryosu,
iddiayı kendin doğrula, düzeltmeyi yapana bırak).

### 4.2 İş türü yöntemleri: gerektiğinde okunur

`craft/methods/<tür>.md`, `methodRead` aracıyla okunur (her turda yüklenmez). Her biri aynı başlıkları taşır: tipik
aşamalar, roller, kalite kontrolleri, kanıt, sık yapılan hatalar, model önerisi.

| Tür | Aşamalar (özet) | Kanıt (özet) |
|---|---|---|
| `software` yazılım | kabul ölçütleri → (gerekirse) tasarım → ayrı dalda geliştirme, önce test → kod incelemesi → düzeltme döngüsü → bağımsız doğrulama → kabul → sahibinin yayın kararı | test çıktısı, inceleme raporu, gerçek davranışın komut/ekran çıktısı |
| `content` içerik ve pazarlama (metin, görsel, video, kampanya) | brief (kitle, mesaj, kanal, ton, başarı ölçüsü) → konsept/senaryo → taslak → editör ve marka incelemesi → üretim → son kontrol (marka, iddiaların doğruluğu, format) → sahibinin yayın onayı → ölçüm | dosyalar, kontrol listesi, iddiaların kaynakları |
| `research` araştırma ve analiz | soruyu netleştir → kaynak planı → kaynak kaydıyla toplama → analiz → ikinci kişinin kaynak kontrolü → güven düzeyi ve belirsizliklerle sonuç | kaynak listesi, ham veri, yöntem notu |
| `customer` müşteri ve satış (yanıt, teklif, destek) | ihtiyacı anla → yanıt/teklif taslağı → ikinci göz (doğruluk, fiyat, ton) → dışa gönderimden önce sahibinin onayı (ya da onun koyduğu kural) → takip | taslak, kontrol listesi, onay kaydı |
| `operations` operasyon ve satın alma | ihtiyaç → en az iki seçenek (maliyet, risk) → öneri (`propose`, satın alma sahibine) → onay → kurulum → doğrulama → kayıt (karar defteri, el kitabı) | seçenek karşılaştırması, onay, kurulum doğrulaması |
| `general` diğer | hedef → kabul ölçütleri → yapan/denetleyen ayrımı → kanıt → teslim → değerlendirme | bitti tanımına göre |

### 4.3 Sürüm ve geri besleme

Çekirdeğin başında yöntem sürümü yazar (ör. "Koordinatörlük 1.0"). Değerlendirmelerden gelen genel yöntem önerileri
`yöntem-önerisi` etiketli not olarak durur; sahibi (ve ürün geliştiricisi) bunları Notlar'da görür. Ürün bu önerilerle
sürüm sürüm iyileşir; şirketler kendi kopyalarını yazmaz.

## 5. Katman 2 — Mekanizmalar

### 5.1 Plan kartında yöntem

`planPropose` ve `planRevise` bir **yöntem** alır, `planPropose`'da zorunlu:

- `workType`: `software` | `content` | `research` | `customer` | `operations` | `general`
- `stages`: en az iki aşama; her birinin adı, rolü ve inceleme gerekip gerekmediği
- `checks`: en az bir kalite kontrolü ya da kabul kanıtı

Yöntemsiz plan reddedilir: "Önce işin nasıl yapılacağını yaz: methodRead ile türün yöntemine bak, aşamaları, rolleri ve
kalite kontrollerini plana ekle." Plan kartında **Nasıl yapılacak** bölümü görünür (iş türü, aşamalar ve rolleri, kontroller).
Eski planların yöntemi boştur ve sorunsuz görünür.

### 5.2 İnceleme kapısı

- `taskCreate` ve `taskPass` isteğe bağlı bir **inceleyici** alır (`reviewer`, ad ya da kimlik). Koordinatör ve lider
  atar; inceleyici görevi yapanla aynı kişi olamaz.
- İnceleyicisi olan bir görev `taskFinish` ile teslim edilince **kapanmaz**: durumu `review` (İncelemede) olur, teslim
  saklanır ve ofis inceleyiciye otomatik bir **inceleme görevi** açar (tür `review`, başlık "İnceleme: … (tur n)",
  içinde bitti tanımı, teslim özeti, çıktılar ve madde madde kanıt). İnceleme görevi diğer görevler gibi sırayla verilir.
- İnceleyici `reviewDecide` ile karar verir:
  - `approve`: asıl görev biter (isteyene ve koordinatöre haber, planın bitişi kontrol edilir).
  - `changes`: bulgular önem dereceleriyle yazılır; asıl görev yapana geri döner (bekliyor, tur +1), teslim mesajında
    bulgular yer alır. Üçüncü "değişiklik iste"de koordinatöre karar notu gider.
- İnceleme görevi `reviewDecide` ile kapanır; inceleme görevine `taskFinish` denirse ofis "kararını reviewDecide ile ver"
  der. İnceleme görevi asıl görevin planına bağlıdır; plan, inceleme görevleri dahil her görevi bitince biter.
- Koordinatör inceleyicili bir görevi yapanın yerine teslim ederse yine incelemeye gider.
- İnceleyici işten çıkar ya da uzun süre karar vermezse inceleme görevi diğer görevler gibi koordinatöre döner
  (mevcut kurallar).

### 5.3 Kanıtla teslim

`taskFinish` bir **kanıt** listesi alır. Görevin bitti tanımında N madde varsa en az N kanıt gerekir (aynı sırayla):
"Bitti tanımında 3 madde var; her biri için bir kanıt yaz (aynı sırayla)." Kanıt teslimle saklanır, arşivdeki
`teslim.md`'de madde–kanıt çiftleri olarak yazılır ve inceleme görevine taşınır.

### 5.4 Plan sonunda değerlendirme

Planın son görevi bitince koordinatöre karar notu gider: "Plan bitti: planRetro ile değerlendir, sonra sahibine raporla."
`planRetro` (koordinatör) şunları alır: ne iyi gitti, ne takıldı, bir dahaki sefere ne değişecek, isteğe bağlı genel
yöntem önerisi. Değerlendirme plana bağlı bir not olarak kalır; genel öneri ayrıca `yöntem-önerisi` etiketiyle yazılır.
Şirkete özgü dersleri koordinatör `playbookUpdate` ile el kitabına işler.

## 6. Araçlar

| Araç | Kim | Değişiklik |
|---|---|---|
| `methodRead` | herkes | yeni: türsüz çağrılınca türlerin listesi, türle o türün yöntemi |
| `planPropose`, `planRevise` | koordinatör | yöntem alanları (planPropose'da zorunlu) |
| `taskCreate`, `taskPass` | koordinatör/lider; herkes (pass) | isteğe bağlı `reviewer` |
| `taskFinish` | herkes | `evidence` listesi; bitti tanımı varsa zorunlu |
| `reviewDecide` | inceleyici | yeni: `approve` / `changes` + önem dereceli bulgular |
| `planRetro` | koordinatör | yeni |

## 7. Veri modeli

Bir göç, geri alınabilir ve gidiş-dönüş testli. Numarası birleştirme sırasına bağlı: `office-economy` (v6, v7) önce
birleşirse v8; birleşmezse bu iş v6 alır ve ekonominin göçleri birleşirken yeniden numaralanır.

- `plans.method` (JSON, boş olabilir)
- `tasks.reviewer`, `tasks.review_of` (inceleme görevinin asıl görevi), `tasks.round` (varsayılan 0)
- Görev durumuna `review`, görev türüne `review` eklenir (sütun metin; şema değişmez).
- Kanıt, teslim JSON'una (`TaskResult`) `evidence: string[]` olarak eklenir (göç gerekmez; bitti tanımı zaten `string[]`).

## 8. Ekran

- Plan kartında **Nasıl yapılacak** bölümü.
- Görev panosunda **İncelemede** sütunu; kartta inceleyici ve tur.
- Sohbet akışında inceleme kararları ("Onaylandı", "Değişiklik istendi: 2 önemli, 1 küçük").
- Notlar'da `yöntem-önerisi` ve `retro` etiketleri.

## 9. Hata durumları

| Durum | Davranış |
|---|---|
| Yöntemsiz plan | `planPropose` Türkçe hata ile reddeder, ne ekleneceğini söyler. |
| İnceleyici = yapan | Görev açılırken ya da atanırken reddedilir. |
| Kanıt eksik | `taskFinish` reddeder, madde sayısını söyler. |
| İnceleme görevi sahipsiz kaldı | Mevcut kurallar: işten çıkan ya da duran kişinin görevi koordinatöre döner. |
| Üç tur "değişiklik iste" | Koordinatöre karar notu; iş sürer, koordinatör yaklaşımı değiştirir ya da sahibine götürür. |
| Yöntem dosyası okunamadı | `methodRead` genel yöntemi döner ve durumu söyler; ofis çalışmaya devam eder. |

## 10. Test

- Birim: her iş türü için yöntem dosyası var ve aynı başlıkları taşıyor; çekirdek koordinatörün ve liderin rehberinde,
  çalışanın rehberinde yalnız onu ilgilendiren kısım; yöntemsiz plan reddedilir; inceleme akışı (approve, changes, tur,
  üçüncü tur notu, yapan ≠ inceleyici, koordinatörün yerine teslimi); kanıt kuralı; değerlendirme; göç gidiş-dönüş.
- Ofis: inceleme görevi sırayla verilir; uyuyan inceleyici inceleme görevi için uyanır; ekonomi anahtarlarıyla birlikte
  çalışır (inceleme görevi de zorluğa göre model alır).
- Gerçek claude (isteğe bağlı, `OFFICE_SMOKE=1`): koordinatöre yazılım **dışı** bir ihtiyaç verilir ("ürün için kısa bir
  tanıtım metni"); plan kartında iş türü `content` ve inceleme aşaması olur; onaydan sonra yazar teslim eder, inceleme
  görevi açılır, inceleyici karar verir; asıl görev ancak onaydan sonra kapanır.

## 11. Ekonomiyle ilişki

Çekirdek kısa tutulur (her turda önbellekten okunur); iş türü yöntemleri yalnız `methodRead` ile, gerektiğinde okunur.
İnceleme görevleri de görev zorluğuna göre model alır; çekirdek, kritik işte inceleyicinin yapandan zayıf olmamasını söyler.

## 12. Sıra ve kapsam dışı

Sıra: `office-economy` incelenir ve birleşir → bu belge onaylanır → uygulama planı → geliştirme (testle, bağımsız
incelemeyle) → koordinatörün ilk gerçek sınavı: kalan iş bu yöntemle yürür.

Kapsam dışı: sahibinin yöntemleri ekrandan düzenlemesi; inceleyicinin otomatik atanması; şirketler arası yöntem eşitleme
(ürün güncellemesi yeterli); toplantılar.
