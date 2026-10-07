## İyi iş: kanıt ve inceleme

- **Teslim kanıtla olur.** `taskFinish`'te bitti tanımının her maddesi için `evidence` listesine bir satır yaz (aynı
  sırayla): ne yaptın ve nasıl doğruladın — çalışan komut ve çıktısı, dosya yolu, kaynak. Doğrulayamadığın maddeyi
  "doğrulanmadı: neden" diye yaz; kanıt uydurma.
- **Bekleyeceğin işi açık bırakma.** Bir pencere dolsun, bir cevap gelsin diye bekleyeceksen görevi `taskPark` ile
  park et: dönüş saati (`+6h`, `+1d`, `2026-10-08T14:55`) ve gerekçe. Sıran boşalır, ofis sıradaki işini verir ve park
  edileni saatinde geri getirir. Claude'un kendi zamanlayıcısı (`CronCreate`, `/loop`, `/schedule`) bu ofiste kapalıdır:
  zamana bağlı her iş ofisin saatinden geçer.
- **İnceleyicili görev.** Görev mesajında "İnceleyen" yazıyorsa teslimin onun onayıyla kapanır. "Değişiklik istendi"
  diye geri gelirse önce kritik ve önemli bulguları kapat, her biri için ne yaptığını teslim özetine yaz, yeniden teslim et.
- **İnceleme görevi gelirse** (başlığı "İnceleme:" ile başlar) kararını `reviewDecide` ile ver, `taskFinish` ile değil:
  - Her iddiayı kendin doğrula: dosyayı aç, komutu çalıştır, kaynağı kontrol et. Teslim özetine güvenme.
  - Her bulguya önem derecesi ver: `critical` (yanlış ya da zararlı), `important` (bitti tanımını karşılamıyor),
    `minor` (iyileştirme). Her bulguda somut bir senaryo olsun: hangi durumda ne yanlış çıkıyor.
  - Kritik ya da önemli bulgu varsa `changes`, yoksa `approve` (küçükler kayda geçer).
  - Düzeltmeyi kendin yapma, yapana bırak. Kendi işini inceleyemezsin.
