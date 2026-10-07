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
- **Notlar ve özet:** karar gerektiren notlar (plan onayı, takılma, öneri…) hemen bir tur açar; yalnız bilgi olanlar
  (teslimler, rol değişikliği…) bir sonraki tura biner ya da **özet saatlerinde** (`digestHours`, varsayılan 9 ve 17)
  tek turda gelir. Günlük rapor hatırlatması son özetle gelir.
- **Model seçimi:** koordinatörün modeli turun ne için olduğuna göre seçilir (`coordinatorModels`: sizin mesajınız
  fable, karar notu sonnet, yalnız özet haiku). Görevlerin bir **zorluğu** olabilir (`taskCreate`/`taskPass`/
  `taskAssign` → `difficulty`: kolay, orta, zor, kritik); görev başlarken çalışan o zorluğun modeline geçer
  (`difficultyModels`: haiku, sonnet, opus, fable), görev ortasında asla. Model değişimi oturumu yeniden açar ve önbelleği
  soğutur: daha güçlü modele hemen geçilir, daha zayıfa yalnız son turdan `cacheTtlMinutes` (varsayılan 5) sonra —
  sohbet modeller arasında gidip gelmez; görev başı istisnadır. Görev modeli yalnız o görev içindir: çalışanın kendi
  modeli (`setModel` ile değişir) zorluksuz görevde, yan soruda ve sizin mesajınızda kullanılır. Kritik işi yalnız
  koordinatör ve liderler açar.
- Koordinatör `budgetStatus` ile bütçeyi ve bugün kimin kaç tur kullandığını görür, `setModel` ile birinin modelini
  değiştirir, `sleep`/`wake` kullanır. Ölçüm: `docs/superpowers/notes/2026-10-07-economy-results.md`.
- **Kapatma anahtarları:** `digestEnabled`, `modelPolicyEnabled`, `difficultyModelsEnabled` (Anayasa sekmesi) her
  özelliği tek tek eski davranışa döndürür.
- **Ölçüm ve yayın:** `pnpm economy-report --since 2026-10-07` (salt okunur; `--db`, `--until`) kabul belgesinin
  metriklerini canlı veriden yazar; `node apps/office-server/scripts/migration-rehearsal.ts --from <yedek>` göçleri bir
  kopyada prova eder. Kabul ve yayın: `docs/superpowers/notes/economy-acceptance.md`, `economy-release-runbook.md`.

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
