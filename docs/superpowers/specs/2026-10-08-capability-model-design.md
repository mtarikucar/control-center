# control-center — Rol/görev ↔ yetenek modeli (B7) tasarım notu

- Tarih: 2026-10-08 · Yazan: Mert · Görev: 207cdfd3 (plan "Çekirdek 3", B7) · İnceleyen: Kerem
- Dayandığı: `bosluk-analizi.md` §2 B7 satırı, yerleştirme notu ("yeni sütun + sözlük dosyası + isteğe bağlı araç
  alanı; mevcut davranışı değiştirmez") ve §3 "B7 — Rol/görev ↔ yetenek modeli yok"; `hedef-mimari.md` §4 B2
  (`hire` + `capabilities[]`, yetenekler kayıtla eşlenir) ve D2 (sözlük ürünle gelir; yetenek → somut bağlayıcı araç
  adları; `employees.capabilities`, `tasks.requires`), §6.
- Dal `feat/capability-model`, `feat/role-templates` (B6, 7808b8e) üstünde. **Göç v17** (v16 B6).

## 1. Bugün ve kapsam

Yetenek bugün yalnız iki yerde metin olarak duruyor: B6 şablonlarının ön bilgisinde (`capabilities:`) ve B3
kaydının elle yazılan `capabilities` alanında. Çalışan ve görev yetenek bildirmez, iki liste arasında eşleme yok.

Bu iş:
- ürünle gelen **yetenek sözlüğü** (kimlik, ad, dışa dönük mü, yerleşik araçlar, bilinen bağlayıcı araç adları),
- çalışanın bildirdiği yetenekler (`employees.capabilities`) ve görevin istediği yetenekler (`tasks.requires`),
- bu yeteneklerin **B3 kaydıyla eşlenmesi**: hangi bağlayıcı sağlıyor, bu masada açık mı, değilse neden,
- okuma aracı `capabilitiesRead` ve `GET /api/capabilities`.

**Kapsam dışı:**
- **Davranış değişikliği yok.** Eksik yetenek işe almayı ya da görevi durdurmaz, öneri açmaz. Eksik yetenek yalnız
  cevapta ve okumada görünür. Görevi `blocked` açmak ve sahibine `need` önerisi B8'in işi (ön-kontrol).
- Rolde olmayan dışa dönük araçları oturumda kapatmak B9'un işi (`--disallowedTools`/kanca).
- Rutinlerin (`scheduleCreate`) yetenek istemesi (rutin görevleri `requires` taşımaz; gerekirse B5/B8).
- Web ekranı (API hazır).

## 2. Yetenek sözlüğü (ürünle gelir, DB'ye yazılmaz)

Dosya: `apps/office-server/src/company/craft/capabilities.json`.

```json
{
  "version": 1,
  "capabilities": [
    {
      "id": "email.send",
      "title": "E-posta gönderme",
      "summary": "Şirket adına e-posta gönderir, yanıtlar, iletir.",
      "outward": true,
      "builtin": [],
      "tools": ["mcp__claude_ai_Gmail__send_message", "mcp__claude_ai_Gmail__reply", "…"]
    }
  ]
}
```

- `id`: `alan.eylem` (küçük harf).
- `outward`: dışa dönük ve geri alınamaz iş (gönderim, yayın, ödeme, davet). B9'un kapısı bu alana bakacak; B7 yalnız
  gösterir.
- `builtin`: Claude Code'un kendi araçları (`WebFetch`, `Read`, `Write` …). Bunlar her oturumda var; o yüzden yerleşik
  aracı olan yetenek her masada **açık** sayılır. Ofis bugün bunlardan hiçbirini kapatmıyor (`args.ts`
  `DISALLOWED_TOOLS` yalnız zamanlayıcılar). B9 bir rolden yerleşik araç kaldırırsa bu kural masanın araç listesine
  bakmalı.
- `tools`: bilinen bağlayıcıların tam araç adları. Bağlayıcı, araç adının önekinden bulunur (`mcpToolPrefix`:
  `claude.ai Gmail` → `mcp__claude_ai_Gmail__`). Araç düzeyinde tutulmasının nedeni B8 ve B9: B8 bir aracın hata
  olayını yeteneğe bağlayacak, B9 rolde olmayan dışa dönük araçları kapatacak. Bir araç en fazla bir yetenekte
  geçer.

Dosya yüklenirken denetlenir:
- biçim, yinelenen kimlik ve iki yetenekte geçen araç,
- boş ad ya da özet,
- `mcp__sunucu__araç` biçiminde olmayan bağlayıcı aracı.

**İlk sözlük (sürüm 1, 16 yetenek)** — D2'nin listesi ve taslak ayrımı:

| id | Dışa dönük | Yerleşik | Bilinen bağlayıcılar (bu makinede bağlı olanlardan) |
|---|---|---|---|
| `docs.read` | | Read, Glob, Grep | Notion, Claude Docs |
| `docs.write` | | Write, Edit | Notion, Claude Docs |
| `web.fetch` | | WebFetch, WebSearch | apify, Playwright (gezinme, okuma) |
| `email.read` | | | Gmail |
| `email.draft` | | | Gmail (taslak) |
| `email.send` | evet | | Gmail, jeeta |
| `calendar.read` | | | Google Calendar |
| `calendar.write` | evet (davet gönderir) | | Google Calendar |
| `social.read` | | | jeeta, Higgsfield (TikTok hesapları) |
| `social.draft` | | | jeeta (taslak) |
| `social.publish` | evet | | jeeta, Higgsfield (TikTok yayın hazırlığı) |
| `crm.read` | | | jeeta |
| `crm.write` | | | jeeta |
| `payments.read` | | | — (kayıttan) |
| `payments.charge` | evet | | — (kayıttan) |
| `ecommerce.orders` | | | — (kayıttan) |

Araç adları canlı oturumun araç listesinden alındı (bağlı sunucular: Gmail 30, jeeta 46, Higgsfield 120, Notion 46,
Google Calendar 9, apify 11, Claude Docs 8, Playwright 25 araç). Yetki bekleyen bağlayıcıların (Slack, HubSpot, Drive
…) araç adları oturumda görünmediği için sözlükte yok. Onları ve sözlükte bağlayıcısı olmayan yetenekleri
(`payments.*`, `ecommerce.orders`) şirket kendi kaydında bağlar: `integrationRegister(name, capabilities)`.

Taslak yetenekleri (`email.draft`, `social.draft`) dışa dönük değil. Onay akışında çalışan taslak yazar, gönderimi
sahibi onaylar (B9'un 4. katmanı). B6 şablonları değişmedi: dışa dönük rollerin şablonu `email.send`/`social.publish`
bildirir ve gövdesi "sahibinin onayıyla" der. Şablonların `draft`'a geçmesi B9 tasarımında karara bağlanır.

Bundan sonra şablonların yetenekleri de sözlükte olmak zorunda: `parseRoleTemplate` bilinmeyen yeteneği reddeder.

## 3. Bildirim: çalışan ve görev

**Çalışan** (`Employee.capabilities: string[]`):
- `hire(template)`: verilmezse şablonun yetenekleri.
- `hire(capabilities)`: listenin tamamı, şablonunkinin yerine geçer (`[]` boşaltır).
- `editRoleCard(capabilities)`: sonradan değiştirir. Serbest metinle alınmış eski çalışanlar da böyle yetenek kazanır.
- Rol kartı (`CLAUDE.md`) değişmez. Yetenekler kayıtla birlikte okunur (`capabilitiesRead`), kart metni bayatlamaz.

**Görev** (`Task.requires: string[]`):
- `taskCreate(requires)` ve `taskPass(requires)`, isteğe bağlı.
- Görev mesajına "Gereken yetenekler: …" satırı eklenir, `myTasks` satırına da. Yalnız yetenek isteyen görevde
  görünür.
- İnceleme, devir ve rutin görevleri yetenek istemez.

**Doğrulama:**
- Her kimlik sözlükte olmalı ("Bilinmeyen yetenek: x. Sözlük: …").
- Yinelenenler bir kez sayılır, liste metin dizisi olmalı.
- Bilinçli bir sıkılık: B8 eşleşmesi yazım hatasına dayanmamalı.

**B3 kaydı `integrationRegister(capabilities)` bugünkü gibi her metni kabul eder** (B3 davranışı değişmez). Sözlükte
olmayan bir kimlik yazılırsa cevap bunu ve eşleşmede kullanılmayacağını söyler.

## 4. Eşleme: yetenek ↔ B3 kaydı

Saf bir işlev: `coverage(integrations, capabilities, employeeId?)`. Kaydın o anki listesini okur (B3 gibi her
seferinde olaylardan türetilir; ayrıca saklanmaz).

**Sağlayıcı:** kayıttaki bir bağlantı, iki yoldan biriyle bir yeteneği sağlar:
- **Sözlük yoluyla:** sözlükte o yeteneğin bir aracı bağlantının önekiyle başlıyor (`via: vocabulary`).
- **Kayıt yoluyla:** koordinatör o yeteneği bağlantının kaydına yazmış (`via: registry`).

Her sağlayıcı için şunlar verilir:
- bağlantının durumu,
- sorulan masadaki satırı (B3 `IntegrationDesk`: açık mı, değilse `closedBy`),
- açık olduğu masalar.

**Masa için durum** (sırayla ilk uyan):

| Durum | Ne zaman | Örnek |
|---|---|---|
| `open` (açık) | yerleşik aracı var, ya da bir sağlayıcı bu masada açık | `web.fetch`; Gmail bu masada bağlı ve araçlı |
| `manual` (elle kayıtlı) | açık değil; ama türü `adapter`/`cli` olan, kayıtta kapatılmamış bir sağlayıcı var (oturumlar bunları hiç bildirmez, ofis doğrulayamaz) | `payments.read` → elle kayıtlı `iyzico-cli` |
| `shut` (masada kapalı) | bu masanın son oturumu bir sağlayıcıyı bildirdi ama hiçbiri açık değil | Gmail yetki bekliyor; jeeta masa ayarıyla kapalı; kayıtta kapatıldı |
| `unseen` (bu masada görülmedi) | masanın henüz hiç oturumu yok (kayıtta hiçbir bağlantıda satırı yok), başka bir masada açık bir sağlayıcı var | yeni işe alınan |
| `missing` (yok) | hiçbiri: sağlayıcı yok, ya da masanın oturumu onu hiç bildirmedi ve oturumu olmayan masada da hiçbir yerde açık değil | `ecommerce.orders`; masanın oturumunda Gmail hiç yok |

**Ofis için durum** (masa sorulmadan, sözlük okuması):
- `open`: yerleşik ya da bir masada açık,
- `manual`,
- `shut`: sağlayıcı var ama hiçbir masada açık değil,
- `missing`: sağlayıcı yok.

Neden bu sıra:
- Masanın kendi son oturumu en güçlü kanıttır.
- Elle kayıtlı adaptör/CLI oturumdan bağımsız çalışır ama doğrulanmaz, bu yüzden ayrı bir durumdur.
- `unseen` yalnız henüz oturumu olmayan masanın durumudur: masalar sahibinin ayarlarını devralır, büyük olasılıkla
  aynı bağlayıcı gelir; ama masa ayarı onu kapatabilir, o yüzden "açık" sayılmaz. Oturumu olan masanın son oturumunda
  sağlayıcı hiç yoksa o masada yoktur (`missing`); metin başka nerede açık olduğunu yine söyler.

Sınırlar:
- Eşleme **bağlantı düzeyindedir**. B3 masa başına sunucunun araç sayısını tutar, araç adlarını tutmaz. Masa
  ayarının yalnız `send_message`'ı kapatması görülmez; Gmail açık sayılır. Araç düzeyi B9'da gerekir.
- Durum son oturum açılışı anınındır (B3 §7).

## 5. Araçlar ve API

```
capabilitiesRead(employee?, task?)   herkes        salt okunur
  –                                  sözlük + ofisteki karşılığı
  employee                           o kişinin yetenekleri ve masasındaki karşılığı
  task                               görevin istedikleri ve atananın masasındaki karşılığı
  task + employee                    görevin istedikleri o kişinin masasında (kime verilir?)
hire(…, capabilities?)               koordinatör   cevap: yetenekler ve masadaki karşılığı
editRoleCard(…, capabilities?)       koordinatör
taskCreate(…, requires?)             liderler      cevap: atananın masasında karşılığı
taskPass(…, requires?)               herkes        aynı
taskAssign                           liderler      görev yetenek istiyorsa cevap yeni atananın karşılığını söyler
GET /api/capabilities[?employee=id]  sahibi        { version, capabilities: Capability[], coverage: CapabilityCoverage[] }
POST /api/employees {…, capabilities?}  sahibi
```

Cevaplar eksik yeteneği söyler ve işi yine yapar ("görev yine açıldı; eksik yetenek için sahibinden yetki iste:
propose"). Okuma hiçbir bağlayıcıyı çağırmaz ve olay yazmaz.

## 6. Göç v17

```sql
ALTER TABLE employees ADD COLUMN capabilities TEXT;  -- JSON liste; NULL = bildirilmedi
ALTER TABLE tasks ADD COLUMN requires TEXT;          -- JSON liste; NULL = istemiyor
```

- Eski satırlar `NULL` alır ve `[]` okunur.
- Yetenek bildirmeyen işe alma ve görev satırı **v17 öncesiyle birebir aynı** yazılır. Sütun yalnız liste boş
  değilse yazılır (B6'daki ders: eski şemalı veritabanında, ekonomi raporu testi şema 5, kadro ve görev eskisi gibi
  çalışır).
- `editRoleCard` sütuna yalnız `capabilities` verildiğinde dokunur; `[]` → `NULL`.
- `down`: iki sütun düşer.

## 7. Doğrulama

- **Birim (K1):**
  - sözlük ayrıştırıcısının kuralları ve ürünle gelen sözlük;
  - her şablonun yetenekleri sözlükte, bilinmeyen yetenekli şablon reddi;
  - işe alma (şablondan, verilen, `[]`, serbest metin + yetenek, bilinmeyen);
  - `editRoleCard`;
  - görev (`requires` kaydı, mesaj ve `myTasks` satırı, bilinmeyen);
  - eşleme: her durum, sözlük ve kayıt yolu, kapalı kayıt, `denied` masa, işten çıkarılan masa, yerleşik araç,
    ofis okuması;
  - araç cevapları, API, göç v17.
- **Eski davranış:**
  - yeteneksiz işe alma ve görev aynı (satır, cevap, mesaj);
  - eski şemalı veritabanı (ekonomi raporu testi);
  - mevcut test takımı.
- **Mutasyon kontrolü:** sözlük kuralları, durum sırası, sağlayıcı yolları, varsayılan ve üstüne yazma, eski satır,
  görev mesajı.
- **K4 (kopya):** canlı DB'nin salt okunur kopyasında v15→v17 ve geri. Canlı kayıtta, sözlükteki her bağlayıcı
  önekinin bir kayıt adıyla eşleşmesi ve şablon yeteneklerinin canlı masalardaki karşılığı.
- **K3** (`integrations.real.test.ts` genişletilir, `OFFICE_SMOKE=1`, stub sunucular + `LOCKED_ARGS`): gerçek
  `init` → kayıt → eşleme. Açık stub'a kaydedilen yetenek `open`, masa ayarıyla deny edilen stub'ınki `shut`
  (`closedBy: desk`). Süreç `init`'te öldürülür.
