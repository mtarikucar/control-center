# control-center

Claude Code ve Codex oturumlarını aynı canlı 3D ofiste, rol tanımı verilmiş çalışanlar olarak çalıştıran platform.
Tasarım: `docs/superpowers/specs/2026-10-06-office-v1-design.md`.

## Claude ve Codex birlikte

Node.js 24+, pnpm 9 ve kullanacağın sağlayıcının giriş yapılmış CLI'ı gerekir. Karma ofiste hem `claude` hem `codex` kurulu olmalı:

```bash
codex login
pnpm install
pnpm office
```

Tarayıcıda **http://127.0.0.1:4319** adresini aç. **Şirket → Koordinatörün sağlayıcısı** alanında Claude
veya Codex seçip koordinatör al. **Çalışan al → Sağlayıcı** ile her çalışanı ayrı seç: Claude koordinatör
Codex geliştiriciye görev verebilir; Codex koordinatör de Claude çalışanlarını yönetebilir. Aynı görev,
inceleme, teslim, hafıza ve ajanda sistemi kullanılır. Sohbette “bu iş için Codex çalışanı al” diyebilirsin.

Koordinatörün veya çalışanın panelindeki **Sağlayıcı** seçimini boşta ya da durdurulmuşken değiştirebilirsin.
İki sağlayıcının yerel sohbetleri ayrı saklanır; aynı sağlayıcıya dönünce kendi oturumu sürdürülür. Geçişte
son konuşmalar devir notuna aktarılır; görevler, şirket hafızası ve dosyalar ortak kalır. Codex'te model
ailesi yerine dört çalışma düzeyi seçilir. `pnpm office:codex` yalnız yeni çalışan varsayılanını Codex
yapar ve ayrı `~/.control-center-codex/` klasörünü açar; yine iki sağlayıcı da seçilebilir.
`OFFICE_CODEX_MODEL` belirli bir Codex modeli, `OFFICE_CODEX_COMMAND` JSON komut dizisi içindir. Ayrıntılar:
[Codex entegrasyonu](docs/codex.md).

## Ofisi açmak

```bash
pnpm install
pnpm office          # arayüzü derler ve office-server'ı başlatır
```

Sonra tarayıcıda **http://127.0.0.1:4319** adresini aç. Modeller `assets/3d/` altında ve `assets/3d/manifest.json`
ile tanımlıdır; eksik bir model yerine voksel kutu / figür görünür.

Arayüz geliştirme (anlık yenileme):

```bash
OFFICE_ALLOWED_ORIGINS=http://127.0.0.1:5180,http://localhost:5180 pnpm --filter @cc/office-server start
pnpm --filter @cc/office-web dev     # http://127.0.0.1:5180
```

## Şirket

Üst çubuktaki **Şirket** görünümünden bir **koordinatör** işe alın (Claude veya Codex seçilebilir) ya da bir çalışanı koordinatör
yapın. Sonra yalnız koordinatörle konuşursunuz:

1. Ne istediğinizi yazın; koordinatör sohbette bir **plan kartı** açar (yaklaşım, kimler, görevler, tahmini kota/para/süre).
2. Tartışın; kart güncellenir. **Onayla** ile karar verin.
3. Koordinatör gerekirse çalışan alır (rol kartı, model ve karakter onun seçimi) ve görevleri dağıtır. Ofis her
   görevi, çalışanı boşa çıkınca sırayla verir; çalışanlar birbirine iş paslar ve teslim eder.
4. Şirket görünümünde örgüt şeması ve görev panosu canlı akar; koordinatör raporlarını sohbete yazar.

Çalışanlar ofis araçlarına (`taskFinish`, `taskPass`, `planPropose`, `hire`…) ofis sunucusunun `/mcp` adresinden,
her oturuma özel bir jetonla erişir.

## Şirket hafızası

Şirket unutmaz; hepsi veri klasöründe (`~/.control-center/company/` ve veritabanı) durur:

- **Karar defteri:** koordinatör ve ekip liderleri önemli seçimleri (ne, neden, alternatifler) kaydeder. Şirket
  görünümünün **Kararlar** sekmesinden bir kararı **Geri al**abilirsiniz; koordinatöre haber gider.
- **El kitabı:** çalışma yöntemleri konu konu, sürüm sürüm (`company/playbook/<konu>.md`).
- **Notlar:** herkesin öğrendiği; tam metin aranır. Bir teslimdeki "öğrendiklerim" de nota dönüşür.
- **Arşiv:** her teslimin dosyaları ve bir `teslim.md` (`company/archive/<plan>/<tarih>-<görev>/`).
- **Çalışan dosyası:** koordinatörün her çalışan hakkındaki notları ve bitirdiği işler (panelde "Çalışan dosyası").

**İşten çıkar** önce bir devir görevi verir: çalışan bildiklerini yazar, teslim edince ofis onu çıkarır ve açık işleri
koordinatöre döner. Beklemek istemezseniz **Hemen çıkar**.

## Bütçe ve anayasa

Şirket görünümünün **Anayasa** sekmesinde sınırları siz koyarsınız: en çok kaç çalışan, Claude kotasından size ayrılan
pay (varsayılan %25), aylık para sınırı, paslama ve görev sınırları, boştakilerin kaç dakika sonra uyuyacağı, özet
saatleri ve hangi işin hangi modelde koşacağı.

- **Sahibinin payı:** 5 saatlik ya da haftalık kullanım `100 − pay` sınırına gelince ofis yalnız öncelik 1 işleri
  başlatır, boştakileri uyutur ve koordinatöre haber verir; süren işler kesilmez, pencere açılınca kendiliğinden döner.
  Üst çubukta "Sahibinin payı korunuyor" yazar.
- **Haftalık durdurma sınırı (`weeklyStopPct`, varsayılan %90):** hesabın 7 günlük Claude kotası bu yüzdeye gelince
  ofis kendini duraklatır (gerekçesi akışta görünür, koordinatöre not düşer); o haftalık pencerede bir kez durur, siz
  sürdürürseniz o hafta yeniden durdurmaz. 0 kapatır. Sahibinin payından farkı: süren işleri bitirip tümden durur.
- **Para:** çalışanlar dış harcamayı `recordSpend` ile bildirir. Aylık sınır ya da planın onaylı parası aşılırsa uyarı
  çıkar ve koordinatör sahibine getirir. **Bütçe** sekmesi her planın harcadığını, Claude kullanımını ve onaylanan parayı
  yan yana gösterir.
- **Uyku:** işi olmayan çalışan bir süre sonra uyur (oturumu korunur); görevi gelince ya da siz yazınca uyanır.
- **Koordinatörün modelleri (anahtarsız):** koordinatörün her turu bir türdür, modeli türüne göre seçilir
  (`coordinatorModels`; Anayasa sekmesinde üç seçim): **Başlangıç** (fable) — süren plan yokken sizin mesajınız, ya da
  panosu aktif hedef olmadığını veya bir hedefin süren planı olmadığını söyleyen yönetim turu; **Yönetim turu** (opus) —
  diğer yönetim turları; **Sıradan** (sonnet) — geri kalan her tur (notlar, bir çalışanın önerisi, inceleme
  yönlendirmesi, plan sürerken sizin mesajınız). Bunlar rol modelidir: model politikası kapalıyken de uygulanır, geçiş
  kuralı aşağıdakiyle aynıdır. Yönetim turu kaydı (`management.cycle`) turun koştuğu modeli yazar.
- **Ofis ekonomisi (anahtarlı, varsayılan kapalı):** Anayasa sekmesinde üç anahtar var, üçü de varsayılan
  kapalı. Kapalıyken ofis eskisi gibi çalışır (main ile birebir — koordinatörün tur modelleri dışında; senaryo testi,
  koordinatörün her tür için kendi modelinde olduğu günü main'de kaydedilmiş mesaj ve olaylarla karşılaştırır).
  - `digestEnabled` — **notlar ve özet:** karar gerektiren notlar (plan onayı, takılma, öneri…) hemen bir tur açar;
    yalnız bilgi olanlar (teslimler, rol değişikliği…) bir sonraki tura biner ya da **özet saatlerinde**
    (`digestHours`, varsayılan 9 ve 17) tek turda gelir. Günlük rapor hatırlatması son özetle gelir. Koordinatöre
    bilgiler yönetim panosuyla gelir; onun için özet yalnız günlük rapor içindir.
  - `modelPolicyEnabled` — **model ipuçları:** açıkken çalışanların model ipuçları uygulanır (görev zorluğunun modeli,
    görevler arasında kendi modeli); kapalıyken herkes kendi modelinde çalışır (koordinatörün tur modelleri yine
    uygulanır). Model değişiminde süreç kapanıp `--resume --model` ile yeniden açılır (hafıza sürer). Daha güçlü modele
    hemen, daha zayıfa yalnız son turdan `cacheTtlMinutes` (5 dk) sonra geçilir. Not: Claude Code oturumun önbelleğini
    bir saat tutar; `cacheTtlMinutes` yalnız ofisin "ne zaman ucuz modele geçilir" kuralıdır, CLI'nin önbellek süresini
    değiştirmez. Yönetim turunun kalp atışı 45 dakikadır (saatin içinde, önbellek sıcak kalır). Panosu değişmeyen turu
    atlama mekanizması var ama kapalı (`maxSkips` 0): koordinatörün bütün konuşması tek oturumda olduğundan atlanan
    turdan sonra açılan tur soğuk (≈ 3 $) olur, boş sıcak turlardan (≈ 0,25 $) pahalıdır. Hesabın kullanamadığı bir modelde
    oturum eski modelle sürer ve mesaj yeniden gönderilir (`model.switch.failed`).
  - `difficultyModelsEnabled` — **görev zorluğu:** görevlerin bir zorluğu olabilir (`taskCreate`/`taskPass`/
    `taskAssign` → `difficulty`: kolay, orta, zor, kritik); görev başlarken çalışan o zorluğun modeline geçer
    (`difficultyModels`: haiku, sonnet, opus, fable), görev ortasında asla. Görev modeli yalnız o görev içindir:
    çalışanın kendi modeli (`setModel`) zorluksuz görevde, yan soruda ve sizin mesajınızda kullanılır. Kritik işi yalnız
    koordinatör ve liderler açar.
  - Uyandırma değişmedi: üyeyi not uyandırmaz, koordinatörü ve lideri uyandırır.
- Koordinatör `budgetStatus` ile bütçeyi ve bugün kimin kaç tur kullandığını görür, `setModel` ile birinin modelini
  değiştirir, `sleep`/`wake` kullanır. Ölçüm: `docs/superpowers/notes/2026-10-07-economy-results.md`.
- **Ölçüm ve yayın:** `pnpm economy-report --since 2026-10-07` (salt okunur; `--db`, `--until`) kabul belgesinin
  metriklerini canlı veriden yazar; `node apps/office-server/scripts/migration-rehearsal.ts --from <yedek>` göçleri bir
  kopyada prova eder. Kabul ve yayın: `docs/superpowers/notes/economy-acceptance.md`, `economy-release-runbook.md`.

## Koordinatörlük yetisi

Koordinatör işi nasıl yöneteceğini bilerek gelir; bu bilgi ürünün parçasıdır (`apps/office-server/src/company/craft/`),
her şirkette aynıdır ve şirketin el kitabına yazılmaz. El kitabında yalnız o şirkete özgü kurallar durur.

- **Çekirdek** (`craft/coordination.md`): koordinatörün ve ekip liderlerinin rehberine her açılışta eklenir — önce
  yöntem, ölçülebilir bitti, yapan ≠ denetleyen, kanıt, inceleme turları, maliyet, geri alınamaz işler sahibinden geçer,
  değerlendirme, dürüst rapor. Herkesin rehberine kanıt ve inceleme kuralları (`craft/working.md`) eklenir.
- **İş türü yöntemleri** (`craft/methods/`): yazılım, içerik ve pazarlama, araştırma, müşteri ve satış, operasyon ve
  satın alma, genel. Her turda yüklenmez; `methodRead` ile gerektiğinde okunur.
- **Plan kartında yöntem:** her plan iş türünü, aşamaları (kim yapar, kim denetler) ve kalite kontrollerini taşır;
  yöntemsiz plan kabul edilmez. Kartta **Nasıl yapılacak** bölümü görünür.
- **İnceleme kapısı:** bir göreve `reviewer` verilirse teslim edilince kapanmaz, **İncelemede** sütununa geçer ve
  inceleyiciye bir inceleme görevi açılır. İnceleyici `reviewDecide` ile onaylar ya da bulgularıyla (kritik / önemli /
  küçük) geri gönderir; iş tur tur döner, üçüncü turda koordinatör karar verir. Kimse kendi işini onaylayamaz.
- **Kanıtla teslim:** `taskFinish` bitti tanımının her maddesi için bir kanıt ister; arşivdeki `teslim.md` madde–kanıt
  çiftlerini yazar.
- **Değerlendirme:** bir planın son görevi kapanınca koordinatör `planRetro` ile değerlendirir; şirkete özgü dersi el
  kitabına, her şirkete yarayacak yöntem önerisini `yöntem-önerisi` etiketli nota yazar.

## Proje yöneticisi ve yaşayan döngü

Koordinatör projenin proje yöneticisidir; proje sizin her adımı söylemenizi beklemeden döner.

- **Hedefler:** koordinatör şirket özetindeki misyondan hedefler koyar (`goalSet`): neden önemli olduğu ve ölçülebilir
  bitti tanımıyla. Aynı anda en fazla birkaç aktif hedef olur (Anayasa: "En fazla aktif hedef"). Şirket görünümünün
  **Hedefler** sekmesi her hedefi, nedenini, bitti tanımını ve planlarını gösterir.
- **Tam serbest (varsayılan):** koordinatör planlarını sizi beklemeden başlatır; kartta "Koordinatör başlattı" yazar.
  Anayasa'da **Tam serbest** kapatılırsa her plan yine sizin onayınızı bekler. Satın almalar, geri alınamaz işler ve
  bütçe sınırları her durumda sizdedir.
- **Yönetim turu:** ofisin kodu projeyi izler (model kullanmaz). İşin şekli değişince (teslim, inceleme kararı, biri
  boşa çıktı, plan ya da hedef durumu, kısıt, takılma) ve iş açıkken en geç 45 dakikada bir koordinatöre tek metinlik
  bir yönetim panosu gider; koordinatör planı gerçekle karşılaştırır, gerekeni değiştirir ve turu `cycleClose` ile
  gerekçesiyle kapatır. Eski nabız notları panonun bölümleridir: süren planı olmayan hedef, hiç görevi açılmamış onaylı
  plan, "Boşta kapasite uyarısı" saatinden (varsayılan 2) uzun süredir işsiz olanlar ("uzun süredir" işaretiyle), hiç
  hedef ve iş olmaması. Hedef ve açık iş yokken de tur "Nabız aralığı" saatte bir açılır (varsayılan 6; 0 kapalı).
  Değerli iş yoksa koordinatör iş icat etmez, `restUntil` ile gerekçesini yazıp dinlenir: dinlenme sürerken bu tur
  açılmaz, dinlenme bitince bir tur açılır; pano dinlenmeyi ve gerekçesini gösterir.
- **Anayasa değişince:** Anayasa sekmesinden bir sınırı değiştirdiğinizde koordinatör neyin değiştiğini eski → yeni
  olarak tek notta duyar (kota payınız "Ofisin kota sınırı %75 → %60" diye) ve süren planlarını yeni sınırlara göre
  gözden geçirir.
- **Sizin denetiminiz:** her süren planda ve her aktif hedefte **Durdur** (açık görevler iptal olur); üst çubukta
  **Şirketi duraklat / Sürdür** (duraklatılmışken ofis kimseye iş ve not vermez; siz yine yazabilirsiniz).

## Zamanlama ve ajanda

Ofis "bunu daha sonra yap" diyebilir. Herkes aynı anda tek görev yapar; beklemesi gereken bir iş artık kimsenin
sırasını kilitlemez.

- **Park:** bir pencerenin dolmasını ya da bir cevabı bekleyen görev `taskPark` ile park edilir: dönüş saati (`+30m`,
  `+6h`, `+1d` ya da yerel `2026-10-08T14:55`; en fazla 30 gün ileri) ve gerekçe. Görevi yapan kendi işini, koordinatör
  ve lider yönettiklerinin işini park eder ve `taskUnpark` ile hemen sıraya alır. Park edilen görev açık kalır ama sırayı
  boşaltır: ofis sıradaki işi verir, park edileni saatinde geri getirir. İncelemedeki ve devir görevleri park edilemez;
  aynı görev üçüncü kez ertelenince koordinatöre karar notu gider.
- **Başlangıç saati ve son tarih:** `taskCreate` ve `taskPass` görevi `startAfter` (o saatten önce verilmez) ve `dueAt`
  (son tarih; aynı öncelikte yakın olan önce gelir, geçince koordinatöre bir kez haber gider) ile açabilir.
- **Rutinler:** tekrarlayan iş `scheduleCreate` ile kurulur (cron, yerel saat; Türkçe gösterilir: "her gün 09:00",
  "hafta içi 18:00"). Her tetiklenme sıradan bir görev açar; inceleme kapısı, kanıt, kota payı ve duraklatma aynen
  uygulanır. Önceki örnek hâlâ açıksa yenisi açılmaz. Anayasa sınırları: **Rutin aralığı en az (dk)** (varsayılan 60) ve
  **En fazla rutin** (varsayılan 20). `scheduleList` ve `scheduleUpdate` koordinatör ve liderlerindir.
- **Saat:** ofisin tek zamanlayıcısı vadeleri veritabanından okur, en yakın vadeye (en geç 60 saniye sonraya) kurulur;
  14:55'in işi 14:55'te başlar. Ofis kapalıyken geçen vadeler açılışta, duraklatma boyunca kaçan rutinler sürdürülünce
  **bir kez** telafi edilir: park edilen görev bir kez sıraya döner, rutin tek bir görev açar. Duraklatılmışken park
  dönüşü sıraya girer ama kimseye verilmez. Uyku ya da saat değişimi olay kaydına not düşer.
- **Ajanda:** şirket görünümünün **Ajanda** sekmesi kimin ne zaman ne yaptığını gösterir (**Liste** ve **Zaman
  çizelgesi**, 24 saat / 7 gün); süreler çalışanın kendi geçmişinden tahmin edilir (`~`). Üstte sıradaki saatli iş
  yazar, altta **Rutinler** listesi durur. Çalışan panelinde de aynı kişinin ajandası vardır. Koordinatör ve liderler
  `agendaRead` ile kimin ne zaman boş olduğuna bakar.
- **Sizin düğmeleriniz:** **Şimdi başlasın** (park ya da başlangıç saatini kaldırır, öncelik 1), **Park et…** (+1 saat,
  +6 saat, yarın 09:00, yarın aynı saat ya da bir tarih-saat, gerekçeyle), **Öne al** (öncelik 1) ve rutinlerde
  **Duraklat / Sürdür / Durdur**. Her düğme koordinatöre bilgi notu bırakır.
- **Claude'un kendi zamanlayıcısı kapalı:** çalışan oturumları `--disallowedTools CronCreate CronDelete CronList
  ScheduleWakeup RemoteTrigger` ile açılır. Bu araçlar oturuma özeldir, ofisten görünmez ve duraklatmayı dinlemez;
  zamana bağlı her iş ofisin saatinden geçer.

## Öneriler ve ekip liderleri

- Çalışanlar **ihtiyaç**, **fikir**, **itiraz** ("yanlış yoldayız") ve **satın alma** taleplerini `propose` ile açar.
  Liderleri ya da koordinatör karara bağlar (karar defterine yazılır) ya da büyükse size getirir. **Satın almalar her
  zaman size gelir**: Şirket görünümünün **Öneriler** sekmesinde (ve koordinatörün sohbetinde) Onayla / Reddet. Şirket
  düğmesindeki sayı sizi bekleyen plan ve talepleri gösterir.
- `askColleague`: bir çalışan arkadaşına onu bölmeden soru sorar.
- Bir ekip büyüyünce koordinatör `appointLead` ile ekip lideri atar; lider kendi ekibine iş açar ve dağıtır, etiketinde
  ★ görünür.
- Bir revizyonu reddederseniz plan onaylı sürümüyle sürer. Koordinatör her gün kısa bir özet raporlar; okunmamış rapor
  etiketinde 📋 olarak görünür. Koordinatör sizinle plan konuşurken toplantı odasına geçer.

## office-server

Gereken: Node 24+, pnpm 9, giriş yapılmış `claude` CLI.

```bash
pnpm install
pnpm --filter @cc/office-server start     # http://127.0.0.1:4319, veri: ~/.control-center
pnpm test                                  # sahte claude ile tüm testler
pnpm --filter @cc/office-server smoke      # gerçek claude (Haiku) ile duman testi
```

Ortam değişkenleri: `OFFICE_DATA_DIR` (repo içinde olamaz), `OFFICE_PORT`, `OFFICE_ALLOWED_ORIGINS`
(virgülle), `OFFICE_CLAUDE_COMMAND` (JSON dizi).

Çalışanlar onay istemeden ve sahibinin bütün bağlantılarıyla çalışır; ofis API'si yalnızca
`127.0.0.1`'den ve izin verilen kaynaklardan gelen istekleri kabul eder. Sahibine ait değiştiren uçlar
(`/api/` altında GET dışı her istek) yalnızca ofis sayfasından gelen isteği kabul eder: Origin ve sayfanın aldığı
anahtar (nonce) gerekir, `curl` ile yapılan denemeler olay kaydında işaretlenir. Bu bir tespit ve engel; aynı Unix
kullanıcısındaki bir süreç için güvenlik sınırı değildir. Sınırı ve gerçek ayrım için öneri:
[docs/security/owner-endpoints.md](docs/security/owner-endpoints.md).
