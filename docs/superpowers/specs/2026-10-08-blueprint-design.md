# control-center — Blueprint (kurulum planı) ve idempotent kurulum (B5) tasarım notu

- Tarih: 2026-10-08 · Yazan: Mert · Görev: 3c87f1db (plan "Çekirdek 3", B5) · İnceleyen: Kerem
- Dayandığı:
  - `bosluk-analizi.md` §2 B5 satırı ve §3 "B5 — Blueprint ve idempotent kurulum yok";
  - `hedef-mimari.md` §4 A3 (yapısal kurulum planı; ofis doğrular; plan kartıyla sahibine; onayla kurulum; idempotent)
    ve A4 (yeniden onboarding farkı);
  - `pilot-senaryosu.md` §3 A4–A11 ve §4 (blueprint içeriği), §8 (kurulum sırası, kapalı kip, etkisiz doğrulama).
- Dal `feat/blueprint`, `feat/capability-model` (B7, 2bd5f1b) üstünde. **Göç v18.**
- Sürüm 2 (inceleme turu 1, Kerem): kapalı kipte tanınmayan adlar, işten çıkarılan rol, revizyonda sayım, kapalı kibin
  sınırı, dosyanın oturumdan önce yazıldığının testi (§2, §3, §4, §8).

## 1. Bugün ve kapsam

Kurulumu koordinatör tek tek araç çağrısıyla yapıyor: `hire`, `playbookUpdate`, `goalSet`, `scheduleCreate`,
`taskCreate`. Plan kartı serbest metin, `steps` metin satırları. Yarıda kalan bir kurulumun izi yok; ikinci deneme
ikinci bir çalışan, ikinci bir hedef açar.

Bu iş:
- **Blueprint şeması:** roller (B6 şablonu, B7 yetenekleri), el kitabı tohumları, hedefler (B16 KPI'ları), rutinler,
  ilk görevler, isteğe bağlı şirket özeti ve kapalı kip.
- **`blueprintPropose`:** ofis doğrular, eksiği söyler ve mevcut plan kartıyla sahibine gösterir. Entegrasyon
  durumunu B3+B7'den kendisi çıkarır (hazır / elle kayıtlı / yetki gerekiyor / yok).
- **`blueprintApply`:** onaydan sonra adım adım ve idempotent kurulum. Her adımın anahtarı ve kaydı var. Yarıda
  kalırsa tekrar çalışır, yapılmışı atlar; ikinci çalıştırma hiçbir şey eklemez.
- **`blueprintRead`:** blueprint, adımların durumu, kapalı kipin masa masa salt okunur doğrulaması.
- `GET /api/plans/:id/blueprint`.

**Kapsam dışı:**
- Blueprint'i profilden otomatik yazmak. Koordinatör (model) yazar; ofis doğrular ve zenginleştirir. "İş tarifinden
  üretim" = onboarding (B1) → profil (B2) → koordinatörün blueprint'i → ofisin doğrulaması.
- Eksik yetenek için sahibine otomatik öneri (B8). Plan kartı eksikleri gösterir, sahibi onaydan önce görür.
- Yeniden onboarding farkı (A4): blueprint profil sürümünü kaydeder, okuma "profil o günden beri değişti" der; farkı
  çıkarmak sonraki iş.
- Bilgi tabanı yükleme (B10), web ekranı (API hazır).

## 2. Blueprint şeması

```ts
interface Blueprint {
  title: string;                      // plan başlığı
  summary: string;                    // iş tarifi, bir paragraf (plan kartının "hedef"i)
  brief?: string;                     // şirket özeti (briefUpdate), isteğe bağlı
  roles: Array<{
    key: string;                      // blueprint içinde tekil, a-z0-9-
    name: string;                     // çalışanın adı
    template?: string;                // B6 şablonu; yoksa role + model zorunlu
    role?: string;                    // şablonla: şirkete özgü ek; şablonsuz: rol kartı
    title?: string; team?: string; model?: ModelAlias;
    capabilities?: string[];          // B7; verilmezse şablonunkiler
  }>;
  playbook: Array<{ topic: string; text: string }>;
  goals: Array<{ key: string; title: string; why: string; done: string[]; kpis?: GoalKpi[] }>;
  routines: Array<{ key: string; title: string; description?: string; done?: string[];
                    role: string; reviewer?: string; cron: string; difficulty?: TaskDifficulty }>;
  tasks: Array<{ key: string; title: string; description?: string; done?: string[];
                 role: string; reviewer?: string; requires?: string[]; difficulty?: TaskDifficulty;
                 priority?: number }>;
  closedMode?: { deny: string[] };    // pilot §8: her işe alınanın masasına permissions.deny
  estimates?: { quotaPct?: number; usd?: number; days?: number };
  risks?: string;
}
```

`role` ve `reviewer` alanları bir rolün `key`'ini ya da `coordinator`'ı gösterir. Görev ve rutin plana bağlı açılır.

**Doğrulama (`blueprintPropose`, hiçbir şey yazmadan önce):**
- **Profil:** onboarding'in zorunlu soruları açık olamaz (`onboarding().complete`); açıksa hangileri olduğu söylenir.
  Bu, hedef mimarinin "blueprint öncesi zorunlu bölüm denetimi"dir.
- **Biçim:**
  - anahtarlar bölüm içinde tekil;
  - adlar blueprint içinde tekil;
  - `role`/`reviewer` başvuruları çözülüyor, inceleyen yapan değil;
  - şablonlar (B6) ve yetenekler (B7) var;
  - KPI'lar B16 kuralıyla geçerli;
  - cron, rutin aralığı ve görev alanları mevcut doğrulamadan geçiyor.
- **Sınırlar (anayasa):**
  - Boş masa sayısı: aynı adla zaten çalışan, kurulumda yeni masa istemez.
  - Aktif hedef, rutin ve plan başına açık görev sınırları. Yalnız kurulumun yeni açacakları sayılır. Revizyonda
    kaydı olan ya da doğal anahtarıyla var olan rutin ve görev ikinci kez sayılmaz.
  - En fazla 40 adım (plan kartının adım sınırı).

**Plan kartı (zenginleştirme):** ofis blueprint'ten mevcut kartın alanlarını üretir. Eski plan kartları aynen çalışır;
blueprint ayrı tabloda, plana bağlı.
- `goal`: özet.
- `approach`: sayım ve kurulum kuralı.
- `people`: roller.
- `steps`: kurulum sırasıyla adım satırları. Örnek:
  `İşe al: Ece — İçerik Yazarı (şablon icerik-yazari, sonnet); yetenekler: docs.write [açık], social.draft [kapalı]`.
- `risks`: verilen riskler + açık olmayan yetenekler + dışa dönük yetenekler (B9'a kadar yalnız metinle korunur).
- Tahminler.
- `method`: sabit `operations` yöntemi; aşamalar: blueprint → sahibinin onayı → kurulum → doğrulama.

## 3. Kurulum ve idempotans

`blueprintApply(planId)` (koordinatör), plan onaylıyken (sahibinin onayı ya da tam serbestlik). Onay notu bu planın
bir kurulum planı olduğunu ve `blueprintApply` ile kurulacağını söyler.

**Sıra** (pilot §8'in sırası): özet → el kitabı → roller → hedefler → rutinler → görevler. Görevler en son açılır;
kapalı kipte masa dosyası işe alım anında, ilk oturumdan önce yazılır (§4).

**Adım anahtarı:** `brief`, `playbook:<konu>`, `role:<key>`, `goal:<key>`, `routine:<key>`, `task:<key>`.

**İdempotans kuralı (tek cümle): bir adım ya kaydı varsa ya da doğal anahtarıyla eşleşen varlık zaten varsa
yapılmış sayılır; yapılmış adım bir daha yazılmaz.**
- **Kayıt:** `blueprint_steps(plan_id, step, ref, outcome, at)`. Her adım yapılınca yazılır: `done` (ofis yaptı) ya
  da `adopted` (var olanı kullandı). `ref` oluşan ya da kullanılan kayıttır.
- **Doğal anahtar:** adım yapılıp kaydı yazılmadan süreç ölürse (işe alım bir süreç açar, tek transaction değildir)
  ikinci çalıştırma kopya açmaz, var olanı benimser. Anahtarlar:

  | Adım | Eşleşen var olan |
  |---|---|
  | rol | aynı adla işten çıkarılmamış çalışan (Türkçe büyük/küçük harf duyarsız) |
  | hedef | aynı başlıkla aktif hedef |
  | el kitabı | aynı konu, herhangi bir metinle; şirketin el kitabı ezilmez |
  | özet | aynı metin |
  | rutin | aynı plana bağlı, aynı başlık ve aynı atananla, durdurulmamış rutin |
  | görev | aynı planda aynı başlık, herhangi bir durumda |

- **Yarıda kalma:** bir adım hata verirse (ör. masa doldu) kurulum durur. Yapılanlar kayıtlı kalır; cevap hangi
  adımda neden durduğunu söyler. Yeniden çalıştırma kaldığı yerden sürer.
- **Rol değişince sonraki adımlar:** rutin ve görev atananını rol adımının `ref`'inden (çalışan kimliği) alır.
  Benimsenen çalışanın da kimliği kaydedilir.
- **İkinci çalıştırma:** her adım "zaten yapılmış" döner. Hiçbir çalışan, hedef, el kitabı sürümü, rutin, görev ya da
  olay eklenmez (test).
- **Revizyon:** blueprint revize edilirse (`blueprintPropose(planId)` → plan revizyonu → sahibinin onayı) aynı
  anahtarlı adımlar atlanır, yeniler kurulur. Kaldırılan adımlar geri alınmaz (işten çıkarma kurulumun işi değil);
  okuma bunları "blueprint'te artık yok" diye gösterir.
- **İşten çıkarılan rol:** kurulumdan sonra bir rolün çalışanı işten çıkarılırsa kurulum onu geri almaz. Rol adımı
  "zaten yapılmıştı (çalışanı işten çıkarıldı)" kalır. O role yeni görev ya da rutin veren bir adım şunu söyleyerek
  durur: "revizyonda bu role yeni bir anahtar ver (yeni biri işe alınır) ya da adımı başka bir role bağla". Revizyonun
  plan kartı da bunu onaydan önce gösterir. Gerekçe: işten çıkarmayı sahibi ya da koordinatör bilinçli yaptı; aynı
  rolü sessizce yeniden doldurmak bu kararı geri alır.

## 4. Kapalı kip (pilot §8)

`closedMode.deny` verilirse her **işe alınan** rolün masasına, ilk oturumu açılmadan önce `.claude/settings.json`
yazılır: `{ "permissions": { "deny": [...] } }`. Dosya varsa `deny` birleşir, başka anahtara dokunulmaz.

Gerekçe: pilot §8'in kurulum sırası "ofisi duraklat, işe al, Durdur, dosyayı koy, Devam" idi, çünkü `hire` oturumu
hemen açıyor. Dosya artık oturumdan önce yazılıyor; ilk oturum dosyalı açılır, duraklatma gerekmez.

Benimsenen (zaten var olan) çalışanın masasına dokunulmaz. Okuma bunu "kapalı kip uygulanmadı: var olan çalışan"
diye söyler.

**Sınırı (B9'a kadar):** kural çalışanın kendi masasındaki dosyadadır. Çalışan `bypassPermissions` ile, Write ya da
Bash'le dosyayı değiştirebilir. Bu kazara yayını ve gönderimi durdurur, kararlı bir çalışanı durdurmaz (pilot §8).
Kaldırılan kural bir sonraki oturumda `blueprintRead`'de "TUTMADI" görünür. Plan kartının riskler satırı da bunu
yazar; korunan yollar B9'un işi.

**Etkisiz doğrulama (yalnız liste, salt okunur):** hiçbir araç denemek için çağrılmaz. `blueprintRead` her masa ve
kural için B3 kaydının son oturum satırını okur:
- `mcp__sunucu` kuralı: masada sunucu `denied` → doğrulandı. Araçlarıyla açık → **TUTMADI**. Bağlı değil (yetki
  bekliyor, hata) → araç yok. Oturum yok → henüz doğrulanmadı.
- `mcp__sunucu__araç` kuralı: masanın araç adları (B7) bu aracı içermiyor → doğrulandı.
- `mcp__sunucu__*` (joker) kuralı: CLI bunu sunucunun kendisi gibi uygular (Kerem'in K3'ü, claude 2.1.293). Okuma da onu
  sunucu kuralı gibi okur: sunucu tanınıyorsa "tanınmıyor" demez. Masada sunucunun aracı yoksa doğrulandı, varsa
  TUTMADI. Kısmi joker (`send_*`) bir araç adı gibi okunur, yani tanınmaz (görev 8d67d8ba).
- `Bash(…)` ve diğer kalıplar: listeyle doğrulanamaz, çağrı anında reddedilir (pilot §8, K3 kanıtlı). Okuma bunu
  açıkça yazar.
- **Tanınmayan ad (inceleme turu 1):** sunucu kuralının sunucusu hiçbir oturumda görülmemiş ve sözlükte yoksa, ya da
  araç kuralının aracı hiçbir güncel masanın oturum listesinde ve sözlükte yoksa, kural `unknown` olur: "tanınmıyor;
  kural bir şey kapatmıyor olabilir". "Doğrulandı" yalnız var olduğu bilinen bir aracın masada olmamasıdır. Yanlış
  yazılmış bir ad (`send_email`; gerçeği `send_message`) böylece doğrulanmış görünmez. `blueprintPropose` bu adları
  plan kartının riskler satırında onaydan önce sayar.
- **Sıra testi:** dosyanın ilk oturumun süreci başlatılmadan önce diskte olduğu doğrudan sınanır: testte `spawn`
  sarılır, her çağrıda masanın ayar dosyası okunur (`engine-desk-deny.test.ts`).

## 5. Araçlar ve API

```
blueprintPropose(blueprint, planId?, goalId?)  koordinatör   doğrular, plan kartı açar; planId ile revize eder
blueprintApply(planId)                         koordinatör   onaylı planın blueprint'ini kurar; adım adım rapor
blueprintRead(planId)                          liderler      blueprint, adımlar, kapalı kip doğrulaması
GET /api/plans/:id/blueprint                   sahibi        { blueprint, steps, closedMode } (JSON)
```

## 6. Göç v18

```sql
CREATE TABLE blueprints (
  plan_id TEXT PRIMARY KEY,          -- bir plana bir blueprint (revizyon üstüne yazar)
  json TEXT NOT NULL,
  profile_version INTEGER NOT NULL,  -- dayandığı şirket profili sürümü (A4 farkı için)
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE blueprint_steps (
  plan_id TEXT NOT NULL,
  step TEXT NOT NULL,                -- 'role:yazar', 'goal:h1' …
  ref TEXT,                          -- oluşan ya da benimsenen kayıt
  outcome TEXT NOT NULL,             -- done | adopted
  at INTEGER NOT NULL,
  PRIMARY KEY (plan_id, step)
);
```

Yeni tablolar; mevcut tablolara dokunulmaz. Eski planların blueprint'i yoktur; plan kartları aynen çalışır.
`down`: iki tablo düşer.

## 7. Doğrulama

- **Birim (K1):**
  - şema doğrulaması (her kural);
  - profil denetimi;
  - sınırlar (masa, hedef, rutin, adım);
  - plan kartı alanları ve yetenek durumu;
  - kurulum sırası;
  - ikinci çalıştırmanın hiçbir şey eklememesi (çalışan, hedef, el kitabı, rutin, görev, olay sayıları birebir);
  - yarıda kalan kurulumun sürmesi;
  - kaydı olmayan ama var olan varlığın benimsenmesi;
  - revizyon;
  - kapalı kip dosyası ilk oturumdan önce;
  - salt okunur doğrulama durumları;
  - eski plan kartlarının aynen çalışması;
  - araçlar, API, göç v18.
- **Mutasyon kontrolü** (geçici worktree'de).
- **K4 (kopya):** canlı DB'nin salt okunur kopyasında v15→v18 ve geri.
- **K3** (`OFFICE_SMOKE=1`, stub sunucular + `LOCKED_ARGS`): kurulumun yazdığı masa dosyası gerçek CLI'de geçerli.
  Masada gerçek bir `init` alınır; deny edilen stub'ın aracı listede yoktur ve `blueprintRead` "doğrulandı" der.
  Hiçbir araç çağrılmaz, süreç `init`'te öldürülür.

## 8. Değişiklik günlüğü

- **Sürüm 2 (inceleme turu 1, Kerem).**
  - **[önemli]** Araç düzeyindeki kural var olmayan bir aracı adlandırınca okuma "doğrulandı" diyordu. Düzeltme:
    `unknown` durumu ve kartta uyarı (§4).
  - **[küçük]** İşten çıkarılan rolün çalışanı yüzünden revizyon sonsuza dek takılıyor, mesaj yanlış yol gösteriyordu.
    Düzeltme: doğru yolu söyleyen mesaj ve kartta uyarı (§3).
  - **[küçük]** Revizyonda kurulu rutin ve görevler iki kez sayılıyordu (§2).
  - **[küçük]** Kapalı kibin sınırı notta ve kartta yoktu (§4).
  - **[küçük]** Dosyanın oturumdan önce yazıldığı yalnız zamanlamayla korunuyordu; doğrudan test (§4).
- **Sürüm 3 (görev 8d67d8ba, Kerem'in B5 onay notu).** Joker araç kuralı (`mcp__sunucu__*`) okumada ve kartta
  "tanınmıyor" görünüyordu; artık sunucu kuralı gibi okunuyor (§4).
