# Ekonomi ölçümü — senaryo testi

`apps/office-server/test/economy.scenario.test.ts` üretir: sahte claude ile bir simüle iş günü — 1 koordinatör (fable) + 2 üye
(sonnet). 08:45'te sahibi koordinatörden plan ister, 09:00'da onaylar; 10 görev (6 kolay, 3 orta, 1 zor); bir üye bir görevde
takılır (koordinatör işi diğerine verir), biri bir fikir açar (koordinatör kabul eder), günlük rapor hatırlatması gelir
(anayasa varsayılanı: özet saatleri 9 ve 17; hatırlatma 17:00 özetiyle), ertesi sabahın özet saati de geçer. Eşikler:
koordinatör turu ≤ 5; koordinatörün modellenmiş maliyeti main tabanının (225) en çok %30'u; hiçbir görev zorluğunun
modelinden güçlü bir modelde koşmaz. Yeniden üretmek için (repo kökünden):

    ECONOMY_MEASURE_OUT=$PWD/docs/superpowers/notes/economy-measure.md pnpm --filter @cc/office-server exec vitest run test/economy.scenario.test.ts

- Tur = `turn.finished` olayı. Model = turun oturumunun açılışta bildirdiği model (sahte claude `--model`'i bildirir), yoksa kadrodaki model.
- Modellenmiş maliyet = Σ tur × ağırlık(model); ağırlıklar fable 15, opus 5, sonnet 1, haiku 0.2. Kaba bir ölçü: bağlam boyutunu ve
  önbelleği yok sayar, her tur aynı sayılır.
- Oturum = o modelde açılan claude oturumu (`session.started`): uyanış ya da model değişimi yeni oturum açar (soğuk başlangıç).

| Çalışan | Rol | Model | Tur | Oturum | Ağırlık | Modellenmiş maliyet |
|---|---|---|---:|---:|---:|---:|
| Koordinatör | koordinatör | fable | 1 | 1 | 15 | 15 |
| Koordinatör | koordinatör | sonnet | 3 | 3 | 1 | 3 |
| Koordinatör | koordinatör | haiku | 1 | 1 | 0.2 | 0.2 |
| Ada | üye | opus | 1 | 1 | 5 | 5 |
| Ada | üye | sonnet | 2 | 2 | 1 | 2 |
| Ada | üye | haiku | 3 | 3 | 0.2 | 0.6 |
| Can | üye | sonnet | 2 | 2 | 1 | 2 |
| Can | üye | haiku | 3 | 3 | 0.2 | 0.6 |
| **Toplam** | | | **16** | | | **28.4** |

Koordinatöre tur açan olaylar (simüle saat):

| # | Saat | Neden | Model |
|---:|---|---|---|
| 1 | 08:45 | sahibinin mesajı | fable |
| 2 | 09:00 | plan onayı | sonnet |
| 3 | 10:07 | takılma + özet (Teslimler 2) | sonnet |
| 4 | 11:00 | öneri + özet (Teslimler 2) | sonnet |
| 5 | 17:00 | özet (Teslimler 6, Plan durumu 1) + rapor hatırlatması | haiku |
