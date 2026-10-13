# control-center — Yetenekler ve otonomi (alt proje 3) tasarım notu

- Tarih: 2026-10-13 · Sahibinin kararlarıyla (departmanlar spec'i Ek C); sahibinin "soru sorma, devam et"
  talimatıyla açık kalanlar burada karara bağlandı (§10).
- Dal `feat/departments` (alt proje 1 ve 2'nin üstünde). **Göç v25** (dalda; birleştirmede bilgi tabanının v24'ü ve
  departmanların v24'ü öne geçince yeniden numaralanır).
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
6. **Giden kutusu:** kapının sistem adına geçirdiği ve sahibinin onayladığı her dışa dönük çağrının kaydı;
   koordinatör ve başkanlar okur (`outboxRead`), sahibi Şirket görünümünde görür.
7. **Muhakeme katmanı:** kritik durumlar (para sözü, hukuki, kriz, cevabı bilinmeyen, ticari ileti izni) rol ve
   yöntem metinlerinde; çalışan bunlarda göndermez, `approvalRequest` ile sahibine getirir.
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

## 6. Kapının kuralları (sistem parçaları için)

Anayasa alanları (varsayılanlarla):

| Alan | Varsayılan | Kural |
|---|---|---|
| `sendsPerHour` | 30 | Departman (departmansız çalışan için kişi) başına son bir saatte sistemce geçen gönderim + yayın sayısı bu sınıra gelince sahibine |
| `bulkRecipients` | 5 | Bir çağrının alıcı sayısı (to, cc, bcc, recipients… alanları; dizi ya da virgüllü metin) bunu aşarsa sahibine |
| `specialContacts` | [] | Çağrının girdisinde bu kişilerden biri geçerse (e-posta küçük harfle, telefon yalnız rakamlarıyla, kullanıcı adı küçük harfle karşılaştırılır) sahibine |
| `callHours` | [9, 19] | Arama bu saatler dışındaysa (yerel saat) sahibine |
| `callsPerDay` | 20 | Departman başına bugünkü sistem araması bu sınıra gelince sahibine |

- Kuralı aşan çağrı tutulur ve gerekçesi kuralı söyler ("saatlik gönderim sınırı (30) doldu", "toplu gönderim: 12
  alıcı > 5", "özel kişi: ali@…", "mesai dışı arama (21:40)"). Çalışan bugünkü gibi `approvalRequest` ile ister.
- Sahibinin onayladığı çağrılar da giden kutusuna yazılır ama sayaçlara girmez.

## 7. Giden kutusu

- Tablo `outbox` (göç v25): kimlik, çalışan, departman, araç, tür, hedef (kapının bugünkü kısa hedefi), alıcılar
  (en çok 20), özet (girdinin ilk 300 karakteri, gizli anahtar alanları çıkarılmış), `via` ('system' | 'owner'),
  onay kimliği, zaman.
- Olay `outbox.sent` (web canlı günceller).
- Araç `outboxRead(since?, department?, limit?)`: koordinatör hepsini, başkan kendi departmanınınkini okur (günlük
  örnek inceleme için).
- Web: Şirket görünümünde **Giden kutusu** sekmesi (son 200, departmana ve türe göre süzülür).

## 8. Muhakeme katmanı

`craft/working.md`'ye (herkesin rehberi) bir bölüm: **"Sistemin senin adına gönderdiği"** — kapı gönderimi
geçirebilir; ama şu durumlarda göndermeden önce `approvalRequest` ile sahibine sor: para sözü (fiyat, indirim, iade,
ödeme tarihi), hukuki konu (avukat, tüketici hakem heyeti, KVKK talebi, sözleşme), kriz (basın, olumsuz yayılan
paylaşım, tehdit, ağır şikâyet), bilgi tabanında cevabı olmayan soru, ticari ileti izni olmayan kişiye ilk tanıtım
mesajı ya da araması (İYS). Başkanlar için: her gün odalarının giden kutusundan örnek okuyup ton ve kural ihlali
arar (rutin önerisi; şablonlara eklenir).

## 9. Şablonlar ve arayüz

- Rol şablonları: `iletisim-yoneticisi` (v2: `messages.read`, `messages.send`; "Nasıl çalışırsın" otonomiye göre),
  `musteri-temsilcisi` (v3: aynı), `sosyal-medya` (v3: yayın sistemce, reklam harcaması sahibine),
  `satis-muduru`/`aday-arastirmaci` (v2: İYS kuralı), `pazarlama-muduru` (v2). Dışa dönük rollerin "Nasıl çalışırsın"
  kuralı "kritik olan sahibine; geri kalan sistemce" olur (rol şablonu testinin dışa dönük kuralı buna göre).
- Departman şablonları: `ic-dis-iletisim`, `pazarlama`, `satis` v2 ("Sana gelir" yalnız kritikler; giden kutusu
  rutin önerisi).
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
