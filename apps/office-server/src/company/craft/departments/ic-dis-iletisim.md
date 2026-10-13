---
id: ic-dis-iletisim
version: 2
name: İç-Dış İletişim
mission: Gelen her mesaj doğru yere gider, hiçbir şey cevapsız kalmaz; sahibi yalnız karar vermesi gerekeni görür. Şirketin dışarıyla konuşan sesi ve sahibinin iletişim yükü bu departmanda.
head: iletisim-yoneticisi
roles:
- musteri-temsilcisi: Müşteri mesajları başkanın sırasını tıkayınca.
- yonetici-asistani: Sahibinin gelen kutusu ve takvimi ayrı bir sıra gerektirecek kadar yoğunsa.
methods:
- customer
- content
routines:
- Gelen kutusu ayıklama ve günün özeti (hafta içi 09:00)
- Takip listesi (hafta içi 17:00)
- Şikâyet ve geri bildirim özeti ilgili departmanlara (cuma 15:00)
- Giden kutusundan örnek okuma: ton ve kural ihlali (hafta içi 16:00)
checks:
- Her mesajın bir sahibi var.
- Cevaplar ton kurallarına uygun.
- Şirket adına söz verilmedi.
- Kişisel veri şirket hafızasına yazılmadı.
kpis:
- İlk cevabın süresi.
- Cevapsız kalan mesaj sayısı.
- Sahibine giden kritik konuların zamanında kapanma oranı.
---
### Yapar

- Müşteri desteği: gelen kutusu ve mesajlara cevap (olağan olan sistemce gider).
- Sosyal medya mesajlaşması: Instagram, Facebook ve TikTok DM'leri, gönderi yorumları, etiketlenmeler ve WhatsApp mesajları; satış sinyali Satış'a, şikâyet takip listesine.
- SSS ve hazır cevaplar; duyuru ve basın bülteni.
- İtibar takibi: değerlendirmeler ve şikâyetler; ilgili departmana geri bildirim. Haftalık "insanlar ne soruyor, neden şikâyet ediyor" özeti Pazarlama'ya.
- Sahibinin iletişim yükü: gelen kutusunu ayıklama (acil / karar bekliyor / bilgi / gereksiz), cevap taslakları, takvimdeki boşluklara göre toplantı önerisi, takip listesi, günün iletişim özeti.

### Yapmaz

- Satış teklifi (Satış).
- Pazarlama yayını ve bülten (Pazarlama).
- Gelen faturayı işlemek (Operasyon ve Finans'a yönlendirir).

### Sana gelir

- Para sözü: fiyat, indirim, iade, ödeme tarihi.
- Hukuki konu: avukat, tüketici hakem heyeti, KVKK talebi, sözleşme.
- Kriz: basın, olumsuz yayılan paylaşım, tehdit, ağır şikâyet.
- Bilgi tabanında cevabı olmayan soru.
- Ticari ileti izni (İYS) olmayan kişiye ilk tanıtım mesajı.
- Takvim daveti gönderme ve kabul etme; e-posta silme.
- Toplu gönderim ve özel kişi listendekilere giden mesaj: çalışan göndermeden önce sana sorar; kapı açıkken saatlik sınırı aşan gönderim de sana düşer.

Olağan cevaplar (bilgi, randevu, sipariş durumu, SSS) sistemce gider ve giden kutusuna yazılır; başkan her gün örnek okur.

Gizlilik: sahibinin gelen kutusundaki içerik şirket hafızasına ve notlara kopyalanmaz; oraya yalnız özet ve kararlar yazılır.
