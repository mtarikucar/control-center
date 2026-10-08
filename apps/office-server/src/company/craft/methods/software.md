# Yöntem: Yazılım (software)

Kod yazmak, düzeltmek, otomasyon, entegrasyon, betik.

## Aşamalar

1. Kabul ölçütleri: ne çalışınca bitmiş sayılır, hangi durumlar kapsam dışı.
2. Gerekirse kısa tasarım: hangi dosyalar, hangi arayüzler, veri değişikliği var mı (geri alınabilir olmalı).
3. Ayrı bir dalda geliştirme, önce test: davranışı söyleyen bir test yaz, başarısız olduğunu gör, sonra kodu yaz.
4. Kod incelemesi: yapan dışında biri (reviewer) değişikliği okur, testleri kendisi çalıştırır.
5. Düzeltme döngüsü: kritik ve önemli bulgular kapanana kadar.
6. Bağımsız doğrulama: gerçek davranış (komut, ekran, istek) bir kez uçtan uca denenir.
7. Kabul ve sahibinin yayın kararı: birleştirme, yayına alma, gönderme sahibine sorulur.

**Paralel geliştirme.** İş parçalara bölünebiliyorsa:

- Önce ortak arayüzü ya da sözleşmeyi (fonksiyon imzaları, veri biçimi, API) sabitle; parçalar ona göre yazılır.
- Ortak numaralı kaynakları baştan paylaştır: veritabanı göç numaraları, portlar, hangi dosyanın ya da modülün kimde
  olduğu; böylece paralel dallar çakışmaz.
- Her geliştirici kendi dalında (gerekirse ayrı bir git worktree'de) çalışır.
- İncelenmiş dallar tek bir entegrasyon dalında toplanır; bütün test takımı orada bir kez çalıştırılır.
- Bir geliştiricinin sırası darboğaz olduysa ve iş bu çizgilerde bölünüyorsa doğru adım ikinci bir geliştirici almaktır.

## Roller

- Geliştirici: yapar, test yazar, kanıtı toplar.
- İnceleyici: geliştiriciden başka biri; kritik işte en az onun kadar güçlü bir model.
- Koordinatör: kabul ölçütlerini yazar, yayın kararını sahibine götürür.

## Kalite kontrolleri

- Bütün test takımı yeşil; yeni davranışın kendi testi var ve önce kırmızı görüldü.
- Değişiklik istenen işi yapıyor, fazlasını değil.
- Veri değişikliği geri alınabilir (ileri ve geri adım, gidiş-dönüş denendi).
- Gizli anahtar, parola ya da kişisel veri koda ve kayda girmedi.

## Kanıt

- Test komutu ve çıktısının son satırları (kaç test, kaç başarısız).
- İnceleme raporu: bulgular ve kapanışları.
- Gerçek davranışın çıktısı: çalışan komut, ekran görüntüsü yolu ya da istek-yanıt.

## Sık yapılan hatalar

- "Testler geçiyor" deyip çalıştırmamak; eski bir çalıştırmaya güvenmek.
- Testi koddan sonra yazmak (hiç kırmızı görülmemiş test bir şey kanıtlamaz).
- Kapsamı genişletmek: istenmeyen yeniden düzenleme, ilgisiz düzeltmeler.
- Yayına almayı, birleştirmeyi sahibine sormadan yapmak.
- Bölünebilen işi tek geliştiriciye zincir gibi yüklemek; ya da ortak numaraları paylaştırmadan paralel dal açıp
  birleştirirken çakışmak.

## Model önerisi

Rutin değişiklik: sonnet. Karmaşık geliştirme ya da hata ayıklama: opus. Mimari karar ve kritik inceleme: fable. Basit
betik ve tekrarlı iş: haiku.
