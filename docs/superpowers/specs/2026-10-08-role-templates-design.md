# control-center — Rol şablonu kataloğu (B6) tasarım notu

- Tarih: 2026-10-08 · Yazan: Mert · Görev: 95ecf15a (plan "Çekirdek 3", B6) · İnceleyen: Kerem
- Dayandığı: `bosluk-analizi.md` §2 B6 satırı, yerleştirme notu (katalog mekanizması ve ilk genel küçük işletme
  arketipleri segment kararını beklemez) ve §3 "B6 — Rol şablonu kataloğu yok"; `hedef-mimari.md` §4 B1 (katalog
  `craft/roles/<arketip>.md` + ön bilgi bloğu, `roleTemplates(list | read)`) ve B2 (`hire` yeni alan `template`;
  şablon × profil → rol kartı), §3 ilke (ürün bilgisi dosyada gelir, şirket bilgisi DB'de).
- Dal `feat/role-templates`, `integration/core-2` (5b327b4) üstünde. **Göç v16.**

## 1. Bugün ve kapsam

Ürünle gelen tek rol metni koordinatörünkü (`roles.ts` `COORDINATOR_ROLE`). `hire` her işe alımda `role` serbest
metni ister; yetenek, kalite kontrolü ve ölçü bildirilmez.

Bu iş: şablon biçimi, ürünle gelen katalog (7 genel küçük işletme arketipi), `roleTemplates` aracı ve API,
`hire(template)` ve çalışanın hangi şablonun hangi sürümünden alındığının kaydı. **Kapsam dışı:** yetenek
sözlüğü ve entegrasyon eşlemesi, "kısıtlı" rol ve yetki önerisi (B7/B8); şablonun profilden otomatik
özelleştirilmesi (B5 blueprint; bugün koordinatör özelleştirmeyi `role` alanına yazar); segmente özgü arketipler
(sahibinin segment kararından sonra); web işe alma formu (API hazır).

## 2. Şablon biçimi (ürünle gelir, DB'ye yazılmaz)

Her şablon `apps/office-server/src/company/craft/roles/<id>.md`: ön bilgi bloğu + Markdown gövde.

```
---
id: icerik-yazari            # dosya adıyla aynı
version: 1                   # şablon değişince artar; çalışan kaydı hangi sürümden alındığını tutar
title: İçerik Yazarı         # varsayılan unvan
team: İçerik                 # varsayılan ekip
model: sonnet                # varsayılan model (fable | opus | sonnet | haiku)
summary: …                   # tek cümle: bu rol ne yapar
capabilities:                # gereken yetenekler (B7 sözlüğüne gidecek; bugün metin)
- docs.write
methods:                     # kullandığı iş türü yöntemleri (WORK_TYPES; methodRead)
- content
checks:                      # tipik kalite kontrolleri
- …
kpis:                        # tipik ölçüler (B16 KPI'larına aday)
- …
---
### Sorumlulukların
### Nasıl çalışırsın
### Bitti ne demek
```

Ön bilgi bloğu bilinçli olarak dar bir biçimdir: `anahtar: değer` ya da `anahtar:` + `- madde` satırları. Bağımlılık
yok, bilinmeyen anahtar ve eksik alan reddedilir. Gövde üç başlığı taşımak zorunda (rol kartında "## Rolün" altına
girer, o yüzden `###`).

**Rol metni** (şablondan): özet + gövde + "### Kalite kontrollerin" (checks) + "### Seni neyle ölçeriz" (kpis)
+ verildiyse "### Bu şirkette" (koordinatörün şirkete özgü eki: marka dili, kanallar, dil, kısıtlar).

## 3. İlk katalog: genel küçük işletme arketipleri

Segmente özgü değil; pazar araştırması ve pilot senaryosunun ortak rolleri.

| id | Unvan | Model | Yöntemler | Not |
|---|---|---|---|---|
| `icerik-yazari` | İçerik Yazarı | sonnet | content | |
| `editor` | Editör ve Kalite Kontrolcüsü | opus | content, research, general | inceleyici rolü; düzeltmeyi kendisi yapmaz |
| `sosyal-medya` | Sosyal Medya Yöneticisi | sonnet | content, operations | yayın sahibinin onayıyla |
| `musteri-temsilcisi` | Müşteri Temsilcisi | sonnet | customer | gönderim ve iade sahibinin onayıyla |
| `arastirmaci` | Araştırmacı | sonnet | research | her iddia kaynaklı |
| `operasyon-asistani` | Operasyon ve Muhasebe Asistanı | sonnet | operations | ödeme yapmaz |
| `satis-asistani` | Satış Asistanı | sonnet | customer, research | teklif ve gönderim sahibinin onayıyla |

Dışarıya dokunan rollerin (sosyal medya, müşteri, satış, operasyon) gövdesi şirket kuralını taşır: dışarıya yayın,
gönderim ve ödeme sahibinin onayından geçer (bugün metin; mekanik kapı B9).

## 4. Araçlar ve API

```
roleTemplates(id?)                         koordinatör, ekip liderleri   id yoksa liste; varsa şablonun tamamı
hire(name, template?, role?, title?, team?, model?, characterId?)   koordinatör
GET /api/role-templates                    sahibi                        RoleTemplate[] (JSON)
POST /api/employees {…, template?}         sahibi                        işe alma formu şablonla da çalışır
```

- **`template` ile:** rol metni şablondan kurulur. `role` verilirse "### Bu şirkette" eki olur. Unvan, ekip ve model
  verilmezse şablonunkiler alınır.
- **`template` olmadan:** bugünkü gibi; `role` zorunlu, rol metni aynen yazılır, `template` boş kalır. Eski davranış
  değişmez (test).
- Bilinmeyen şablon reddedilir, katalogdaki id'ler sayılır.

## 5. Göç v16

```sql
ALTER TABLE employees ADD COLUMN template TEXT;             -- şablon id'si; serbest metinle alınanlarda NULL
ALTER TABLE employees ADD COLUMN template_version INTEGER;  -- işe alındığı şablon sürümü
```

Eski çalışanlar `NULL` alır (serbest metin). `Employee.template = { id, version } | null`. Serbest metinle işe alma
satırı **v16 öncesiyle birebir aynı** yazılır; şablon sütunları yalnız şablonla alınan çalışanda yazılır. Böylece
eski şemalı bir veritabanında (ekonomi raporu testi: şema 5) kadro eskisi gibi çalışır. Şablon sonradan
değişirse çalışanın kartı kendiliğinden değişmez (kart koordinatörün de düzenleyebildiği bir metindir); sürüm
farkı görülür, yeniden yazmak `editRoleCard` ile bilinçli bir iştir.

## 6. Doğrulama

- Birim (K1): ön bilgi ayrıştırıcısı (alanlar, listeler, eksik/bilinmeyen alan, yanlış model); katalog şekli (her
  şablon geçerli, id dosya adı, yöntemler `WORK_TYPES` içinde, dışa dönük rollerde onay kuralı); şablondan işe alma
  (unvan, ekip, model, şirket eki, kayıt, masadaki CLAUDE.md); geçersiz şablon; serbest metin işe alma aynen; araçlar
  ve API; göç v16.
- Mutasyon kontrolü: ayrıştırıcı ve doğrulama kuralları, varsayılanlar, ek, kayıt, eski yol.
- Gerçek claude: gerekmez (davranış ofisin kendi kodunda). Gerekirse stub sunucu + `LOCKED_ARGS` ile.
