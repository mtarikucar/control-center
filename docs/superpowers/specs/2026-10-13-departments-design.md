# control-center — Departmanlar (alt proje 1: çekirdek) tasarım notu

- Tarih: 2026-10-13 · Sahibiyle konuşularak yazıldı.
- Dal `feat/departments`, `main` (50fbcef) üstünde. **Göç v25** (v24 `feat/b10-core` bilgi tabanının; o dal önce birleşir).
- Büyük resim: ofiste aynı anda birden çok iş yürüsün diye koordinatör işi departmanlara devreder; her departmanın
  bir başkanı ve kendi odası olur. Üç alt projeye bölündü, sıra **1 → 2 → 3**:
  1. **Departmanlar çekirdeği** (bu not): departman kaydı, başkanın yetkileri, akış devri, şablonlar, Şirket görünümü,
     bugünkü ekiplerin geçişi. 3D ofis değişmez; 8 masa sınırı sürer.
  2. **Ofis odaları (3D):** ortada ışık hüzmesinde koordinatör, çevresinde 6 departman odası; masa modeli oda + koltuk
     olur, 8 masa sınırı kalkar. Bu alt projenin alınmış kararları Ek B'de.
  3. **Yetenekler ve otonomi:** eklenebilir yetenekler, "sistem halletsin" politikası, kapının kuralları, giden kutusu.
     Alınmış kararları Ek C'de.
- Sıra neden 1 → 2 → 3: ofis bugün dolu (8 masa, 8 kişi). 2 olmadan yeni departmanlara başkan alınamaz; 3'ün asıl
  kullanıcısı olan İç-Dış İletişim odası da boş kalır.

## 1. Bugün ve kapsam

Bugün çalışanın serbest metin bir `team` alanı var; koordinatör `appointLead` ile bir ekibe lider atar. Lider kendi
ekibine görev açar, dağıtır, önerilerini karara bağlar; işe alamaz, plan açamaz. Bütün yönetim turları koordinatörde:
plan kartını o yazar, görevleri o açar, panoyu o okur. Ekip sayısı arttıkça koordinatör darboğaz olur.

**Bu iş:**
- **Departman kaydı:** ad, misyon, sınır, şablon, başkan, durum. Çalışan bir departmanda ya da merkezde (departmansız).
- **Departman şablonları:** ürünle gelen 5 şablon (`craft/departments/`) ve 10 yeni rol şablonu.
- **Başkanın yetkileri:** kendi departmanına işe alım, model / uyku / çalışan dosyası, akış planı ve akış raporu.
- **Akış devri:** plan kartındaki akışın sahibi bir departman olabilir; başkan akışını kendisi planlar ve yönetir.
- **Koordinatörün panosu:** departman departman özet.
- **Araçlar, API, olaylar ve Şirket görünümü** (Departmanlar sekmesi, örgüt şeması, işe alma formu, plan kartı).
- **Göç v25** ve bu ofisin yeni düzene geçişi (§9).

**Kapsam dışı:**
- 3D odalar, ışık hüzmesi, masa sayısı (alt proje 2).
- Yetenek ekleme, otonomi, `messages.read` (alt proje 3).
- Departman bütçesi ya da kota payı; departman hedefleri ve KPI'ları (hedefler şirket düzeyinde kalır; hedefin
  planındaki akışlar departmanlara verilir).
- Departmana özel el kitabı mekanizması (konu adında `<departman>/…` alışkanlığı kod gerektirmez).
- Onboarding profilinden ya da blueprint'ten departmanları kendiliğinden açmak.

## 2. İlkeler

1. **Başkan odanın kalite kapısıdır.** Odadaki işi yapan değil, inceleyen odur. Oda tek kişiyken işi kendisi yapar;
   o zaman inceleyen koordinatördür.
2. **2. ve 3. kişi ihtiyaç doğunca alınır**, boş masa var diye değil. Şablondaki her önerilen rolün bir "ne zaman
   alınır" koşulu vardır.
3. **Departman başına kişi sınırı yok, alt sınır da yok.** Toplamı Anayasa'nın çalışan sınırı ve masalar belirler.
   Başkansız ve kişisiz departman olabilir.
4. **Dışarıya dokunan her şey bugünkü gibi sahibine gelir** (yayın, gönderim, ödeme, harcama). Alt proje 3 bunu
   değiştirecek; şablonlar o zaman yeni sürüm alır.
5. **Odalar arası iş başkandan başkana gider** (`taskPass` bir departmana). Koordinatör yalnız öncelik çatışmasında
   araya girer.
6. **Ürün bilgisi dosyada gelir, şirket bilgisi veritabanında durur** (B6 ilkesi): şablonlar dosyada, açılan
   departmanlar veritabanında.

## 3. Departman kaydı

```ts
interface Department {
  id: string;                 // 8 onaltılık karakter, görevlerdeki gibi
  name: string;               // açık departmanlar arasında tekil (büyük/küçük harf ve Türkçe harf katlanarak)
  mission: string;            // tek paragraf
  scope: string;              // sınır metni: Yapar / Yapmaz / Sana gelir (Markdown)
  template: TemplateRef | null;   // açıldığı şablon ve sürümü; özel departmanda null
  headId: string | null;      // başkan; null = başkansız
  status: 'open' | 'closed';
  createdAt: number;
  closedAt: number | null;
}

interface Employee {
  // …bugünkü alanlar
  departmentId?: string | null;   // null = merkez (koordinatöre bağlı)
}
```

**Değişmezler** (her yazma işleminde korunur, testle):
- Bir çalışan en çok bir açık departmandadır. Koordinatörün departmanı olmaz.
- `employee.kind === 'lead'` ⇔ çalışan bir açık departmanın `headId`'sidir. `headId` asıl kayıttır; `kind` araç
  yetkileri için onunla eşitlenir.
- Başkan kendi departmanının üyesidir (`departmentId === department.id`).
- `employee.team` departmanın adına eşittir; departmansız çalışanda boştur. Eski ekranlar, `officeStatus`,
  blueprint ve rapor kodu `team` okumaya devam eder.
- En çok **6 açık departman** (`MAX_DEPARTMENTS`, 6 odaya karşılık).
- Arşivlenmiş çalışan hiçbir departmanda sayılmaz; başkansa departman başkansız kalır (§6.4).

**Departman adı ve kişi adı çakışması:** bir departman bir çalışanla aynı adı alamaz, bir çalışan da bir departmanla
aynı adı alamaz (`taskPass` ve akış sahibinde ad tek anlamlı olsun diye).

## 4. Şablonlar

### 4.1 Departman şablonu biçimi

Her şablon `apps/office-server/src/company/craft/departments/<id>.md` dosyasında durur. Ön bilgi bloğu B6 rol
şablonlarıyla aynı dar biçimdedir (`anahtar: değer` ya da `anahtar:` + `- madde`). Bilinmeyen ya da eksik alan
reddedilir.

```
---
id: pazarlama                     # dosya adıyla aynı
version: 1
name: Pazarlama                   # varsayılan departman adı
mission: …                        # tek cümle ya da kısa paragraf
head: pazarlama-muduru            # başkanın rol şablonu (craft/roles'ta olmalı)
roles:                            # önerilen roller: "<rol şablonu>: <ne zaman alınır>"
- icerik-yazari: Takvim başkanın yetişemeyeceği hacme gelince.
- sosyal-medya: İkinci bir kanal açılınca ya da ücretli reklam başlayınca.
methods:                          # WORK_TYPES
- content
- research
- customer
routines:                         # öneri metni; kendiliğinden kurulmaz
- Haftalık içerik takvimi (her pazartesi 09:00)
checks:
- …
kpis:
- …
---
### Yapar
### Yapmaz
### Sana gelir
```

**Denetim (yüklenirken):** id dosya adı; sürüm pozitif tam sayı; `head` ve `roles` içindeki her şablon rol
kataloğunda var; `roles` maddesi `<şablon>: <koşul>` biçiminde ve koşul boş değil; yöntemler `WORK_TYPES` içinde;
üç gövde başlığı var.

**Şablondan açılan departman:** ad, misyon ve sınır metni (gövde + kontroller + ölçüler + rutin önerileri)
departman kaydına kopyalanır; `template = { id, version }` yazılır. Şablon sonradan değişirse departman kendiliğinden
değişmez; sürüm farkı Departmanlar sekmesinde görünür, güncellemek `departmentUpdate` ile bilinçli bir iştir.

**Rutin önerileri kurulmaz.** Başkan iş başlayınca gerekeni `scheduleCreate` ile kurar; boş oda kota yakmaz.

### 4.2 İlk katalog: 5 departman

Görev tanımlarının tamamı Ek A'da; şablon dosyaları oradan yazılır.

| id | Ad | Başkan (rol şablonu) | Önerilen roller | Yöntemler |
|---|---|---|---|---|
| `yazilim-otomasyon` | Yazılım ve Otomasyon | `teknik-lider` | `gelistirici`, `otomasyon-test-uzmani` | software, operations |
| `pazarlama` | Pazarlama | `pazarlama-muduru` | `icerik-yazari`, `sosyal-medya` | content, research, customer |
| `ic-dis-iletisim` | İç-Dış İletişim | `iletisim-yoneticisi` | `musteri-temsilcisi`, `yonetici-asistani` | customer, content |
| `satis` | Satış | `satis-muduru` | `aday-arastirmaci`, `satis-asistani` | customer, research |
| `operasyon-finans` | Operasyon ve Finans | `operasyon-finans-yoneticisi` | `operasyon-asistani`, `satin-alma-uzmani` | operations |

### 4.3 Rol şablonları: 10 yeni, 5 güncelleme

Yeni (sürüm 1). Gövdeler Ek A'daki görev tanımlarından yazılır; dışarıya dokunan rollerin gövdesi bugünkü onay
kuralını taşır.

| id | Unvan | Model | Yöntemler | Yetenekler |
|---|---|---|---|---|
| `teknik-lider` | Teknik Lider | opus | software, operations | docs.read, docs.write, web.fetch |
| `gelistirici` | Geliştirici | sonnet | software | docs.read, docs.write, web.fetch |
| `otomasyon-test-uzmani` | Otomasyon ve Test Uzmanı | sonnet | software, operations | docs.read, docs.write, web.fetch |
| `pazarlama-muduru` | Pazarlama Müdürü | sonnet | content, research, customer | docs.read, docs.write, web.fetch, social.read |
| `iletisim-yoneticisi` | İletişim Yöneticisi | sonnet | customer, content | docs.read, docs.write, email.read, email.draft, social.read, crm.read, calendar.read |
| `yonetici-asistani` | Yönetici Asistanı | sonnet | operations, customer | docs.read, docs.write, email.read, email.draft, calendar.read |
| `satis-muduru` | Satış Müdürü | sonnet | customer, research | docs.read, docs.write, web.fetch, crm.read, crm.write, email.read, email.draft |
| `aday-arastirmaci` | Aday Araştırmacı | sonnet | research, customer | docs.read, docs.write, web.fetch, crm.read, crm.write |
| `operasyon-finans-yoneticisi` | Operasyon ve Finans Yöneticisi | sonnet | operations | docs.read, docs.write, payments.read, email.read, calendar.read |
| `satin-alma-uzmani` | Satın Alma ve Operasyon Uzmanı | sonnet | operations, research | docs.read, docs.write, web.fetch, ecommerce.orders, email.draft |

Güncellenen (sürüm 2; `team` departman adına, gerekirse unvan ve gövde):
- `icerik-yazari` → team Pazarlama; gövdeye görsel üretimi (`media.generate`, sahibinin onayıyla) eklenir.
- `sosyal-medya` → unvan "Sosyal Medya ve Reklam Uzmanı"; `ads.manage` eklenir; gövdeye reklam kurulumu ve
  performans takibi (bütçe sahibinin onayıyla) eklenir.
- `musteri-temsilcisi` → team İç-Dış İletişim.
- `satis-asistani` → team Satış.
- `operasyon-asistani` → team Operasyon ve Finans.

`editor` ve `arastirmaci` değişmez. Var olan çalışanların kartı kendiliğinden değişmez (B6 kuralı).

## 5. Yetkiler ve araçlar

### 5.1 Koordinatör (yeni)

| Araç | Ne yapar |
|---|---|
| `departmentCreate(template?, name?, mission?, scope?, head?)` | Şablondan (`template`; ad/misyon/sınır verilirse şablonunkilerin yerine geçer) ya da özel (`name` ve `mission` zorunlu) departman açar. `head`: mevcut bir çalışan (departmanına taşınır ve başkan olur) ya da yok. |
| `departmentUpdate(department, name?, mission?, scope?, head?)` | Alanları değiştirir; `head` bir çalışan (o departmana taşınır) ya da `null` (başkansız). Ad değişince üyelerin `team`'i ve rol kartları yenilenir. |
| `departmentMove(employee, department \| null)` | Çalışanı bir departmana ya da merkeze taşır. Başkan taşınırsa eski departman başkansız kalır (§6.4). |
| `departmentClose(department, reason)` | Departmanı kapatır: üyeler merkeze geçer, başkanlık biter, departmana ait açık akışlar koordinatöre döner. Görevler sahiplerinde kalır. |

`appointLead(employee, team, lead)` geriye uyumlu kalır ama koordinatörün rehberinden çıkar: `team` adında açık
departman varsa onun başkanını değiştirir; yoksa ve sınır izin veriyorsa o adla özel departman açıp çalışanı başkan
yapar; `lead: false` başkanlığı bitirir.

### 5.2 Başkan (yalnız kendi departmanında)

| Araç | Bugün | Yeni |
|---|---|---|
| `hire` | yalnız koordinatör | başkan kendi departmanına alır. `kind` her zaman `member`; Anayasa çalışan sınırı ve masa sayısı geçerli; koordinatöre bilgi notu (`department.hired`). |
| `setModel`, `sleep`, `wake` | yalnız koordinatör | başkan kendi departmanındakilere (kendisi dahil). |
| `employeeNote` | yalnız koordinatör | başkan kendi departmanındakilere. Koordinatörün notlarıyla aynı dosyada, yazanın adıyla. |
| `streamPlan(planId, streamId, text)` | — | Departmanına ait akışın planını yazar: yaklaşım, görev listesi, bağımlılıklar, riskler. Her çağrı yeni bir sürüm; plan kartında akışın altında son sürüm görünür. |
| `streamReport(planId, streamId, summary, evidence[], next?)` | — | Akışın raporunu yazar (genellikle akış bitince; takılmada da olur). Koordinatöre bilgi notu gider, panoda görünür. |
| `taskCreate`, `taskAssign`, `taskReprioritize`, `taskUnpark`, `scheduleCreate/List/Update`, `proposalsOpen/Decide`, `playbookUpdate`, `decisionRecord`, `agendaRead`, `performanceRead`, `roleTemplates`, `goalsRead`, `blueprintRead` | lider | aynen sürer; "kendi ekibi" denetimi "kendi departmanı" olur. |

**Başkan yapamaz:** departman açmak, kapatmak ya da düzenlemek; başkan atamak; başka departmana doğrudan görev açmak
(`taskPass` ile ister); plan kartı açmak ya da değiştirmek; işten çıkarmak (yalnız sahibi).

`streamPlan` ve `streamReport` koordinatör tarafından her akış için de kullanılabilir (başkansız departmanın ya da
kişiye verilmiş akışın).

### 5.3 Herkes

- `departmentsRead(department?)`: liste (ad, misyon, başkan, üye sayısı, açık akışlar) ya da birinin tamamı (sınır
  metni, üyeler, akışlar, son akış raporu).
- `taskPass(to, …)`: `to` bir kişi ya da bir departman adı olabilir. Departman adı → başkanına; başkansızsa
  koordinatöre gider. Görev açıklamasının başına "<departman> departmanına" yazılır.
- `officeStatus`: her kişinin yanında departmanı; başkanlar ★ ile.

### 5.4 Rehber ve rol kartı

- `officeGuide(kind)` metinleri güncellenir: `LEAD` "Departman başkanısın" olur ve yeni yetkileri anlatır
  (`LEAD_ONLY`'deki "İşe alamazsın" çıkar); `COORDINATOR` metninden "4–5 kişide appointLead" çıkar, yerine
  departman yapısı ve akış devri gelir: "işi plan kartında akışlara böl, her akışı bir departmana ver; departman
  açmak için önce şablonlara (`departmentTemplates`) bak".
- Her masaya **`department.md`** yazılır ve rol kartı onu içe aktarır (`@department.md`, şirket özetinin
  `@company-brief.md`'si gibi; eski kartlara bir kez eklenir). İçindeki **"Departmanın"** bloğu: ad, misyon, başkan, sınır metninin Yapmaz bölümü ve
  bütün açık departmanların tek satırlık listesi (kime ne paslanır). Departmansız çalışanın bloğu "Merkezdesin;
  koordinatöre bağlısın" der.
- Departmanlarda bir şey değişince herkesin `department.md`'si yeniden yazılır (dosya ucuz; bir sonraki oturum
  açılışında okunur). Oturumu hemen yenilenen (`reload`) yalnız kendi departmanı ya da türü (başkan/üye) değişen
  kişidir; araçları ve kartı onunla değişir. Ötekilere yeni ya da kapanan departman için bilgi notu gider.

`departmentTemplates(id?)` (koordinatör ve başkanlar) şablon kataloğunu okur: id yoksa liste, varsa tamamı.

### 5.5 Uyumluluk: serbest metin `team`

`hire(team)`, `POST /api/employees {team}` ve blueprint rollerindeki `team` çalışmaya devam eder: ad bir açık
departmana denk gelirse çalışan oraya girer; gelmezse ve sınır izin veriyorsa o adla başkansız bir özel departman
açılır (herkese bilgi notu); sınır doluysa `ValidationError` var olan departmanları sayar. Rol şablonunun
varsayılan `team`'i ise yalnız **açık bir departmana katılır, departman açmaz**: denk gelen yoksa çalışan merkeze
girer (şablonla yapılan her işe alım bir oda harcamasın diye). Başkan başka bir `team` veremez; onun işe aldığı her
zaman kendi departmanına girer.

## 6. Akış devri

### 6.1 Akışın sahibi bir departman olabilir

`PlanStream.owner` bugün bir çalışan kimliği ya da `alınacak: <rol>`. Üçüncü biçim eklenir:
**`departman: <ad ya da kimlik>`** → `departman:<departmentId>` olarak saklanır. Doğrulama: departman açık olmalı.
Akış sahibini okuyan her yer (pano, nabız, plan kartı, ajanda) departman sahibini çözer: sorumlu kişi = başkan,
başkansızsa koordinatör.

### 6.2 Bir işin yolculuğu

1. Sahibi koordinatöre yazar. Koordinatör plan kartını açar; akışların sahibi departmanlardır.
2. Plan başlayınca (sahibinin onayıyla ya da tam serbestte hemen) her departman sahibine bir **karar notu**
   (`stream.assigned`, kind `decision`) gider: plan, akışın başlığı ve kimliği, hedef, bitti tanımı (plan
   yönteminden), bütçe payı (plan tahmini), beklediği akışlar. Karar notu başkanı uyandırır (özet açıkken de).
3. Başkan `streamPlan` ile akışını planlar; görevleri `taskCreate(planId, streamId)` ile açar, odasına dağıtır,
   inceleyicileri atar; gerekirse işe alır.
4. İş sürerken başkan yalnız olayla uyanır: odasında teslim, inceleme kararı, takılma, odasında biri boşa çıktı,
   başka departmandan iş geldi. **Kalp atışı yok.** Bugünkü lider uyanma kuralı (`dispatcher.#hasWorkFor`) yeterli;
   eksik olan notlar (`stream.assigned`, `stream.returned`, `department.task`) eklenir.
5. Akışın son görevi kapanınca başkana `stream.done` notu gider; başkan `streamReport` yazar. Rapor yazılmasa da
   akış durumu panoda "bitti" görünür; panoda "raporsuz" işareti çıkar.
6. Koordinatör yönetim turunda panonun **Departmanlar** bölümünü okur (§6.3), planı gerçekle karşılaştırır.

### 6.3 Koordinatörün panosu: Departmanlar bölümü

Panoya (`board.ts`) yeni bir bölüm eklenir. Her açık departman için bir satır:

```
- Yazılım ve Otomasyon — başkan Selin · 5 kişi (2 çalışıyor, 1 boşta) · akışlar: api (sürüyor), test (takıldı) ·
  incelemede 1 · son rapor: “api akışı: uç noktalar bitti…” (3 sa önce)
```

Uyarılar ayrı satırda: başkansız departmanın açık akışı, raporsuz biten akış, uzun süredir boşta olan oda.
Bölüm yalnız açık departman varken çıkar (departmansız bir ofisin panosu bugünküyle birebir aynı kalır; ekonomi
senaryosu bunu karşılaştırır) ve "İnsanlar" bölümünün ardından gelir. Görev ayrıntısı bölümleri bu sürümde bugünkü
gibi kalır; departmana verilmiş işlerin ayrıntıda tek satıra sıkıştırılması, turların ölçülmesinden sonraki iştir
(kapsam dışı).

### 6.4 Ters giden durumlar

- **Başkanın çözemediği sorun** (başka odanın önceliği, bütçe, kapsam): `propose` (need / objection) ile
  koordinatöre. Bugünkü mekanizma.
- **Başkansız departmana akış:** sorumlu koordinatördür; pano uyarır. Koordinatör başkan atar ya da akışı yönetir.
- **Başkan arşivlenir, taşınır ya da başkanlığı biter:** departman başkansız kalır; açık akışlar için koordinatöre
  `stream.returned` karar notu gider; başkana açık önerileri koordinatöre yeniden yönlenir (bugünkü
  `#rerouteProposals`).
- **Departman kapanır:** §5.1. Kapanmış departmana akış verilemez; eski planlardaki sahibi "kapandı" diye görünür.

## 7. API, olaylar, anlık görüntü

Sahibinin uçları (değiştirenler bugünkü sahip korumasıyla: Origin + sayfa anahtarı):

```
GET  /api/departments                       Department[] (kapalılar dahil)
GET  /api/department-templates              DepartmentTemplate[]
POST /api/departments                       { template? | name, mission, scope?, headId? }
POST /api/departments/:id                   { name?, mission?, scope?, headId? }   (API'nin geri kalanı gibi POST)
POST /api/departments/:id/close             { reason }
POST /api/employees/:id/department          { departmentId | null }
POST /api/employees                         { …, departmentId?, head? }   işe alma formu
GET  /api/plans/:id/stream-notes            her akışın son planı ve raporu
```

- Olaylar: `department.changed { change: 'created' | 'updated' | 'head' | 'moved' | 'closed', department }` ve
  `stream.noted { note }` (açık plan kartları notları yeniden okur).
- `/api/office` anlık görüntüsüne `departments` eklenir.
- Sahibinin işlemleri koordinatöre bilgi notu bırakır (bugünkü düğmeler gibi).

## 8. Şirket görünümü (office-web)

- **Örgüt şeması:** koordinatör üstte; altında departman kutuları (ad, başkan ★, üyeler); departmansızlar "Merkez"
  kutusunda.
- **Departmanlar sekmesi:**
  - Liste: ad, misyon, başkan, kişi sayısı, açık akışlar, şablon sürüm farkı.
  - **Departman aç:** şablon kartları (ad, misyon, başkan rolü, önerilen roller ve ne zaman alınacakları) ya da
    **Özel departman** (ad, misyon, Yapar / Yapmaz). Başkan seçimi: mevcut çalışan ya da boş. 6 açık departman
    varken düğme kapalı, nedeni yazılı.
  - Ayrıntı: misyon ve sınır metni, üyeler (taşı), başkan ata/değiştir, akışlar ve son raporlar, kapat (gerekçe).
- **İşe alma formu:** serbest "ekip" alanının yerine departman seçimi + "başkan olarak" kutusu.
- **Plan kartı:** akış sahibi departman adıyla; akışın altında son akış planı ve raporu (katlanır).
- **Çalışan paneli:** departmanı; başkansa ★ ve "Departman başkanı".
- Etiketlerde "Ekip lideri" → "Departman başkanı".

## 9. Göç v25 ve bu ofisin geçişi

### 9.1 Göç v25 (geri alınabilir) ve ekiplerin benimsenmesi

Göç yalnız şemadır:

```sql
-- up
CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, mission TEXT NOT NULL DEFAULT '', scope TEXT NOT NULL DEFAULT '',
  template TEXT, template_version INTEGER, head_id TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at INTEGER NOT NULL, closed_at INTEGER
);
CREATE TABLE IF NOT EXISTS stream_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id TEXT NOT NULL, stream_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('plan', 'report')), text TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '[]',
  next TEXT, by TEXT NOT NULL, at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS stream_notes_lookup ON stream_notes (plan_id, stream_id, kind, at);
ALTER TABLE employees ADD COLUMN department_id TEXT;

-- down
DROP INDEX IF EXISTS stream_notes_lookup; DROP TABLE IF EXISTS stream_notes;
ALTER TABLE employees DROP COLUMN department_id; DROP TABLE IF EXISTS departments;
```

**Ekiplerin benimsenmesi kodda yapılır** (`Departments.adoptTeams()`, ofis her açılışta çağırır; idempotent):
arşivlenmemiş, `team`'i dolu ve `departmentId`'si boş her çalışan için açık departmanlar arasında adı katlanarak
(`fold`: büyük/küçük harf ve Türkçe harfler) eşleşen departman aranır; yoksa o adla başkansız özel departman açılır
ve çalışan ona girer. Lider (`kind = 'lead'`) olan ilk çalışan başkan olur; aynı ekipte ikinci bir lider üye olur
(değişmez: `kind` ⇔ `headId`). SQL yerine kodda: Türkçe katlama SQL'de yapılamaz ("Keşif" ile "keşif" tek departman
olmalı), ve aynı adım eski bir istemcinin serbest metin `team` ile yaptığı işe alımı da yakalar.

- Down tabloları ve sütunu kaldırır; `team` yerinde kaldığı için eski sürüm aynen çalışır. Benimseme yalnız yeni
  tablolara ve sütuna yazar (ikinci liderin `kind`'ı dışında; tek liderli ekiplerde hiçbir şey değişmez).
- Ekip sayısı 6'yı aşarsa benimseme hepsini açar; sınır yalnız yeni departman açmayı durdurur ve pano uyarır.
- Akış sahibi biçimi yalnız yeni bir değer ekler; eski planlar değişmez.
- Gidiş-dönüş testi: up → down → up; göç provası (`migration-rehearsal.ts`) gerçek veritabanının kopyasında.

### 9.2 Bu ofisin geçişi (yayından sonra, ofisin kendi araçlarıyla)

Benimseme bu ofiste iki başkansız özel departman açar: **Keşif** (Deniz, Selin, Kerem) ve **Geliştirme** (Mert, Elif,
Can). Sahibinin kararı (2026-10-13) sınır haritasına göre geçmek:

1. Yeni sürüm, çalışanlar boştayken ya da şirket duraklatılmışken başlatılır (süren işler kesilmesin).
2. **Yazılım ve Otomasyon** şablondan açılır, başkanı **Selin**. Mert, Elif, Can ve Kerem oraya taşınır
   (5 kişi). Selin'in rol kartına koordinatör `editRoleCard` ile Teknik Lider eki yazar: mimari ve odanın kod
   incelemesi; Kerem bağımsız test ve inceleme rolüyle sürer.
3. **Pazarlama** şablondan başkansız açılır; **Deniz** oraya taşınır (pazar, rakip, fiyat araştırması Pazarlama'nın
   sınırında). Pazarlama Müdürü, masa açılınca (alt proje 2) alınır.
4. **Keşif** ve **Geliştirme** kapatılır.
5. İç-Dış İletişim, Satış, Operasyon ve Finans şimdi açılmaz (ofis dolu); alt proje 2'den sonra ihtiyaç doğunca.

Bu adımlar sahibinin Departmanlar sekmesinden ya da koordinatörün plan kartıyla yapılır; kod gerektirmez.

## 10. Doğrulama

- **Birim (K1):**
  - Departman şablonu ayrıştırıcısı (alanlar, `roles` biçimi, bilinmeyen alan, olmayan rol şablonu, eksik başlık);
    katalog şekli (5 şablon geçerli, başkan ve önerilen roller katalogda); 10 yeni ve 5 güncellenen rol şablonu.
  - Departman deposu ve değişmezler (§3): açma, ad tekilliği (Türkçe katlama), kişi adıyla çakışma, 6 sınırı, tek
    başkan, `kind` eşitlemesi, `team` eşitlemesi, taşıma, kapatma, arşivlenen başkan.
  - Yetkiler: başkanın işe alımı yalnız kendi departmanına ve `member`; `taskCreate` / `setModel` / `sleep` /
    `wake` / `employeeNote` başka departmana `ForbiddenError`; üye hiçbirini yapamaz; koordinatör hepsini.
  - Akış devri: `departman:` sahibi doğrulaması; plan başlayınca `stream.assigned` notu başkana (ve başkansızsa
    yok, pano uyarısı); `streamPlan` sürümleri; `streamReport` → koordinatöre not; başkan arşivlenince
    `stream.returned`; kapanmış departmana akış reddi.
  - `taskPass` departmana → başkana; başkansızsa koordinatöre.
  - Pano: Departmanlar bölümü satırları ve uyarıları.
  - Göç v25: up, down, up → down → up gidiş-dönüşü, eski şema uyumu; benimseme (ekipten departman, katlanmış ad
    eşleşmesi, lider → başkan, ikinci lider üye, idempotent, 6'dan çok ekip).
  - Rehber ve rol kartı: başkan metni, Departmanın bloğu, değişince yeniden yazım.
- **Web:** Departmanlar sekmesi, Departman aç (şablon / özel, 6 sınırı), ayrıntı işlemleri, örgüt şeması
  gruplaması, işe alma formu, plan kartında akış planı ve raporu.
- **Senaryo (sahte claude):** koordinatör iki departmanlı akışlarla plan açar → başkanlar not alır → biri
  `streamPlan` + `taskCreate` → üye teslim eder → başkan inceler, `streamReport` yazar → koordinatörün panosunda
  departman satırı ve rapor.
- **Mutasyon kontrolü:** değişmezler, yetki denetimleri, sahip çözümü, göç.
- **Gerçek claude:** gerekmez (davranış ofisin kodunda). Yayın öncesi göç provası gerçek veritabanının kopyasında.
- README'nin "Öneriler ve ekip liderleri" bölümü "Departmanlar" olarak yeniden yazılır.

---

## Ek A — Departman görev tanımları (sahibiyle kararlaştırıldı)

### Sınır haritası

| İş | Departman |
|---|---|
| Web sitesinin kodu | Yazılım ve Otomasyon |
| Web sitesinin metni ve görselleri | Pazarlama |
| Bir odanın otomasyon ihtiyacı (ör. fatura akışı) | Talebi o oda açar, Yazılım kurar |
| Sosyal medyada yayın | Pazarlama |
| Dışarıdan gelen her mesaj: e-posta, DM, yorum, etiketlenme, WhatsApp | İç-Dış İletişim |
| Mevcut müşterinin sorusu | İletişim (satışa dönüşürse Satış'a geçer) |
| Potansiyel müşteri, teklif, takip | Satış |
| Fatura, tahsilat takibi | Operasyon ve Finans |
| Basın, duyuru | İletişim |
| Pazar ve rakip araştırması | Pazarlama |
| Müşteri adayı araştırması | Satış |
| Teknik araştırma (araç, kütüphane seçimi) | Yazılım |
| Tedarikçi araştırması | Operasyon ve Finans |

Ar-Ge, Kreatif ve Sosyal Medya ayrı departman değildir: Kreatif ve Sosyal Medya Pazarlama'nın içindedir (bir
kampanya bir odada baştan sona biter); teknik araştırma Yazılım'da, pazar araştırması Pazarlama'dadır.
Departman olmaması gerekenler: Proje Yönetimi (koordinatörün işi), Kalite/İnceleme (inceleme oda içinde),
İK (işe alım koordinatör ve başkanlarda), Hukuk (sorumluluk), Veri ve Analitik (her oda kendi ölçüsünü tutar).

### A.1 Yazılım ve Otomasyon

- **Misyon:** Şirketin ihtiyaç duyduğu yazılımı, entegrasyonları ve otomasyonları yapar ve çalışır halde tutar.
- **Yapar:** uygulama, web sitesi ve iç araç geliştirme, hata düzeltme; diğer odaların ihtiyaç duyduğu
  bağlantılar (e-posta, CRM, sosyal medya API'si); tekrarlayan işleri betiğe ya da akışa çevirme; bakım
  (bağımlılıklar, güvenlik, yedek kontrolü); teknik araştırma.
- **Yapmaz:** site metni ve görselleri (Pazarlama); ücretli servis almak ve canlıya almak (sahibinin kararı).
- **Başkan — Teknik Lider (opus):** işi kabul ölçütlerine böler, mimari kararları karar defterine yazar, odanın kod
  inceleyicisidir; tek başınayken küçük işleri kendisi yapar.
- **Geliştirici (sonnet; zor işte opus)** — ilk incelemeli iş gelince ya da başkanın sırası tıkanınca: kendi dalında
  önce test, sonra kod; kanıt toplar.
- **Otomasyon ve Test Uzmanı (sonnet)** — otomasyon talepleri birikince ya da iki paralel geliştirme çizgisi açılınca
  (darboğaz geliştirmedeyse ikinci geliştirici): uçtan uca doğrulama, otomasyon akışları, bakım rutinleri.
- **Rutin önerisi:** haftalık bakım taraması (bağımlılıklar, güvenlik).
- **Sana gelir:** birleştirme ve canlıya alma; ücretli servis ve abonelik; veri silen göç; dış kullanıcıyı etkileyen
  değişiklik.
- **Kalite kontrolleri:** her değişiklik testli ve testler geçiyor; yapan ile inceleyen farklı; göçler geri
  alınabilir (up/down); kodda gizli anahtar yok; bir kez uçtan uca denendi.
- **Ölçüler:** teslim süresi; ilk turda kabul oranı; canlıdan geri dönen hata sayısı; otomasyonla kazanılan saat
  (talep eden odanın tahmini).

### A.2 Pazarlama

- **Misyon:** Şirketi doğru kitleye duyurur ve talep yaratır: strateji, içerik üretimi, yayın, ölçüm.
- **Yapar:** pazarlama planı ve içerik takvimi; içerik üretimi (blog, bülten, gönderi, görsel, reklam metni);
  sosyal medyada yayın; SEO ve site metinleri; kampanya ve reklam; pazar ve rakip araştırması; sonuç raporu.
- **Yapmaz:** gelen yorum ve mesajlara cevap (İletişim); birebir satış ve teklif (Satış); basın bülteni (İletişim);
  sitenin kodu (Yazılım).
- **Başkan — Pazarlama Müdürü (sonnet):** strateji, takvim, kanal seçimi; yayından önceki son kontrol; ölçüm. Tek
  başınayken içerik de üretir.
- **İçerik Üreticisi (`icerik-yazari`, sonnet)** — takvim başkanın yetişemeyeceği hacme gelince: yazı ve görsel.
- **Sosyal Medya ve Reklam Uzmanı (`sosyal-medya`, sonnet)** — ikinci bir kanal açılınca ya da ücretli reklam
  başlayınca: kanal yönetimi, zamanlama, reklam kurulumu, performans takibi.
- **Rutin önerisi:** pazartesi haftalık içerik takvimi; cuma performans özeti; ay sonu aylık rapor.
- **Sana gelir:** her yayın; reklam harcaması; toplu e-posta ve bülten gönderimi; ücretli görsel üretimi.
- **Kalite kontrolleri:** marka diline uygun (el kitabı); her iddianın kaynağı var; yayın onayının kaydı var;
  görsellerin lisansı temiz; sayıların yanında kaynak ve tarih.
- **Ölçüler:** takvime uyum; etkileşim oranı; Satış'a giden aday sayısı; aday başına maliyet (reklam varsa).

### A.3 İç-Dış İletişim

- **Misyon:** Gelen her mesaj doğru yere gider, hiçbir şey cevapsız kalmaz; sahibi yalnız karar vermesi gerekeni
  görür. İki yöne bakar: şirketin dışarıyla konuşan sesi ve sahibinin iletişim yükü.
- **Yapar (dış):** müşteri desteği (gelen kutusu ve mesajlar için cevap taslakları); **sosyal medya mesajlaşması:**
  Instagram, Facebook ve TikTok DM'leri, gönderi yorumları, etiketlenmeler ve WhatsApp mesajları (cevap taslağı;
  satış sinyali Satış'a, şikâyet takip listesine); SSS ve hazır cevaplar; duyuru ve basın bülteni; itibar takibi
  (değerlendirmeler, şikâyetler; ilgili odaya geri bildirim); haftalık "insanlar ne soruyor, neden şikâyet ediyor"
  özeti Pazarlama'ya.
- **Yapar (iç — sahibinin iletişim yükü):** sahibinin gelen kutusunu ayıklama (acil / karar bekliyor / bilgi /
  gereksiz); cevap taslakları; takvimdeki boşluklara göre toplantı önerisi; takip listesi (kime ne söz verildi, kim
  cevap bekliyor); günün iletişim özeti.
- **Yapmaz:** satış teklifi (Satış); pazarlama yayını ve bülten (Pazarlama). Gelen faturayı Operasyon ve Finans'a
  yönlendirir.
- **Başkan — İletişim Yöneticisi (sonnet):** ton ve cevap kurallarını el kitabına yazar; taslakların son kontrolü;
  ayıklama kuralları; şikâyet ve kriz gibi hassas durumları sahibine taşır.
- **Müşteri Destek Temsilcisi (`musteri-temsilcisi`, sonnet)** — müşteri mesajları başkanın sırasını tıkayınca.
- **Yönetici Asistanı (sonnet)** — sahibinin gelen kutusu ve takvimi ayrı bir sıra gerektirecek kadar yoğunsa.
  (2. ve 3. kişi hangisi önce gerekirse.)
- **Rutin önerisi:** hafta içi 09:00 gelen kutusu ayıklama ve günün özeti; hafta içi 17:00 takip listesi; haftalık
  şikâyet ve geri bildirim özeti ilgili odalara.
- **Sana gelir (alt proje 3'e kadar):** her gönderim (e-posta, mesaj, yorum cevabı); takvim daveti; e-posta silme;
  şirket adına söz, indirim ya da iade.
- **Gizlilik kuralı:** sahibinin gelen kutusundaki içerik şirket hafızasına ve notlara kopyalanmaz (herkes okur);
  oraya yalnız özet ve kararlar yazılır.
- **Kalite kontrolleri:** her mesajın bir sahibi var; taslak ton kurallarına uygun; şirket adına söz verilmedi;
  kişisel veri hafızaya yazılmadı.
- **Ölçüler:** ilk taslağın hazır olma süresi; cevapsız kalan mesaj sayısı; sahibinin değiştirmeden onayladığı
  taslak oranı.

### A.4 Satış

- **Misyon:** Talebi gelire çevirir: müşteri adayını bulur, nitelendirir, teklif hazırlar, takip eder, kapanışı
  sahibine hazırlar.
- **Yapar:** ideal müşteri profili ve aday listesi araştırması; Pazarlama'dan gelen adayları nitelendirme; ilk temas
  ve takip mesajı taslakları; teklif ve fiyat taslağı (fiyat kuralları el kitabında); CRM'de huninin düzeni; sahibi
  bir görüşmeye girmeden hazırlık notu (müşteri kim, ne istiyor, ne teklif edilmeli); kaybedilen fırsatların
  nedenleri Pazarlama'ya.
- **Yapmaz:** toplu pazarlama gönderimi (Pazarlama); mevcut müşterinin destek talebi (İletişim); fatura (Operasyon ve
  Finans — Satış "kazanıldı" deyince faturayı o hazırlar).
- **Başkan — Satış Müdürü (sonnet):** huniyi yönetir, adayları önceliğe göre sıralar, teklifleri inceler (fiyat ve
  söz kontrolü), haftalık huni raporu.
- **Aday Araştırmacı (sonnet; liste işinde haiku)** — aday araştırması ve ilk temas hacmi büyüyünce.
- **Satış Asistanı (`satis-asistani`, sonnet)** — açık fırsat sayısı başkanın takip edebileceğini aşınca: teklif,
  takip, CRM.
- **Rutin önerisi:** hafta içi takip listesi; haftalık huni raporu.
- **Sana gelir:** her gönderim (ilk temas dahil); her teklif, fiyat ve indirim; sözleşme; toplantı daveti.
- **Kişisel veri:** aday verisi KVKK kapsamında; ne toplanabileceği el kitabında kural olarak yazılır.
- **Kalite kontrolleri:** her adayın kaynağı yazılı; teklifin hesabı doğru ve fiyat kurallarına uygun; şirket adına
  söz verilmedi; her temas CRM'de kayıtlı.
- **Ölçüler:** nitelikli aday sayısı; tekliften kazanma oranı; satış döngüsü süresi; takibi kaçırılan fırsat sayısı.

### A.5 Operasyon ve Finans

- **Misyon:** Kayıtlar doğru, vadeler kaçmaz, harcamalar görünür; para hareketi hiçbir zaman bir çalışanın elinde
  olmaz.
- **Yapar:** fatura taslağı ve gelen faturanın kaydı; gelir-gider kayıtları, aylık özet ve mutabakat; vadesi geçen
  alacak takibi ve hatırlatma taslağı; abonelik ve gider takibi (ofisin kendi harcamaları dahil, `recordSpend`
  kayıtlarıyla karşılaştırma); tedarikçi araştırması ve teklif karşılaştırması (karar sahibinde); vergi ve beyan
  takvimi hatırlatması (beyanı muhasebeci ya da sahibi yapar).
- **Yapmaz:** ödeme, para transferi, abonelik başlatma (hiçbir zaman); vergi ve hukuk danışmanlığı (muhasebeciye
  yönlendirir); satış teklifi (Satış).
- **Başkan — Operasyon ve Finans Yöneticisi (sonnet):** kayıt düzeni ve kuralları; ay sonu kapanışı; nakit akışı
  özeti; satın alma önerilerini sahibine hazırlar; odanın sayı kontrolcüsü (her rakama ikinci göz).
- **Muhasebe Asistanı (`operasyon-asistani`, sonnet)** — fatura ve gider hacmi büyüyünce.
- **Satın Alma ve Operasyon Uzmanı (sonnet)** — tedarikçi, sipariş ya da stok işi düzenli hale gelince.
- **Rutin önerisi:** haftalık vade ve tahsilat kontrolü; ayın 1'i kapanış ve özet; aylık abonelik taraması.
- **Sana gelir:** her ödeme (sahibi yapar); müşteriye fatura ve tahsilat hatırlatması göndermek; satın alma kararı;
  muhasebe kaydını değiştiren her işlem.
- **Kalite kontrolleri:** her sayı kaynak belgeyle karşılaştırıldı; toplamlar tutuyor ya da fark nedeniyle yazılı;
  tahminler "tahmin" diye işaretli; hiçbir para hareketi yapılmadı.
- **Ölçüler:** kaçırılan vade sayısı; mutabakat farkı; vadesi geçmiş alacak (tutar ve gün); kapanışın zamanında olma
  oranı.

## Ek B — Alt proje 2 (ofis odaları, 3D) için alınmış kararlar

- Ortada koordinatör, üstünde bir ışık hüzmesi; ofisin merkezi orası.
- Çevresinde **sabit 6 departman odası**; boş oda karanlık/kapalı görünür, departman açılınca odaya yerleşir ve
  kapısında adı yazar.
- Odada kişi sınırı yok (alt sınır da yok); odanın fiziksel kapasitesi bu alt projede belirlenecek.
- Masa modeli "oda + koltuk" olur; bugünkü 8 masa sınırı kalkar; Anayasa'nın çalışan sınırı varsayılanı yeniden
  düşünülür.
- Açık sorular: ışık hüzmesinin anlamı (yalnız görsel mi, koordinatörün konuştuğu odaya mı uzanır); `assets/2d/`
  altındaki görsellerin bu tasarımla ilişkisi.

## Ek C — Alt proje 3 (yetenekler ve otonomi) için alınmış kararlar

- **Yetenekler sekmesi:** ürünle gelen sözlük + şirketin eklediği yetenekler (veritabanında). Sahibi sekmeden
  ekler; sistem de ekler (ör. Yazılım odası yeni bir bağlantı kurunca). Ekleyen önerir, **koordinatör türünü
  onaylar** (yapan ≠ denetleyen), sahibine bilgi notu, geri alınabilir. **Para ve silme türleri sistemce başka türe
  çekilemez.**
- Yeni yetenek **`messages.read`**: SMS, WhatsApp ve sosyal medya mesajlarını ve yorumları okur. İletişim şablonu
  bunu ister.
- **Otonomi:** Anayasa'da işlem türü başına "Sahibine sor / Sistem halletsin". Sahibinin seçimi: **mesaj ve
  e-posta, sosyal medya yayını, telefon araması → sistem halletsin**; takvim daveti → sahibine sor; ödeme, silme,
  ofisin kendisi → her zaman sahibine (ayarla değişmez).
- **Kapının kuralları (mekanik):** oda başına saatlik gönderim sınırı; toplu gönderim eşiği; özel kişiler listesi
  (aile, ortak, avukat, yatırımcı, muhasebeci → her zaman sahibine); giden kutusu (gönderilen her şey kayıtlı).
  Arama için ek: mesai saatleri (Anayasa), oda başına günlük sınır, izinsiz ticari arama yok, aramanın özeti CRM'e
  ve giden kutusuna.
- **Muhakeme katmanı (el kitabında, çalışan göndermez, taslağı sahibine getirir):** para sözü (fiyat, indirim, iade,
  ödeme tarihi); hukuki (avukat, tüketici hakem heyeti, KVKK talebi, sözleşme); kriz (basın, olumsuz yayılan
  paylaşım, tehdit, ağır şikâyet); cevabı bilgi tabanında olmayan soru; ticari ileti izni (İYS: izni olmayan kişiye
  ilk ticari e-posta, SMS ya da arama).
- Kabul edilen risk: muhakeme katmanı modelin yargısına dayanır; önlem olarak başkan her gün gönderilenlerden örnek
  inceler.
- Bu alt projede İletişim, Pazarlama ve Satış şablonları yeni sürüm alır ("Sana gelir" bölümleri otonomiye göre).
