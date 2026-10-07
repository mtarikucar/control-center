# Yöntem: Operasyon ve satın alma (operations)

Araç ya da servis seçmek, satın almak, kurmak, süreç düzenlemek, hesap ve abonelik işleri.

## Aşamalar

1. İhtiyaç: ne sorun çözülecek, olmazsa ne olur, bütçe sınırı.
2. Seçenekler: en az iki seçenek; maliyet (ilk ve aylık), risk, kurulum emeği, geri dönüş yolu.
3. Öneri: tercih ve gerekçesi; para gerekiyorsa `propose` ile satın alma talebi (sahibine gider).
4. Onay: sahibinin kararı gelmeden para harcanmaz.
5. Kurulum.
6. Doğrulama: kurulanın gerçekten çalıştığı, kurulumu yapandan başka biri tarafından denenir.
7. Kayıt: karar defterine (`decisionRecord`) ve gerekiyorsa el kitabına (nasıl kullanılır).

## Roller

- Araştıran ve kuran: seçenekleri çıkarır, onaydan sonra kurar.
- Doğrulayan (reviewer): kuran dışında biri.
- Sahibi: harcamayı onaylar.

## Kalite kontrolleri

- Seçenekler aynı ölçütlerle karşılaştırılmış.
- Harcama onaylı tutarı aşmıyor; `recordSpend` ile bildirildi.
- Kurulum belgelenmiş; erişim bilgileri güvenli yerde, metne yazılmamış.
- Vazgeçmenin yolu biliniyor (iptal, geri alma).

## Kanıt

- Seçenek karşılaştırması.
- Onay kaydı (öneri no ya da sahibinin kararı).
- Kurulum doğrulaması: çalıştığını gösteren çıktı ya da adım listesi.

## Sık yapılan hatalar

- Tek seçenek sunup "en iyisi bu" demek.
- Onaydan önce satın almak ya da deneme sürümüyle kart bilgisi vermek.
- Erişim bilgilerini notlara yazmak.
- Kurulumu kaydetmemek; bir sonraki kişinin baştan öğrenmesi.

## Model önerisi

Seçenek araştırması: sonnet. Basit kurulum adımları: haiku. Pahalı ya da geri dönüşü zor karar: fable.
