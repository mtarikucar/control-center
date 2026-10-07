# Ekonomi — gerçek taban (K4, küçük örneklem, ofis yeni)

Canlı ofisin veritabanı `cp` ile geçici bir klasöre kopyalandı (office.db, -wal, -shm; 2026-10-07 11:47) ve
`economy-report` kopyada salt okunur çalıştırıldı. Canlıya yazılmadı. Kod: main (şema 5); not türleri, özet, model
politikası ve zorluk yok. Bu, plan öncesinin **gerçek** davranışı.

**Örneklem: 4 teslim, 23 tur, 4 çalışan, ~18 saat (2026-10-06 17:38 – 2026-10-07 11:47).** Kabul belgesinin R1 için
istediği pencere ≥30 teslim; bu taban yalnız yön gösterir, kabul kararına yetmez. İş yükü de temsilî değil: işlerin çoğu
ofisin kendi geliştirmesi (Deniz, opus, uzun görevler); üyeler (sonnet) birer kez işe alınıp çıkarıldı.

Yeniden üretmek için (önce kopya):

    D=$(mktemp -d) && cp ~/.control-center/office.db ~/.control-center/office.db-wal ~/.control-center/office.db-shm "$D"/
    node apps/office-server/scripts/economy-report.ts --db "$D/office.db" --since 2026-10-01 --until 2026-10-07T11:47

## Çıktı

```
Pencere: 2026-10-01 00:00 – 2026-10-07 11:47 · şema sürümü 5
Örneklem: 4 teslim, 23 tur, 4 çalışan.

| Çalışan | Rol | Tur | Yan cevap | USD | Token (giriş/çıkış/önbellek okuma/yazma) | Modeller (tur) |
|---|---|---:|---:|---:|---|---|
| abdullah hamidi | member | 5 | 0 | 0.34 | 16/1104/211029/71350 | sonnet 5 |
| jeena | member | 5 | 0 | 0.22 | 12/552/125066/46761 | sonnet 5 |
| Koordinatör | coordinator | 9 | 0 | 7.33 | 85531/106662/4453097/444709 | sonnet 6 · fable 3 |
| Deniz | member | 4 | 0 | 21.63 | 352/324661/54748084/523175 | opus 4 |
| **Toplam** | | **23** | 0 | **29.52** | 61142161 | |

Teslim başına: 5.75 tur · koordinatör 2.25 tur (sahibinin mesajları hariç 1.25) · koordinatör $1.83 · toplam $7.38 · 15285540 token.
Koordinatör: 9 tur, $7.33. Turu açan: karar notu 5 · sahibinin mesajı 4.
Koordinatör turlarındaki karar notu satırları: teslim 4 · plan 3.
Kalite: başlayan 5 görev, takılan 0 (oran 0), kuyruğa dönen 0, yeniden açılan plan 2, biten plan süresi (saat) 0.8, 1.2.
Not gecikmesi (oluşma → tura girme, dk): karar 7 not, p50 0, p95 0; alıcı turda değilken yazılan 7 not, p95 0 · bilgi 0 not, p50 —, p95 —.
Pencere sonunda bekleyen not: karar 0 (en eski — dk) · bilgi 0 (en eski — dk).
Olaylar: kaybolan/iptal mesaj bildirimi 0 · başarısız model geçişi 0.

Şema 6 öncesi: not türü yok, bütün notlar karar sayıldı.
```

## Okuma

- **Koordinatör turu / teslim: 2,25** (9 tur / 4 teslim). Simülasyondaki 1,4'ten yüksek. 9 turun 4'ü sahibinin mesajı
  (plan konuşması); bunlar planın azaltabileceği turlar değil. Sahibi dışındaki koordinatör turu / teslim: **1,25**
  (5 / 4). Karar notu turlarındaki satırlar: 4 teslim + 3 plan notu, yani her teslim ayrı bir koordinatör turu açmış.
  Simülasyonun öngördüğü desen bu.
- **Koordinatör turunun bedeli:** 9 turda $7,33 (tur başına ~$0,81). Modeller: 6 sonnet, 3 fable. Koordinatör o gün elle
  Sonnet'e alınmış; sahibiyle plan turları Fable'da.
- **USD / teslim: $7,38.** Toplamın %73'ü Deniz'in (opus, 4 uzun geliştirme turu, $21,63). Teslim başına maliyet iş
  türüne çok bağlı: plan başarısını bu sayıyla değil, koordinatörün payıyla izlemek gerek. Koordinatör / teslim:
  $1,83.
- **Kalite:** 5 başlayan görev, takılan 0, kuyruğa dönen 0. "Yeniden açılan plan 2": koordinatör ekonomi planına sırayla
  yeni görev açtı; kalite sorunu değil, iş akışı. Biten plan süreleri 0,8 ve 1,2 saat.
- **Not gecikmesi:** 7 not, hepsi koordinatör boştayken hemen teslim edildi (p50 = p95 = 0 dk). Bekleyen not yok;
  kaybolan mesaj ya da başarısız model geçişi bildirimi yok.
- Tur başına token çoğunlukla önbellekten okuma (koordinatör: 4,45 M okuma / 0,44 M yazma / 0,19 M giriş+çıkış).

## Kabul belgesine etkisi

- R1'in tabanı simülasyondan (1,4) değil canlı ölçümden alınmalı. Sahibinin mesajları sayılmamalı, çünkü plan onları
  azaltmaz. Bugünkü değer 1,25 (n = 4).
- R2'yi teslim başına toplam USD ile ölçmek gürültülü: iş türü (opus geliştirme ya da sonnet rutin) baskın. Koordinatörün
  teslim başına USD'si ana metrik, toplam ikincil olsun.
- Yayın sonrası pencere ≥30 teslim, en az birkaç gün; işler benzer türde olmalı.
