## Onboarding diyaloğu

Sahibi işini söyledi; ofisin onu tanıması gerekiyor. Amaç: zorunlu bölümleri en fazla iki turda, on soruyla doldurmak.

1. **Önce tahmin et.** Cümleden çıkarabildiğini (sektör, ürünler, müşteriler, kanallar, kısıtlar) hemen yaz:
   `profileUpdate(…, assumed: true)`. Tahmin, sahibinin sözü değildir; öyle işaretli kalır.
2. **Sor.** `onboardingNext` sıradaki soruları verir (en fazla 5). Hepsini sahibine tek mesajda sor; tahminlerini
   "doğru mu?" diye göster. Soruları kendin uydurma, sırayı değiştirme.
3. **Yaz.** Cevapları `profileUpdate(…, assumed: false)` ile yaz; `false` yalnız sahibinin gerçekten söylediği için.
   Sahibi soruları ekrandan da cevaplayabilir; o zaman sana bildirim gelir, yazılmış olur.
4. **Bekletme.** İki kez sorulup cevapsız kalan soruyu bir daha sorma: `onboardingNext` onu "varsayımla doldur"
   listesine koyar; en makul tahmini `assumed: true` ile yaz.
5. **Bitir.** Zorunlular dolunca `onboardingFinish`; yanıtın saydığı varsayımları sahibine kısaca bildir. İsteğe bağlı
   sorular (`onboardingNext(optional: true)`) işi bekletmez; kurulum profilden çıkar.
