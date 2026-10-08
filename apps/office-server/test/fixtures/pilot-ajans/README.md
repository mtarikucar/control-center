# Pilot ajans paketi (C5-3) — Kıyı Ajans (sentetik)

Pilotun (pilot-senaryosu, pilot-hazirlik-analizi §3 C5-3) sentetik firması ve verileri. **Her şey uydurmadır:** ajans
"Kıyı Ajans (sentetik)" ve altı müşterisi gerçek işletmeler değildir; kişiler yalnız ön adla ve "(sentetik)" işaretiyle
anılır; bütün e-posta ve web adresleri RFC 2606'nın ayırdığı `.example` alan adındadır; telefon, adres, IBAN, kimlik
numarası yoktur. Sayılar (takipçi, erişim, etkileşim) uydurmadır.

## Dosyalar

| Dosya | Ne | Kim kullanır |
|---|---|---|
| `blueprint.json` | `blueprintPropose` girdisi: 3 rol (şablondan), 10 el kitabı konusu (4 kural + 6 marka dili), 2 hedef + KPI, 2 rutin, 3 ilk görev (inceleyicili), kapalı kip 12 kural. Selin'in taslağı (görev 36eda3d6); marka metinleri `marka-dili/` dosyalarının aynısı | Koordinatör / K3 testi (C5-4) |
| `profil.json` | Ajansın profili, bölüm bölüm (`profileUpdate` girdisi): onboarding'in zorunlu soruları dolu, blueprint önerilebilir | Testler, K3 |
| `marka-dili/<müşteri>.md` | 6 "Marka dili — <müşteri> (sentetik)" el kitabı metni; yedi başlık: Ton, Yapılacaklar, Yapılmayacaklar, Kanal ve biçim, Hashtag kuralı, Örnek cümleler, Yasaklı ifadeler | İçerik Yazarı, Editör (el kitabından) |
| `musteriler/<müşteri>.md` | 6 müşteri profili notu: ilk satır başlık, ikinci satır `etiketler:`, gerisi metin (`noteWrite` girdisi) | Herkes (hafızadan) |
| `gelen-kutusu/*.md` | 13 sentetik e-posta (`Kimden/Kime/Tarih/Konu` başlıklı): yanıt, bilgi ve yükseltme (şikâyet, iptal, indirim, tarih sözü, fatura, herkese açık yanıt) karışık | Hesap Asistanı'nın masası |
| `takvim.csv` | "Takvim formatı" sütunlarıyla geçen haftanın 12 yayınlanmış satırı (Pastane Ada, Diş Kliniği Mavi); yeni hafta satırları bunların altına eklenir | İçerik Yazarı'nın masası |
| `gecmis-gonderiler/pastane-ada.md` | Pastane Ada'nın son 20 gönderisi, konusu ve sayılarıyla | İçerik Yazarı (müşteri araştırması görevi) |
| `performans.csv` | Altı müşterinin son iki haftası, kanal başına gönderi, erişim, etkileşim, takipçi değişimi | Hesap Asistanı (haftalık rapor rutini) |

Pilot 0'da (kapalı kip) bağlayıcılar kapalıdır; görevler bu dosyaları masada okur. Masaya kopyalama C5-4'ün (uçtan uca K3
denemesi) işidir: `gelen-kutusu/` ve `performans.csv` Hesap Asistanı'na, `takvim.csv` ve `gecmis-gonderiler/` İçerik
Yazarı'na. Pilot 1 varyantı (Gmail/Jeeta okuma, daraltılmış kapalı liste) bu pakette yok: sahibinin kararını bekler
(pilot-senaryosu §10).

## Doğrulama

- `test/pilot-ajans.test.ts`: dosyalar yerinde ve tutarlı; sentetiklik denetimi (adresler `.example`, telefon/IBAN/kimlik
  numarası yok); K1: geçici ofiste `blueprintPropose` → onay → `blueprintApply` iki (ve üç) kez, ikinci koşu hiçbir şey
  eklemez; `blueprintRead` kapalı kip kurallarının hiçbiri "tanınmıyor" değil.
- `test/pilot-ajans-search.test.ts`: KÖ8 — "marka dili <müşteri>" 6 müşterinin 6'sında o müşterinin marka konusunu
  ilk 3'te döndürür (yalnız Memory kullanır; B11 dalında da koşar). `KO8_TABLE=1` sonuç tablosunu basar.

Not: Slack ve Google Drive kuralları B7 sözlüğünde yoktur; hiç oturum açılmamış bir ofiste "tanınmıyor" görünürler. Bu
makinedeki oturumlar ikisini de raporlar (needs-auth), testte koordinatörün oturum raporu bu yüzden verilir.
