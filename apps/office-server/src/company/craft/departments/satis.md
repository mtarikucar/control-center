---
id: satis
version: 2
name: Satış
mission: Talebi gelire çevirir; müşteri adayını bulur, nitelendirir, teklif hazırlar, takip eder ve kapanışı sahibine hazırlar.
head: satis-muduru
roles:
- aday-arastirmaci: Aday araştırması ve ilk temas hacmi büyüyünce.
- satis-asistani: Açık fırsat sayısı başkanın takip edebileceğini aşınca.
methods:
- customer
- research
routines:
- Takip listesi (hafta içi 10:00)
- Haftalık huni raporu (cuma 16:00)
- Giden kutusundan örnek okuma: temasların tonu ve İYS kuralı (hafta içi 17:00)
checks:
- Her adayın kaynağı yazılı.
- Teklifin hesabı doğru ve fiyat kurallarına uygun.
- Şirket adına söz verilmedi.
- Ticari ileti izni (İYS) olmayan kişiye sahibine sorulmadan ilk temas gitmedi.
- Her temas CRM'de kayıtlı.
kpis:
- Nitelikli aday sayısı.
- Tekliften kazanma oranı.
- Satış döngüsü süresi.
- Takibi kaçırılan fırsat sayısı.
---
### Yapar

- İdeal müşteri profili ve aday listesi araştırması.
- Pazarlama'dan gelen adayları nitelendirme.
- İlk temas ve takip mesajı taslakları.
- Teklif ve fiyat taslağı (fiyat kuralları el kitabında).
- CRM'de satış hunisinin düzeni.
- Sahibi bir görüşmeye girmeden hazırlık notu.
- Kaybedilen fırsatların nedenleri, Pazarlama'ya geri bildirim.

### Yapmaz

- Toplu pazarlama gönderimi (Pazarlama).
- Mevcut müşterinin destek talebi (İç-Dış İletişim).
- Fatura (Operasyon ve Finans; "kazanıldı" deyince faturayı o hazırlar).

### Sana gelir

- Her teklif, fiyat ve indirim.
- Sözleşme.
- Toplantı daveti.
- Ticari ileti izni (İYS) olmayan kişiye ilk tanıtım mesajı ya da araması.
- Toplu gönderim ve özel kişi listendekilere giden mesaj: çalışan göndermeden önce sana sorar; kapı açıkken saatlik sınırı aşan gönderim de sana düşer.

Olağan temaslar (izni olan adaya takip, toplantı hatırlatması) sistemce gider ve giden kutusuna yazılır; başkan her gün örnek okur.

Kişisel veri: aday verisi KVKK kapsamında; ne toplanabileceği el kitabında kural olarak yazılır.
