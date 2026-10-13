# control-center — Yetenekler ve otonomi (alt proje 3) tasarım notu

- Tarih: 2026-10-13 · Sahibinin kararlarıyla (departmanlar spec'i Ek C); sahibinin "soru sorma, devam et"
  talimatıyla açık kalanlar burada karara bağlandı (§10).
- Dal `feat/departments` (alt proje 1 ve 2'nin üstünde). **Göç v25** (dalda; birleştirmede bilgi tabanının v24'ü ve
  departmanların v24'ü öne geçince yeniden numaralanır).
- Son inceleme düzeltmelerinden sonra kodla hizalandı (§4.2, §5, §6, §7, §8, §9, §11).
- Dayandığı: yetenek modeli (B7, `capabilities.ts`, `craft/capabilities.json`), onay kapısı (B9a, `gate-policy.ts`,
  `gate.ts`, `approvals.ts`, `hooks/gate.mjs`), oturum kapatma (B9b, `session-deny.ts`), Anayasa (`budget.ts`).

## 1. Bugün ve kapsam

- **Yetenek sözlüğü** ürünle gelen bir dosya: 23 yetenek, 78 araç. Sözlükte olmayan bir bağlayıcı aracı dışa dönük
  sayılır, oturumda kapatılır ve kapıda tutulur. Şirket yeni bir yetenek tanımlayamaz.
- **Onay kapısı** dışa dönük her çağrıyı türüne göre (gönderim, yayın, ödeme, silme, tarayıcı, ofisin kendisi,
  diğer) tutar ve sahibinin onayını ister. Takvim daveti, arama, mesaj ve e-posta aynı türdür (`send`).
- **Kapı varsayılan kapalı** (`gateEnabled: false`) ve **sahibinin canlı ofisinde de kapalı**: bugün dışarıya giden
  her şeyi yalnız rol metinlerindeki kurallar sınırlıyor; mekanik bir sınır, kayıt ya da özel kişi listesi yok.

**Bu iş:**
1. **Yetenek türleri:** her yetenek bir tür taşır — okuma, gönderim, takvim, arama, yayın, ödeme, silme. Kapı türü
   buradan okur.
2. **`messages.read`:** gelen SMS, WhatsApp ve sosyal medya mesajlarını ve yorumları okuma (sözlük sürüm 3).
3. **Şirketin eklediği yetenekler** (veritabanı): çalışan önerir, koordinatör onaylar, sahibi her şeyi görür,
   ekler, onaylar, geri alır. Para ve silme türleri sistemce başka türe çekilemez.
4. **Otonomi politikası** (Anayasa): gönderim, yayın, arama ve takvim için "Sahibine sor / Sistem halletsin".
   Sahibinin seçimi: gönderim, yayın ve arama **sistem**; takvim **sahibi**. Ödeme, silme, tarayıcı, ofisin
   kendisi ve sınıflandırılmamış araçlar **her zaman sahibine** (ayarla değişmez).
5. **Kapının kuralları** (sistem hallederken, mekanik): departman başına saatlik gönderim sınırı, toplu gönderim
   eşiği, özel kişiler listesi, arama için mesai saatleri ve günlük sınır; aşılınca çağrı sahibine gider.
6. **Giden kutusu:** gönderim, yayın, arama ya da takvim parçası olan, kapının sistem adına geçirdiği ya da sahibinin
   onayladığı her çağrının kaydı; onaylanan ödeme, silme, tarayıcı, ofis ve diğer işler onaylarda ve `gate.checked`
   olaylarında kalır. Koordinatör ve başkanlar okur (`outboxRead`), sahibi Şirket görünümünde görür.
7. **Muhakeme katmanı:** kritik durumlar (para sözü, hukuki, kriz, cevabı bilinmeyen, ticari ileti izni, toplu
   gönderim, özel kişiler) rol ve yöntem metinlerinde; çalışan bunlarda göndermez, `approvalRequest` ile sahibine
   getirir.
8. **Şablonlar:** İletişim, Müşteri Temsilcisi, Pazarlama, Satış ve ilgili departman şablonları yeni sürüm.

**Kapsam dışı:** kapının mesaj içeriğini anlaması (içerik sınıflandırması); İYS kaydının dış sistemden okunması;
gönderimin teslim edildiğinin doğrulanması (giden kutusu "izin verilen çağrı"yı kaydeder).

## 2. Yetenek türleri

```ts
type CapabilityKind = 'read' | 'send' | 'calendar' | 'call' | 'publish' | 'pay' | 'delete';
```

- `capabilities.json` her yeteneğe `kind` alanı ekler (sözlük sürüm 3). `outward` alanı türden türetilir
  (`read` dışındakiler dışa dönük) ve dosyada kalır; ayrıştırıcı ikisinin uyuştuğunu denetler.
- Ürünle gelenlerin türleri bugünkü `KIND_BY_CAPABILITY` eşlemesinin ayrıştırılmış hali: `email.send` ve
  `messages.send` gönderim; `calendar.write` takvim; `calls.make` arama; `social.publish` ve `web.publish` yayın;
  `payments.charge`, `ads.manage`, `media.generate`, `automation.run` ödeme; `email.delete` silme; geri kalanı okuma.
- Kapının onay türleri (`ApprovalKind`) iki yeni değer alır: `calendar` ve `call` (bugün ikisi de `send`).
  `gate-policy.ts`'in eşlemesi yeteneğin türünden okunur; Bash ve yerleşik araçların ürettiği türler (git push →
  yayın, posta komutları → gönderim) değişmez.

## 3. `messages.read`

- Yeni ürün yeteneği: "Gelen mesajları ve yorumları okuma — SMS, WhatsApp ve sosyal medya mesajlarını, gönderi
  yorumlarını okur; hiçbir şey göndermez." Tür `read`.
- Bugün `crm.read`'de duran `jeeta_list_conversations` ve `jeeta_read_conversation` buraya taşınır (konuşmalar
  mesajdır; bir araç yalnız bir yetenekte durabilir). `crm.read` aday, kişi, fırsat ve huniyi okumaya devam eder.
- `iletisim-yoneticisi` ve `musteri-temsilcisi` şablonları `messages.read` alır (yeni sürüm).

## 4. Şirketin eklediği yetenekler

### 4.1 Kayıt

```ts
interface CustomCapability {
  id: string;            // a-z.a-z, ürünle gelenlerle çakışmaz
  title: string;
  summary: string;
  kind: CapabilityKind;
  tools: string[];       // mcp__sunucu__araç; ürünle gelen ya da etkin başka bir yetenekte geçmez
  status: 'proposed' | 'active' | 'rejected' | 'retired';
  proposedBy: string;    // çalışan kimliği ya da 'owner'
  decidedBy: string | null;
  note: string | null;
  createdAt: number;
  decidedAt: number | null;
}
```

Göç v25: `custom_capabilities` tablosu (yukarıdaki alanlar, `tools` JSON). Down tabloyu kaldırır.

**Sözlük** = ürünle gelenler ∪ etkin (`active`) şirket yetenekleri. Bugün modülde süresiz önbelleklenen sözlük ve
araç sınıfı tablosu bir sürüm sayacıyla yenilenir: şirket yeteneği değişince sayaç artar, sonraki okuma yeniden kurar.

### 4.2 Akış

| Kim | Ne yapar |
|---|---|
| Her çalışan | `capabilityPropose(id, title, summary, kind, tools)` → `proposed`; koordinatöre karar notu |
| Koordinatör | `capabilityDecide(id, accept | reject, kind?, note)` — başkasının önerisini karara bağlar, türü değiştirebilir |
| Koordinatörün kendi önerisi | sahibine gider (yapan ≠ denetleyen); Yetenekler sekmesinde onay bekler |
| Sahibi | sekmeden ekler (hemen etkin), bekleyenleri onaylar/reddeder, etkin olanı geri alır (`retired`), türü değiştirir |

**Para ve silme kuralı:** önerilen tür `pay` ya da `delete` ise koordinatör onu başka bir türe çekemez (yalnız
sahibi). Kapı için güvenli yön tek: koordinatör türü yalnız aynı bırakabilir ya da daha sıkıya (`read` → herhangi bir
dışa dönük tür) çekebilir; dışa dönük bir türü `read`'e indirmek de yalnız sahibinindir.

**Okuma kuralı:** okuma araçları her oturumda açıktır ve kapıdan geçer (kapı kapalıyken de); bir aracı okuma olarak
sınıflandırmak, okuma önerisini okuma olarak kabul etmek dahil, yalnız sahibinindir. Koordinatör bir okuma önerisini
ancak dışa dönük bir türe sıkılaştırarak kabul eder; reddedebilir ya da sahibine bırakabilir.

**Sahibinin onayı (`confirm`):** koordinatörün tek başına etkinleştirdiği bir yetenek, sahibi onu Yetenekler
sekmesinden sisteme açana dek (`POST /api/custom-capabilities/:id/confirm`; yalnız sahibi) kapıda sahibine sorulur —
politika "sistem" dese de. Sahibinin eklediği, kabul ettiği ya da türünü değiştirdiği yetenek ile ürünle gelenler
baştan sisteme açıktır. Onay `decidedBy`'ı sahibi yapar ve `capability.changed` olayını `confirmed` değişimiyle
yayımlar; bir kez onaylanmış olana tekrar onay etkisizdir. Kapı açılmadan önce koordinatörün etkinleştirdikleri de
sahibinin onayını bekler.

**Bildirim:** her etkinleştirme ve geri alma bir olay (`capability.changed`); koordinatörün onayladıkları Yetenekler
sekmesinde "yeni" işaretiyle görünür (sahibine bilgi). Geri alınan yeteneğin araçları yeniden sınıflandırılmamış
sayılır (kapı tutar, oturum kapatır).

**Oturumlar:** yeni bir yeteneği bir çalışanın kullanabilmesi için rolüne eklenmesi gerekir (`editRoleCard
capabilities`, bugünkü gibi); oturum kapatma listesi bir sonraki oturum açılışında güncellenir.

## 5. Otonomi politikası

Anayasa'ya yeni alan:

```ts
outwardPolicy: { send: 'owner' | 'system'; publish: 'owner' | 'system'; call: 'owner' | 'system'; calendar: 'owner' | 'system' };
```

- Varsayılan: sahibinin seçimi — `send`, `publish`, `call` **system**; `calendar` **owner**.
- `pay`, `delete`, `browser`, `self`, `other` politikada yok: her zaman sahibine.
- Politika yalnız **kapı açıkken** anlam taşır (kapı kapalıyken bugünkü gibi her şey geçer). Kapıyı açmak sahibinin
  kararıdır (Anayasa'daki mevcut anahtar); bu iş kapıyı kendiliğinden açmaz.

**Kapının kararı** (`Gate.check`, çağıranı bilir): bir çağrının parçaları sınıflandırıldıktan sonra, bağlayıcı (MCP)
aracından gelen ve türü politikada `system` olan her parça **sistem parçası**dır. Bütün parçalar sistem parçasıysa ve
§6'nın kuralları geçerse çağrı onaysız geçer ve giden kutusuna yazılır; bir parça bile sahibinin onayını istiyorsa
bugünkü akış (onay iste, sonra geçer). Bash ve yerleşik araçların gönderim/yayın türleri her zaman sahibine.

Sistem yolu, politika `system` dese de şu durumlarda çağrıyı sahibine bırakır:
- **Sahibine sorulmuş çağrı:** çalışanın aynı çağrı için (aynı araç, tür ve hedef) `approvalRequest` isteği bekliyorsa
  ("sahibine soruldu, cevap bekleniyor") ya da sahibi onu bir onay süresi (24 saat) içinde reddettiyse ("sahibi bu
  çağrıyı reddetti"). Onay yalnız aynı çağrının tekrarını açar; başka alıcı ya da hedefteki başka sözcükler başka
  çağrıdır.
- **Sisteme açılmamış yetenek:** koordinatörün tek başına etkinleştirdiği şirket yeteneği (§4.2): "koordinatörün açtığı
  yetenek: sahibi sisteme açana dek sahibine sorulur".

## 6. Kapının kuralları (sistem parçaları için)

Anayasa alanları (varsayılanlarla):

| Alan | Varsayılan | Kural |
|---|---|---|
| `sendsPerHour` | 30 | Departman (departmansız çalışan için kişi) başına son bir saatte sistemce geçen gönderim + yayın sayısı bu sınıra gelince sahibine |
| `bulkRecipients` | 5 | Bir çağrının alıcı sayısı (to, cc, bcc, recipients… alanları; dizi ya da virgüllü metin) bunu aşarsa sahibine |
| `specialContacts` | [] | Çağrının girdisinde bu kişilerden biri geçerse sahibine. Liste e-posta, telefon, kullanıcı adı, kişinin ya da firmanın adı (bütün bir ifade olarak aranır) ya da kişinin aday ve konuşma kimliğidir; e-posta küçük harfle, telefon rakamlarıyla, ad ve kullanıcı adı küçük harfle (Türkçe katlama) karşılaştırılır ve girdinin her metninde aranır |
| `callHours` | [9, 19] | Arama bu saatler dışındaysa (yerel saat) sahibine |
| `callsPerDay` | 20 | Departman başına bugünkü sistem araması bu sınıra gelince sahibine |

- Kuralı aşan çağrı tutulur ve gerekçesi kuralı söyler ("saatlik gönderim sınırı (30) doldu", "toplu gönderim: 12
  alıcı > 5", "özel kişi: ali@…", "mesai dışı arama (21:40)"). Çalışan bugünkü gibi `approvalRequest` ile ister.
- Sahibinin onayladığı çağrılar da giden kutusuna yazılır ama sayaçlara girmez.
- **Sıra:** okunamayan girdi, özel kişi, alıcıları görünmeyen gönderim, toplu gönderim, arama saati ve günlük sınır,
  saatlik sınır; ilk tutan kuralın gerekçesi söylenir.
- **Okunamayan girdi:** 64 düzeyden derin ya da 10 000'den çok değer taşıyan girdi sonuna kadar okunamaz; içinde bir
  kişi ya da alıcı gizli olabileceğinden çağrı sahibine gider ("okunamayan girdi: çok derin ya da çok büyük").
- **Özel kişi yalnız girdide aranır.** Kimlikle adreslenen çağrılarda (aday ya da konuşma kimliğiyle e-posta, mesaj ya
  da arama) kapı kişiyi görmez; sahibi kimlikleri de listeye yazar, kimlik girdide geçerse eşleşir.
- **Alıcıları görünmeyen gönderim:** gönderim türündeki bir çağrıda `draftId` alanı (her derinlikte, büyük-küçük harf
  ve `_` ile `-` fark etmez) ya da doğru bir `replyAll` varsa alıcılar ne sayılabilir ne özel kişiyle eşlenebilir;
  çağrı sahibine gider ("alıcılar girdide yok (taslak / hepsini yanıtla)"). Yayın ve öteki türler etkilenmez. Kimlikle
  yapılan tek kişilik bir yanıt (`reply {messageId}`) tutulmaz.

## 7. Giden kutusu

- Kapsam: gönderim, yayın, arama ya da takvim parçası olan her çağrı — sistemce geçen de sahibinin onayıyla geçen de.
  Onaylanan ödeme, silme, tarayıcı, ofis ve diğer (`other`) işler giden kutusuna girmez; onaylarda ve `gate.checked`
  olaylarında durur.
- Tablo `outbox` (göç v25): kimlik, çalışan, departman, araç, tür, hedef (kapının bugünkü kısa hedefi), alıcılar
  (en çok 20), özet (girdinin ilk 300 karakteri, gizli anahtar alanları çıkarılmış), `via` ('system' | 'owner'),
  onay kimliği, zaman.
- Kapı kapalıyken giden kutusuna yazılmaz. `outboxRead` bu durumda "Kapı kapalı: giden kutusuna yazılmıyor (sistem adına
  geçen çağrılar kaydedilmez)." diye yanıtlar; kapı açıkken yazılmış satırlar varsa önce bu cümle, sonra başlık ve
  satırlar gelir.
- Olay `outbox.sent` (web canlı günceller).
- Araç `outboxRead(since?, department?, limit?)`: koordinatör hepsini, başkan kendi departmanınınkini okur (günlük
  örnek inceleme için).
- Web: Şirket görünümünde **Giden kutusu** sekmesi (son 200, departmana ve türe göre süzülür).

## 8. Muhakeme katmanı

`craft/working.md`'ye (herkesin rehberi) bir bölüm: **"Sistemin senin adına gönderdiği"** — kapı gönderimi
geçirebilir; ama şu durumlarda göndermeden önce `approvalRequest` ile sahibine sor: para sözü (fiyat, indirim, iade,
ödeme tarihi), hukuki konu (avukat, tüketici hakem heyeti, KVKK talebi, sözleşme), kriz (basın, olumsuz yayılan
paylaşım, tehdit, ağır şikâyet), bilgi tabanında cevabı olmayan soru, ticari ileti izni olmayan kişiye ilk tanıtım
mesajı ya da araması (İYS), toplu gönderim (eşiği aşan alıcı), özel kişilere giden ya da onları anan her şey. Hepsi
kapı kapalıyken de geçerli bir talimattır; kapı açıkken mekanik tutmanın kapsamı çağrının girdisiyle sınırlıdır (§6),
bu yüzden çalışana olağan bir yanıtın alıcılarını çağrıya yazması da söylenir. Başkanlar için: kapı açıkken her gün
odalarının giden kutusundan örnek okuyup ton ve kural ihlali arar (rutin önerisi; şablonlara eklenir).

**Özel kişilerin çalışana görünmesi:** gönderim, yayın, arama ya da takvim yeteneği olan çalışanın masasında listenin
kendisi `special-contacts.md` olarak durur (rol kartı onu içe aktarır; Codex'in `AGENTS.md`'sine satır içi yazılır).
Dosya anayasa, rol kartı ya da bir şirket yeteneğinin türü değişince yenilenir; yalnız bloğu değişen masa yazılır; liste
boşken hiçbir yere yazılmaz. Çalışan değişikliği bir sonraki oturumunda görür.

## 9. Şablonlar ve arayüz

- Rol şablonları: `iletisim-yoneticisi` (v2: `messages.read`, `messages.send`; "Nasıl çalışırsın" otonomiye göre),
  `musteri-temsilcisi` (v3: aynı), `sosyal-medya` (v3: yayın sistemce, reklam harcaması sahibine),
  `satis-muduru`/`aday-arastirmaci` (v2: İYS kuralı), `pazarlama-muduru` (v2). Dışa dönük rollerin "Nasıl çalışırsın"
  kuralı "kritik olan sahibine; geri kalan sistemce" olur (rol şablonu testinin dışa dönük kuralı buna göre).
- Departman şablonları: `ic-dis-iletisim`, `pazarlama`, `satis` v2 ("Sana gelir" yalnız kritikler; giden kutusu
  rutin önerisi).
- Son inceleme sürümleri: `musteri-temsilcisi` ve `sosyal-medya` v4, `iletisim-yoneticisi`, `satis-muduru`,
  `aday-arastirmaci`, `pazarlama-muduru` v3, `icerik-yazari` v4, `yonetici-asistani` v2; `ic-dis-iletisim`, `pazarlama`,
  `satis` v3. Satış başkanı, aday araştırmacı ve sosyal medya uzmanı da toplu gönderim ve özel kişiler için önce
  sorar; Pazarlama bülteni ve toplu e-postayı hazırlar, gönderimini sahibine sorar (Pazarlama'da e-posta gönderen rol
  yok); başkanların giden kutusu örneği "kapı açıkken"dir; Yönetici Asistanı'nın kendi kuralı (taslak hazırlar,
  göndermez) müşteri yönteminden üstündür.
- Web: **Yetenekler** sekmesi (ürünle gelenler salt okunur; şirketinkiler: ekle, onayla/reddet, geri al, türü
  değiştir); **Anayasa**'ya otonomi politikası (dört seçim), özel kişiler listesi, beş sayısal kural; **Giden
  kutusu** sekmesi.

## 10. Açık kalanların kararları (sahibi soru istemedi)

- **Varsayılan politika** sahibinin seçimi (yukarıda); ürünün diğer kullanıcıları için de bu, çünkü kapı varsayılan
  kapalı — kapıyı açan, sistemin kurallarla göndermesini ve kritiklerin kendisine gelmesini seçmiş olur.
- **Kapıyı açmak** sahibinin işidir; canlı ofiste kapı kapalı kalır, sonuç raporu sahibine açmayı önerir.
- **Koordinatörün kendi önerdiği yetenek** sahibine gider (yapan ≠ denetleyen).
- **İYS** dışarıdan okunmaz; kural muhakeme katmanındadır.
- **Giden kutusu** "teslim edildi" değil "izin verildi" kaydıdır.

## 11. Kapının dışındaki korumalar ve sınırlar

- **İç içe oturum:** kabuktan açılan bir Claude Code ya da Codex oturumu (`claude`, `codex` ya da `npx`, `pnpm dlx`,
  `bunx` ile `@anthropic-ai/claude-code` ve `@openai/codex`; yalnız tek başına `--version`/`--help` serbest) ofisin
  kancasını taşımaz, sahibinin bağlantılarına kapıdan geçmeden ulaşır. Kapı açıkken `self` türüyle sahibine kalır.
  Yorumlayıcı kodundan başlatılan oturum da (bir komut çağrısının ya da listesinin ilk öğesi olarak yazılmışsa) aynı
  şekilde tutulur.
- **MCP ayarları:** `.mcp.json`, sahibinin `~/.claude.json` dosyası ve `.codex/config.toml` ile sahibinin `~/.claude`
  klasörüne (masanın proje belleği hariç) ve masanın `.claude` klasörüne yazma sahibine kalır; bir bağlayıcının adıyla
  yazılan sunucu o bağlayıcı sanılır ve gönderimleri sistemce geçerdi.
- **Yükleme zamanı yedeği:** ofisin Claude oturumları `disabledMcpjsonServers` ile sözlükteki her bağlayıcı sunucusunun ve
  `office`'in adını taşıyan `.mcp.json` sunucusunu yüklemez; ofisin kendi sunucusu `--mcp-config` ile gelir ve yüklenir.
  Ayar kancanın yedeğidir ve kancası takılı her ofis oturumunda geçerlidir (kapı açık olsun olmasın); kancasız oturum
  (yan soru) onu almaz.
- **Codex sınırı:** Codex çalışanlarının bağlayıcı çağrıları kapıdan geçmez; ofis Codex'e, Claude'daki gibi her araç
  çağrısını gören bir kanca bağlamıyor (Codex'in kabuk komutu ve dosya değişikliği onay istekleri kapıya sorulur).
  Politika, kurallar ve giden kutusu Claude çalışanlarının bağlayıcı çağrılarına işler; oturumda bilinmeyen araçları
  kapatma da (B9b) yalnız Claude'da.
