# Koordinatörün yönetim turu — tasarım

- Tarih: 2026-10-08
- Durum: sahibi onayladı (2026-10-08); uygulanıyor (dal feat/management-cycle)
- Kapsam: koordinatörün çalışma biçimi (ürünün kendisi). Ofisin ürettiği içerikle ilgisi yok; her şirkette aynı çalışır.

## 1. Sorun

Canlı ofiste gözlenen: koordinatör bir yönetici gibi değil, bir alarm alıcısı gibi çalışıyor.

1. **Teslimleri geç duyuyor.** `task.finished`, `review.approved`, `review.changes`, `plan.done` *bilgi* notu; özet
   açıkken (`digestEnabled`) günde iki kez (09:00, 17:00) ya da başka bir *karar* notu onu uyandırana kadar bekliyor.
   2026-10-08'de 12:32–13:15 arasındaki dört teslimi 13:21'de, boşta kapasite uyarısıyla birlikte duydu.
2. **Yalnız istisnada uyanıyor.** Boşta kalınca 30 dakikada uyuyor; tabloya kendisi düzenli bakmıyor.
3. **Plan bir kez yapılıp bırakılıyor.** Plan metin alanlarından oluşuyor (`approach`, `people`, `steps`); kim neyi
   paralel yapacak, kritik yol, kim boşta kalacak yapıda yok. Şartlar değişince (kota sınırı %40→%60, bir geliştirici
   boşa çıktı) plan değişmedi: işler tek kişide zincirlendi, aynı roldeki ikinci kişi saatlerce boştaydı.
4. **Planlama zayıf modelde.** Koordinatörün bütün turları Sonnet'te (model politikası kapalı).

Dedektörler (boşta kapasite, darboğaz uyarısı) belirtiyi yamar. Çözüm koordinatörün çalışma biçimini değiştirmek.

## 2. Hedefler ve hedef olmayanlar

Hedefler:
- Koordinatör işin şekli her değiştiğinde ve iş açık olduğu sürece düzenli aralıkla bütün tabloyu görür ve planı yeniden
  değerlendirir (**yönetim turu**).
- Plan yaşayan bir yapı olur: paralel akışlar, sahipleri, bağımlılıkları; tur bu yapıyı gerçekle karşılaştırıp düzenler.
- Her tur bir karar bırakır: değişiklik ya da "değişiklik yok, çünkü …". Sahibi bu günlüğü görür.
- Model işin türüne göre seçilir: proje başlangıcı Fable, yeniden planlama Opus, sıradan yanıtlar Sonnet.

Hedef olmayanlar:
- Ofisin ne ürettiğine dair kural (alan bilgisi rehberde değil, yöntemlerde ve el kitabında kalır).
- Çalışanların kendi iş yapma biçimi (yalnız koordinatör ve ekip liderleri değişir).
- Yeni dedektörler. Mevcut nabız kontrolleri (boşta kapasite, hedef boşta, hedef yok) ayrı not olmaktan çıkıp panonun
  bölümleri olur.

## 3. Yönetim turu

### 3.1 Tetikler

Tur şu olaylardan biri olunca açılır (yakın olaylar tek turda toplanır):

| Olay | Örnek |
|---|---|
| Teslim ya da inceleme kararı | bir iş kabul edildi, değişiklik istendi |
| Biri boşa çıktı | sırasında iş kalmadı, işi başkasına geçti |
| Plan ya da hedef durumu değişti | plan bitti, hedef açıldı, sahibi durdurdu |
| Kısıt değişti | anayasa, sahibinin kota payı, sahibi şirketi sürdürdü |
| Takılma | engellendi, hatırlatmaya rağmen ilerlemiyor, son tarih geçti |
| Kalp atışı | olay olmasa da iş açıkken en geç **45 dakikada** bir |

- **Toplama penceresi:** ilk olaydan sonra 2 dakika beklenir; o arada gelenler aynı tura girer.
- **Ne zaman açılmaz:** şirket duraklatılmışsa; koordinatör zaten bir turdaysa (bitince bekleyen olay varsa yeni tur).
- **Hedef ve açık iş yokken:** kalp atışı seyrekleşir: anayasanın `pulseHours` aralığında bir tur (0 = hiç); koordinatör
  `restUntil` ile dinlenirken bu tur gelmez, dinlenme bitince bir tur açılır (2026-10-08 kararı: ofis kendi kendine
  hiç uyanmayan bir duruma düşmemeli).
- **Kota payı devredeyken:** yalnız olaylar tur açar, kalp atışı yok (sahibinin payı korunur).
- Sahibinin mesajı tur açmaz, doğrudan koordinatöre gider (bugünkü gibi); ama sonraki tur o mesajdan sonraki durumu görür.

### 3.2 Pano (girdi)

Ofis her turda tek bir Türkçe metin hazırlar ve turun ilk mesajı olarak verir. Bütün veriler mevcut servislerden
(ajanda, metrikler, hedefler, planlar, kota, olay günlüğü) gelir; model aramak zorunda kalmaz.

1. **Ne değişti** (son turdan beri): teslimler (kim, ne, inceleme sonucu), yeni takılmalar, boşa çıkanlar, kısıt
   değişiklikleri, sahibinin mesajları (özet).
2. **Hedefler ve planlar:** her aktif hedef; her süren planın akışları (aşağıda) ve her akışın durumu.
3. **İnsanlar:** her çalışan için şu an ne yapıyor / ne zamandır, sırasında ne var, boştaysa ne zamandır, iş alamıyorsa
   neden (kota, hata, terminal). Ajandanın tahmini bitiş saatleri.
4. **Zincirler ve kritik yol:** bağımlılık zinciri olan işler, kimde biriktiği, en uzun yol.
5. **Riskler:** engellenen, hatırlatmaya rağmen ilerlemeyen, son tarihi geçen ya da yaklaşan işler; incelemede bekleyenler.
6. **Kaynak:** haftalık ve 5 saatlik kota kullanımı, sahibinin sınırı, son 24 saatte harcanan, plan tahminleriyle kıyas.
7. **Açık kararlar:** sahibine sorulup cevap bekleyenler, sahibinin onayını bekleyen işler.

Pano kısa tutulur (hedef: 2–4 bin karakter); uzun listeler sayıyla özetlenir, ayrıntısı araçlarla okunur.

### 3.3 Çıktı sözleşmesi

Her tur yeni bir araçla kapanır: `cycleClose({ changes, reasoning, next })`.
- `changes`: turda yapılan plan değişikliklerinin kısa listesi (yeniden dağıtım, bölme, paralelleştirme, işe alma,
  park, öncelik, sahibine soru) — ya da boş.
- `reasoning`: neden; değişiklik yoksa "değişiklik yok, çünkü …" zorunlu.
- `next`: bir sonraki turda neye bakacağı (isteğe bağlı).

Kurallar:
- `cycleClose` çağrılmadan tur biterse ofis bunu günlüğe "kapanmadı" diye yazar ve bir sonraki turda panonun başına koyar.
- Günlük (`management.cycle` olayları) sahibinin ekranında yeni bir **Yönetim** sekmesinde görünür: saat, model,
  tetikleyen olaylar, değişiklikler, gerekçe, maliyet.

### 3.4 Yaşayan plan: akışlar

Planlara yapısal **akışlar** eklenir (plan kartındaki metin alanları kalır).

```
streams: [{ id, title, owner (çalışan ya da "alınacak: <rol>"), dependsOn: [streamId], status: 'planned'|'active'|'blocked'|'done' }]
```

- Görevler bir akışa bağlanır (`taskCreate`'e `streamId`; zorunlu değil, planlı işlerde önerilir).
- `planPropose` ve `planRevise` akışları alır; akış eklemek, sahibini değiştirmek, bağımlılığı düzeltmek, akışı bölmek
  `planRevise` ile yapılır. Serbestlik "tam serbest" iken plan revizyonu sahibinin onayını beklemez (bugünkü kural);
  "planlar sahibine" iken akış değişiklikleri revizyon olarak sahibine gider.
- Pano akışları gerçekle karşılaştırır: sahibi boşta olan aktif akış, sahibi olmayan akış, tek kişide toplanmış
  bağımlı akışlar, bitmiş ama kapanmamış akış.
- Ajanda ve Görevler ekranı akışı gösterir (görev kartında akış adı).

### 3.5 Model yönlendirmesi

Koordinatörün her turu bir türe sahiptir; model türe göre seçilir. Ekonomi anahtarından (`modelPolicyEnabled`)
bağımsızdır: koordinatörün rol modeli her zaman uygulanır.

| Tür | Ne zaman | Model (varsayılan) |
|---|---|---|
| **Başlangıç** | Ofiste süren plan yokken sahibinin mesajı; panoda "hedef yok" ya da "hedefin süren planı yok" | Fable |
| **Yönetim turu** | 3.1'deki tetikler | Opus |
| **Sıradan** | Diğer her şey: bir çalışanın önerisine, sorusuna, inceleme yönlendirmesine yanıt; sahibine kısa cevap | Sonnet |

- Anayasadaki `coordinatorModels` `{ owner, decision, digest }` yerine `{ kickoff, cycle, routine }` olur; varsayılan
  `{ kickoff: 'fable', cycle: 'opus', routine: 'sonnet' }`. Eski anahtarlar okunurken yenisine çevrilir.
- Model değişimi bugünkü mekanizmayla olur (oturum `--resume` ile başka modelde yeniden açılır; hafıza korunur);
  önbellek süresi (`cacheTtlMinutes`) içinde aynı modelde art arda gelen turlar oturumu yeniden açmaz.
- Başlangıç turunda koordinatör plan önerince sonraki turlar normal akışa döner.

### 3.6 Özet ve notlar

- Koordinatörün yönetim girdileri artık bilgi notlarına bağlı değildir: pano olay günlüğünden üretilir. Teslim ve
  inceleme bilgi notları koordinatör için tur tetikler; özet saatini beklemez.
- Özet (09:00/17:00) yalnız sahibine giden günlük rapor içindir.
- Nabzın `pulse.idle_capacity`, `pulse.goal_idle`, `pulse.no_goal` notları kalkar; aynı bilgiler panonun bölümleridir.
  `idleCapacityHours` anayasa anahtarı panodaki "uzun süredir boşta" işaretinin eşiği olarak kalır.

### 3.7 Rehber (koordinatör ve liderler)

`craft/pm.md` ve `coordination.md`'ye genel kurallar:
- Yönetim turunun amacı: pano her geldiğinde tabloyu oku, planı gerçekle karşılaştır, gerekeni değiştir, `cycleClose`
  ile kapat.
- Planı akışlarla kur: paralel akışlar, sahipleri, bağımlılıklar; ortak kaynakları baştan paylaştır.
- Her turda sor: boşta kim var ve neden; zincir tek kişide mi; kritik yol kısaltılabilir mi; kısıt değişti mi; sahibinden
  bekleyen bir karar var mı.
- Başlangıç turunda (Fable) işin dünyasını öğrenmeye, akışları ve ekibi kurmaya zaman ayır; yönetim turlarında (Opus)
  kısa ve kararlı ol.

## 4. Maliyet

- Opus yönetim turu tahmini 0,2–0,6 $; tetik yoğun bir saatte 4–8 tur. Kalp atışı yalnız iş açıkken ve olay yoksa 45
  dakikada bir.
- Fable başlangıç turu nadirdir (yeni proje, hedefin planı bitince).
- Sıradan turlar Sonnet'te kalır; bugünkü turların çoğu bu türdendir.
- Kota payı devredeyken kalp atışı durur; yalnız olaylar tur açar.

## 5. Hatalar ve sınır durumları

| Durum | Davranış |
|---|---|
| Koordinatör tur sırasında başka bir mesaj alır | Mesaj aynı oturuma sıraya girer (bugünkü gibi); tur kapanınca yeni olaylar bir sonraki tura |
| `cycleClose` çağrılmadı | Günlüğe "kapanmadı"; bir sonraki panonun başında uyarı |
| Fable/Opus kullanılamıyor (hesap, kota) | Bugünkü geri dönüş: bir alt model; günlüğe yazılır |
| Koordinatör yok | Tur açılmaz; sahibine bugünkü gibi |
| Ofis yeniden başladı | İlk dakikada bir yönetim turu (açık iş varsa) |
| Pano çok büyük | Bölüm başına üst sınır; aşanlar sayıyla özetlenir |

## 6. Test

- Birim: tetikler ve toplama penceresi (sahte saat), kalp atışı koşulları, duraklatma ve kota payı, pano içeriği
  (her bölüm, kısa tutma), `cycleClose` kaydı ve "kapanmadı" yolu, akışların plan ve görevlere bağlanması, model
  yönlendirme kuralları, eski `coordinatorModels` anahtarlarının çevrilmesi.
- Ekonomi karşılaştırma kaydı: yeni tetikler koordinatöre giden mesajları değiştirir; kayıt bilerek yenilenir ve hangi
  mesajların neden değiştiği yazılır.
- Gerçek claude (isteğe bağlı): sahte bir şirkette iki çalışan, bir zincirli plan; biri boşa çıkınca yönetim turunun
  işi paralelleştirdiği ya da gerekçeyle bıraktığı görülür.

## 7. Uygulama sırası

1. Akış veri modeli (göç, tipler, `planPropose`/`planRevise`/`taskCreate`).
2. Pano üreticisi (mevcut servislerden).
3. Yönetim turu tetikleyicisi (saat servisiyle; toplama penceresi, kalp atışı) ve `cycleClose`.
4. Model yönlendirmesi ve anayasa anahtarları.
5. Nabız notlarının panoya taşınması; özet kuralı.
6. Rehber metinleri.
7. Web: Yönetim sekmesi, görev kartında akış.
8. Gerçek claude denemesi ve belgeler.
