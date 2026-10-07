# control-center

Claude Code oturumlarını rol tanımı verilmiş çalışanlar olarak, canlı bir 3D ofiste çalıştıran platform.
Tasarım: `docs/superpowers/specs/2026-10-06-office-v1-design.md`.

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

Üst çubuktaki **Şirket** görünümünden bir **koordinatör** işe alın (Fable ile çalışır) ya da bir çalışanı koordinatör
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
- **Para:** çalışanlar dış harcamayı `recordSpend` ile bildirir. Aylık sınır ya da planın onaylı parası aşılırsa uyarı
  çıkar ve koordinatör sahibine getirir. **Bütçe** sekmesi her planın harcadığını, Claude kullanımını ve onaylanan parayı
  yan yana gösterir.
- **Uyku:** işi olmayan çalışan bir süre sonra uyur (oturumu korunur); görevi gelince ya da siz yazınca uyanır.
- **Ofis ekonomisi (anahtarlı, varsayılan kapalı):** Anayasa sekmesinde üç anahtar var, üçü de varsayılan
  kapalı. Kapalıyken ofis eskisi gibi çalışır (main ile birebir; senaryo testi main'de kaydedilmiş mesaj ve olaylarla
  karşılaştırır).
  - `digestEnabled` — **notlar ve özet:** karar gerektiren notlar (plan onayı, takılma, öneri…) hemen bir tur açar;
    yalnız bilgi olanlar (teslimler, rol değişikliği…) bir sonraki tura biner ya da **özet saatlerinde**
    (`digestHours`, varsayılan 9 ve 17) tek turda gelir. Günlük rapor hatırlatması son özetle gelir.
  - `modelPolicyEnabled` — **model seçimi:** koordinatörün modeli turun ne için olduğuna göre seçilir
    (`coordinatorModels`): sizin mesajınız sonnet (koordinatörün kendi modelinden aşağı değil; isterseniz fable
    yapın), karar notu sonnet, yalnız özet haiku. Model değişiminde süreç kapanıp `--resume --model` ile yeniden açılır
    (hafıza sürer). Daha güçlü modele hemen, daha zayıfa yalnız son turdan `cacheTtlMinutes` (5 dk) sonra geçilir.
    Hesabın kullanamadığı bir modelde oturum eski modelle sürer ve mesaj yeniden gönderilir (`model.switch.failed`).
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
`127.0.0.1`'den ve izin verilen kaynaklardan gelen istekleri kabul eder.
