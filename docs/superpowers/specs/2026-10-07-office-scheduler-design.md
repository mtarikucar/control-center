# control-center — Ofis zamanlayıcısı ve ajanda tasarımı

- Tarih: 2026-10-07
- Durum: sahibiyle konuşmada beş bölüm halinde onaylandı (genel mimari, zamanlama modeli, saat servisi, ajanda ve
  sheet, araçlar ve kilit); uygulandı (`feat/office-scheduler`) — plan
  `docs/superpowers/plans/2026-10-07-office-scheduler.md` ve `…-part-2.md`; kilit ve park gerçek CLI ile denendi
  (`lockdown.real`, `scheduler.smoke.real`). Tasarım ve plan Fable'da, uygulama Opus'ta.
- Dayandığı: `2026-10-06-company-design.md` (şirket katmanı), `2026-10-07-coordinator-craft-design.md` (koordinatörlük
  yetisi, nabız, duraklatma), `office-economy` (bildirim türleri, kota payı). Göç v10.

## 1. Amaç

Bugün ofis "bir şeyi daha sonra yap" diyemiyor. Zamana bağlı her iş (bir ölçüm penceresinin dolmasını beklemek, yarın
tekrar sormak, her gün bir kontrol yapmak) ya açık bir görev olarak kişinin sırasını kilitliyor ya da unutuluyor. İlk
canlı günde tam bu oldu: koordinatör "ekonomi adım 1 penceresi: yarın 14:55'e kadar izle" görevini açık tuttu; ofis
herkese aynı anda tek görev verdiği için diğer bütün işleri bir gün bekledi, ve takılan kişi koordinatörün kendisi
olduğu için kimseye haber gitmedi.

Claude Code'un kendi zamanlayıcısı (`CronCreate`, `/loop`, `/schedule`) başsız oturumlarda çalışıyor (denendi: kurulan
tek seferlik hatırlatma dakikasında yeni bir tur açtı) ama ofis için uygun değil: oturuma özeldir ve süreç kapanınca
ölür ("Session-only, not written to disk, dies when Claude exits"); ofis süreçleri uyutma, model değişimi, çökme ve
yeniden başlatmayla sık sık kapatır; dışarıdan görünmez; ofisin kurallarını (duraklatma, kota payı, tek görev, inceleme
kapısı) atlar. Bulut rutinleri ise başka bir oturumda, en sık saatte bir çalışır ve yerel ofise dokunamaz.

Bu belge ofise **kendi zamanlamasını** verir. Başarı ölçütü:

1. Bekleyen bir iş kimsenin sırasını kilitlemez: park edilen görev kişinin tek görev kuralını işgal etmez.
2. Zaman kuralları yeniden başlatmada kaybolmaz, yinelenmez; kaçırılan zaman tek seferde telafi edilir.
3. Sahibi her çalışanın "ne zaman ne yapacağını" bir **sheet**'te görür ve oradan birkaç düğmeyle müdahale eder.
4. Ofisin bütün kuralları zamanlı işlerde de aynen geçerlidir: duraklatma, kota payı, tek görev, inceleme kapısı, kanıt.
5. Çalışanlar Claude'un kendi zamanlayıcısını kullanamaz; zamana bağlı her iş ofisten geçer.
6. Ekonomi bozulmaz: beklemek tur açmaz; rutinlerin sıklığı ve sayısı anayasayla sınırlıdır; ajanda model kullanmaz.

## 2. Sahibinin kararları

| Konu | Karar |
|---|---|
| Nerede yaşar | Ofisin **kendi zamanlayıcısı**; Claude'un oturum içi zamanlayıcısı ve bulut rutinleri kullanılmaz, çalışanlarda kapatılır. |
| Mimari | Tek süreçte, her biri tek iş yapan ve tanımlı arayüzlerle konuşan servisler (Saat, Zamanlama, Ajanda; mevcut Dağıtım ve Nabız). Ayrı süreç/mikroservis değil. |
| Sheet | Ofisin içinde canlı görünüm: Şirket görünümünde **Ajanda** sekmesi ve her çalışanın panelinde kendi ajandası. Dış tablo dosyası yok. |
| Müdahale | İzle ve birkaç düğme: **Şimdi başlasın**, **Park et…**, **Öne al**; rutinlerde **Duraklat / Sürdür / Durdur**. Asıl planlamayı koordinatör yapar; sahibinin değişikliği ona not olarak gider. |
| Kritiklik | Kritik altyapı: her zaman kuralı veritabanında; her geçiş atomik ve tekrar çalışsa zararsız; her vadesi gelen iş kendi korumasında. |

## 3. Genel mimari

```
                 ┌──────────────── Saat servisi ────────────────┐
                 │ tek zamanlayıcı; vadeleri veritabanından okur │
                 │ en yakın vadeye (en geç 60 sn) kurulur        │
                 └──────┬───────────────┬───────────────┬────────┘
            vadesi gelen│          güvenlik turu│         iç işler│
                        ▼                       ▼                ▼
   ┌─ Zamanlama servisi ─────┐      ┌─ Dağıtım servisi ─┐   ┌─ Nabız, kota, rapor,
   │ park · başlangıç saati  │      │ (mevcut dağıtıcı)  │   │ boşta uyutma (mevcut)
   │ son tarih · rutinler    │─tara▶│ "bu görev şimdi    │   └────────────────────
   │ tek doğru kaynak: DB    │◀sor──│  verilebilir mi?"  │
   └──────────┬──────────────┘      └────────────────────┘
              │ durum
              ▼
   ┌─ Ajanda servisi (yalnız okur) ─────────────────────────────────┐
   │ çalışan başına "ne zaman ne yapacak": şimdi, sırada, park, rutin │
   │ → sheet (Ajanda sekmesi, çalışan paneli) ve agendaRead aracı     │
   └────────────────────────────────────────────────────────────────┘
```

- **Saat servisi** (`company/clock.ts`): ofisteki tek zamanlayıcı. Bugün dağınık duran zamanlı işler (dağıtıcının 60
  saniyelik turu, kota kontrolü, nabız, rapor hatırlatması, boşta uyutma) buraya bağlanır; davranışları değişmez.
- **Zamanlama servisi** (`company/scheduling.ts`): park, başlangıç saati, son tarih ve rutinlerin kuralları; vadesi
  gelenleri işler. Zamanla ilgili tek doğru kaynak veritabanıdır.
- **Dağıtım servisi** (mevcut `dispatcher.ts`): kuralları aynen sürer; tek fark, vadesi gelmemiş görevi vermez ve
  `parked` görevi açık ama teslim edilmez sayar.
- **Ajanda servisi** (`company/agenda.ts`): hiçbir şeyi değiştirmez; sheet'i ve `agendaRead` aracını besler.
- **Kilit**: çalışan oturumlarında Claude'un zamanlayıcı araçları kapalıdır (§8).

## 4. Zamanlama modeli

Dört yapı taşı; hepsi veritabanında, bellekte tutulan zaman bilgisi yok.

### 4.1 Başlangıç saati (`notBefore`)

Görev açılırken (`taskCreate`, `taskPass`: `startAfter`) isteğe bağlı. Görev `waiting` durumunda sırada görünür ama
saati gelene kadar teslim edilmez. Takip işleri ("yarın tekrar sor") bununla çözülür; ayrı yapı yoktur.

### 4.2 Park etme

- Yeni görev durumu **`parked`** ("Ertelendi"). Açık sayılır: plan bitmez, iş kaybolmaz; ama kişinin **tek görev
  kuralını işgal etmez** (bu, bugünkü kilitlenmenin çözümü).
- Kim: görevi yapan (kendi işi), koordinatör ve lider (yönettikleri), sahibi (sheet'ten).
- Zorunlu: dönüş saati (`until`: yerel saat `2026-10-08T14:55` ya da göreli `+30m`, `+6h`, `+1d`; en fazla 30 gün) ve
  **gerekçe** (sheet'te görünür).
- Saati gelince görev kendiliğinden `waiting` olur; önceliği korunur; ofis normal kurallarla teslim eder (uyuyan kişiyi
  uyandırır). `not_before` dönüş saatidir; `parked_reason` gerekçe.
- Park edilemez: `review` durumundaki görev (karar inceleyicinin), `handover` türü, kapalı görevler. İnceleme görevleri
  (tür `review`) park edilebilir; asıl görev incelemede kalır.
- Süren bir görevi başkası (koordinatör, lider, sahibi) park ederse yapana `task.parked` karar notu gider ("üzerinde
  çalışmayı bırak; saatinde geri gelecek").
- **Sonsuz erteleme freni:** `park_count` her parkta artar; üçüncü parkta koordinatöre karar notu `task.reparked`
  ("bu iş sürekli erteleniyor: gerçek bir iş mi, bölünmeli mi, iptal mi?").

### 4.3 Son tarih (`dueAt`)

İsteğe bağlı. Sıralama: aynı öncelikte son tarihi yakın olan öne geçer (`priority`, sonra `due_at` boş olanlar sona,
sonra eskilik). Tarih geçince koordinatöre bir kez `task.overdue` bilgi notu (`overdue_notified`); sheet kırmızı gösterir.
Başka bir etkisi yoktur; ne yapılacağına insan karar verir.

### 4.4 Rutinler (tekrarlayan işler)

- Yeni tablo **`schedules`**: başlık, açıklama, bitti tanımı, atanan, inceleyici, plan, öncelik, zorluk, **cron** (5
  alan, yerel saat; sheet Türkçe gösterir: "her gün 09:00", "hafta içi 18:00"), isteğe bağlı bitiş (`until`), durum
  (`active` / `paused` / `stopped`), sıradaki ve son çalışma, son görev, atlama ve hata sayacı.
- Her tetiklenme **sıradan bir görev** açar (`schedule_id` bağıyla, başlık "<rutin>: <tarih saat>"). İnceleme kapısı,
  kanıt, kota payı, duraklatma ve tek görev kuralı rutin görevlerine aynen uygulanır.
- **Yığılma freni:** önceki örnek hâlâ açıksa yenisi açılmaz; `skip_count` artar, rutine not düşer; üçüncü atlamada
  koordinatöre `schedule.skipped` karar notu.
- **Kaçırılan tetiklenme:** ofis kapalıyken ya da duraklatılmışken geçen zamanlar için **tek telafi**: bir görev açılır,
  sıradaki vade **şimdiden** sonrasına hesaplanır.
- **Anayasa sınırları:** `minScheduleMinutes` (varsayılan 60; cron'un ardışık iki tetiklenmesi bundan sık olamaz),
  `maxSchedules` (varsayılan 20; `stopped` sayılmaz).
- Plan durdurulursa rutinleri `stopped` olur. Atanan işten çıkarsa rutin `paused` olur, koordinatöre `schedule.unassigned`
  karar notu gider. Bitiş tarihi geçince `stopped`.

### 4.5 Mevcut kurallarla uyum

| Kural | Zamanlı işte |
|---|---|
| Duraklatma | Saat gelince durum değişir (park → bekliyor) ama teslim olmaz; rutinler duraklatma boyunca görev açmaz, sürdürülünce tek telafi. |
| Kota payı | Teslim dağıtım servisinin kuralıyla (yalnız öncelik 1); zamanı gelmiş olmak öncelik vermez. |
| İşten çıkarma | `parked` görevler de `waiting` olup koordinatöre döner (başlangıç saati korunur). |
| Plan durdurma | `parked` görevler de iptal; planın rutinleri `stopped`. |
| İnceleme kapısı | Rutin görevleri inceleyiciyle açılır; park edilmiş görevin incelemesi değişmez. |
| Devir | Devir görevi park edilemez; işten çıkarılan kişinin park edilmiş işleri açık işler gibi devredilir. |

## 5. Saat servisi

**Çalışma**
- Bellekte vade tutmaz. Her kurulumda veritabanına sorar: en yakın vade = min(park dönüşleri, başlangıç saatleri, aktif
  rutinlerin `next_run_at`, henüz bildirilmemiş son tarihler, iç işlerin sıradaki zamanı).
- Tek zamanlayıcı: en yakın vadeye, en geç 60 saniye sonraya (güvenlik turu). Uyanınca `runDue(now)` → vadesi gelenleri
  işler → dağıtım servisine "tara" der.
- Zaman değiştiren her işlem (park, başlangıç saatli görev, rutin ekleme/değiştirme, duraklat/sürdür) `clock.touch()`
  çağırır; saat yeniden kurulur. 14:55'in işi 14:55'te başlar, 15:00'ı beklemez.
- İç işler saate kayıtlıdır: `every(60 sn)`: kota kontrolü, rapor hatırlatması (özet kapalıyken), nabız, boşta uyutma,
  dağıtım taraması. Testlerdeki `tickMs` korunur.

**Yeniden başlatma ve telafi**
- Açılışta ilk iş `runDue(now)`: kapalı kalınan sürede vadesi geçmiş her şey tek seferde işlenir.
- Telafi kuralı **tek seferde, bir kez**: park edilmiş görev bir kez `waiting` olur; rutin bir görev açar ve sıradaki
  vadeyi şimdiden sonrasına yazar; son tarih bir kez bildirilir.
- Her geçiş atomiktir: `UPDATE tasks SET status='waiting', not_before=NULL WHERE id=? AND status='parked' AND
  not_before<=?`. İki kez çalışsa ikinci kez bir şey yapmaz. Rutin tetiklemesi (görev aç + `next_run_at`/`last_run_at`
  yaz) tek veritabanı işlemidir (`BEGIN IMMEDIATE … COMMIT`); yarım kalmaz, iki kez açmaz.

**Saat atlamaları**
- Uyku/uyanma ve saat değişimi: zamanlayıcı geç uyanır; güvenlik turu en geç 60 saniyede vadesi geçenleri işler.
- Beklenen uyanışla gerçek arasında 2 dakikadan fazla fark → olay kaydına `clock.jumped` (yalnız kayıt),
  `company_state.clock.lastJumpAt`.
- Rutinler yerel saatle hesaplanır (makinenin saat dilimi). Cron "sıradaki" hesabı yerel `Date` alanlarıyla dakika dakika
  ilerler: yaz saatinde var olmayan saat atlanır; iki kez gelen saat **en fazla bir kez** tetikler (sıradaki vade
  tetiklemeden sonra hesaplanır).

**Hata yalıtımı**
- Vadesi gelen her iş kendi `try/catch`'inde; hata olay kaydına yazılır (`clock.error`, iş adı ve mesaj), iş atlanır,
  saat durmaz.
- Rutin üst üste 3 kez görev açamazsa (`fail_count`) `paused` olur, koordinatöre `schedule.failed` karar notu gider.

**Görünürlük**
- `company_state`: `clock.lastRunAt`, `clock.lastJumpAt`. Ofis görüntüsünde `clock: { nextDueAt, nextDueLabel, lastRunAt,
  lastJumpAt }`. Sheet'in üstünde: "Sıradaki vade 14:55 — Adım 1 penceresi (Koordinatör)".
- Olay kaydına yalnız bir şey tetiklendiğinde yazılır (`task.changed` dönüş, `schedule.fired`); boş turlar kayıt üretmez.

**Test edilebilirlik:** saat `now()` ve `setTimeout/clearTimeout`'u dışarıdan alır; testler zamanı ileri sararak
deterministik doğrular, gerçek bekleme yoktur.

## 6. Ajanda servisi ve sheet

### 6.1 Ajanda servisi (yalnız okur)

Her çalışan için "şimdiden ileriye" sıralı girdiler (ufuk 7 gün):

| Girdi | İçerik |
|---|---|
| Şimdi | süren görev; başladığı saat, tahmini bitiş; tahmini aştıysa "uzuyor" |
| Sırada | bekleyen görevler, teslim sırasıyla (öncelik → son tarih → eskilik); zincirleme tahmini başlangıç/bitiş; bağımlılığı bitmemişse "X bitince" (düşük güven; X'in tahmini bitişinden) |
| İnceleme bekliyor | teslim ettiği, kararı başkasında olan işler ("Can'da, tur 2") |
| Park | dönüş saati ve gerekçe |
| Başlangıç saatli | saatinde |
| Rutin | sıradaki çalışma saatleri (ufuk içinde en çok 3) |
| Durum | uyuyor / kota payı devrede (yalnız öncelik 1) / şirket duraklatıldı / limit doldu (açılış saati) |

**Süre tahmini:** çalışanın son 10 bitmiş `work` görevinin ortanca süresi (`finished_at − started_at`); görevin zorluğu
varsa ve o zorlukta en az 3 örnek varsa zorluğa göre; örnek yoksa ofis geneli; o da yoksa anayasa `defaultTaskMinutes`
(45). İnceleme görevleri için inceleme sürelerinin ortancası (yoksa 15 dk). Tahmin `~` ile ve dayanağıyla gösterilir
("~45 dk · son 10 iş" / "varsayılan"). Kota payı ve duraklatma tahmine girmez; durum satırı uyarır.

**Ulaşım:** `GET /api/agenda` → `{ generatedAt, horizonMs, clock, employees: [{ id, name, state, entries }] }`. Web,
açılışta ve ilgili olaylarda (`task.changed`, `plan.changed`, `schedule.changed`, `lifecycle.changed`, `budget.changed`,
`company.paused`) 1 sn gecikmeyle yeniden çeker; ajanda türetilmiş veridir, ayrıca yayınlanmaz. MCP `agendaRead(employee?)`
(koordinatör, lider): aynı bilgi Türkçe metin.

### 6.2 Sheet

- Şirket görünümünde **Ajanda** sekmesi: satır başına bir çalışan; **Liste** (varsayılan: saat | iş | durum | düğmeler)
  ve **Zaman çizelgesi** (24 saat / 7 gün yatay bloklar) görünümleri. Üstte saat satırı ve uyarılar (duraklatma, kota
  payı).
- Çalışan panelinde **Ajanda** bölümü: aynı girdiler, o kişi için.
- Renk: süren mavi, park gri (dönüş saati + gerekçe), geciken kırmızı, tahminler `~`.

### 6.3 Sahibinin düğmeleri

| Düğme | Nerede | Etkisi |
|---|---|---|
| Şimdi başlasın | sırada / park / başlangıç saatli | park ya da başlangıç saatini kaldırır, öncelik 1; süren, incelemedeki, devir görevlerinde yok |
| Park et… | bekleyen / süren / takılan | dönüş saati (hazır: +1 sa, +6 sa, yarın 09:00, yarın aynı saat, tarih-saat) + gerekçe (varsayılan "Sahibi erteledi"); süren işte çalışana "bırak" notu |
| Öne al | bekleyen | öncelik 1, saat değişmez |
| Duraklat / Sürdür / Durdur | rutin | rutin durumu |

Her düğme koordinatöre bilgi notu bırakır (`agenda.owner_changed`: "Sahibi “X”i yarın 09:00'a erteledi: …") ve sohbet
akışına yazılır.

API: `POST /api/tasks/:id/park {until, reason}`, `POST /api/tasks/:id/release`, `POST /api/tasks/:id/prioritize
{priority}`, `POST /api/schedules/:id/(pause|resume|stop)`, `GET /api/agenda`.

## 7. Araçlar

| Araç | Kim | Değişiklik |
|---|---|---|
| `taskPark(taskId, until, reason)` | yapan (kendi işi); koordinatör/lider (yönettikleri) | yeni; cevap çözümlenmiş yerel saati söyler |
| `taskUnpark(taskId)` | koordinatör/lider | yeni; park edilmiş görevi hemen sıraya alır |
| `taskCreate`, `taskPass` | mevcut | `startAfter`, `dueAt` (aynı `until` biçimleri) |
| `scheduleCreate(title, description, done, assignee, cron, reviewer?, planId?, priority?, difficulty?, until?)` | koordinatör; lider kendi ekibine | yeni |
| `scheduleList()` | koordinatör/lider | yeni; cron'u Türkçe de yazar |
| `scheduleUpdate(id, {status?, cron?, assignee?})` | koordinatör/lider | yeni |
| `agendaRead(employee?)` | koordinatör/lider | yeni |

Rehber (ürünle gelen craft metinleri): herkese "bekleyeceğin işi açık bırakma; `taskPark` ile saat ve gerekçe ver.
Claude'un kendi zamanlayıcısı bu ofiste kapalıdır"; koordinatöre ve lidere zamana bağlı işin üç yolu (başlangıç saati,
park, rutin), `agendaRead` ile kim ne zaman boş, rutinleri az tut (her biri kota yer), izleme pencereleri için park et.
`pm.md`'deki nabız maddesine: "bir pencere bekliyorsan görevi park et".

## 8. Kilit

Ofis her çalışan oturumunu açarken `--disallowedTools CronCreate CronDelete CronList ScheduleWakeup RemoteTrigger`
verir (`claude/args.ts`); araçlar listeden çıkar. Plan, gerçek CLI ile bir deneme içerir: oturumun açılış kaydındaki araç
listesinde bunlar görünmemeli. (Bugünkü açık: bir çalışan kendine zamanlayıcı kurarsa "Şirketi duraklat" onu durdurmaz.)

## 9. Veri modeli (göç v10, geri alınabilir, gidiş-dönüş testli)

- `tasks`: `not_before INTEGER`, `due_at INTEGER`, `parked_reason TEXT`, `park_count INTEGER NOT NULL DEFAULT 0`,
  `schedule_id TEXT`, `overdue_notified INTEGER NOT NULL DEFAULT 0`; durum metnine `parked`.
- `schedules`: `id, title, description, done (JSON), assignee, reviewer, plan_id, priority, difficulty, cron, until,
  status, next_run_at, last_run_at, last_task_id, skip_count, fail_count, created_by, created_at, note`; indeks
  `(status, next_run_at)`.
- `company_state`: `clock.lastRunAt`, `clock.lastJumpAt`.
- Anayasa: `defaultTaskMinutes` (45, 5–480), `minScheduleMinutes` (60, 1–1440), `maxSchedules` (20, 0–100).
- Paylaşılan tipler: `TaskStatus` + `parked`; `Task.notBefore/dueAt/parkedReason/parkCount/scheduleId`; `Schedule`,
  `ScheduleStatus`, `ScheduleChange`; olaylar `schedule.changed`, `schedule.fired`, `clock.jumped`, `clock.error`;
  görüntüde `schedules`, `clock`.

## 10. Hata durumları

| Durum | Davranış |
|---|---|
| İncelemedeki, devir ya da kapalı görevi park etme | Türkçe hata; hiçbir şey değişmez. |
| Geçmiş saat, 30 günden ileri ya da anlaşılmayan `until` | Hata, biçim örneğiyle (`2026-10-08T14:55`, `+6h`). |
| Geçersiz cron ya da `minScheduleMinutes`'tan sık | Hata, sınırı söyler. |
| Rutin sayısı `maxSchedules`'ta | Hata: "önce birini durdur". |
| Rutinin atananı işten çıktı | Rutin `paused`, koordinatöre `schedule.unassigned`. |
| Rutin üst üste 3 kez görev açamadı | `paused` + `schedule.failed`. |
| Önceki rutin görevi hâlâ açık | Yeni görev yok, `skip_count`; 3. atlamada `schedule.skipped`. |
| Vadesi gelen bir iş hata verdi | `clock.error` kaydı, atla, saat durmaz. |
| Park edilmiş görevin planı durduruldu | Görev iptal. |
| Sahibi bağımlılığı bitmemiş işe "şimdi başlasın" dedi | Öncelik 1 olur, bağımlılık bitene kadar bekler; sheet "X bitince" der. |
| Ajanda tahmini için örnek yok | Varsayılan süre, "varsayılan" etiketiyle. |
| Saat atladı | `clock.jumped` kaydı; vadesi geçenler güvenlik turunda işlenir. |

## 11. Ekonomi

Park ve bekleme tur açmaz; dönüş teslimi normal bir teslimdir. Rutinler anayasayla sınırlı (sıklık, sayı) ve her biri
sıradan görev olduğu için zorluk modeli ve kota payı kuralları uygulanır. Ajanda sunucuda hesaplanır, model kullanmaz;
`agendaRead` yalnız istenince bir araç çağrısıdır. Saat yalnız tetiklediğinde kayıt yazar. Sahibinin düğmeleri
koordinatöre **bilgi** notu bırakır (özete girer, tur açmaz); `task.parked`, `task.reparked`, `schedule.*` **karar**
notlarıdır (iş gerektirir).

## 12. Test

- Birim: `until` ayrıştırma; cron doğrulama ve "sıradaki" hesabı (yaz saati dahil); park kuralları ve fren; rutin
  yığılma freni; telafi; tahmin (ortanca, zorluk, varsayılan); göç gidiş-dönüş (eski görevler `park_count 0`, boş saatler).
- Saat, sahte zamanla: park dönüşü tam saatinde; rutin tetiklemesi ve sıradaki vade; yeni Saat aynı veritabanında tek
  telafi; saat atlaması kaydı; hata yalıtımı; `touch` ile yeniden kurulma.
- Ofis: park edilen süren iş sırayı boşaltır ve sıradaki teslim edilir; dönüş uyuyan çalışanı uyandırır; duraklatmada
  durum değişir, teslim olmaz; işten çıkarma ve plan durdurma park edilmişleri kapsar; son tarih sıralaması ve `task.overdue`.
- API ve web: `/api/agenda`, düğme uçları; Ajanda sekmesi (liste, zaman çizelgesi), çalışan paneli bölümü, düğmeler ve
  koordinatör notu; `schedules` ve `clock` görüntüde.
- Gerçek claude (isteğe bağlı, `OFFICE_SMOKE=1`): koordinatör bir izleme görevini park edip sıradaki işe geçer (sırası
  boşalır); bir rutin tetiklenir ve inceleme kapısından geçer. Gerçek CLI ile kilit denemesi: açılış kaydında Cron
  araçları yok.

## 13. Sıra ve kapsam dışı

Sıra: bu belge onaylanır → mimari sayfası (diyagramlar) → uygulama planı → uygulama Opus alt-ajanlarla, her görev Fable
incelemesinden geçer → birleştirme ve canlı ofisin yeniden başlatılması sahibinin onayıyla → koordinatöre "Adım 1
penceresi"ni park etmesi söylenir.

Kapsam dışı: dış takvimlere (Google Calendar) yazma; kişi başına çalışma saatleri/mesai; görevleri sheet'te
sürükle-bırak; rutinlerin bulutta çalışması; saniye hassasiyetli zamanlama.
