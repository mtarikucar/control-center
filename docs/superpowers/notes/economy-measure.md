# Ekonomi ölçümü — senaryo testi

`apps/office-server/test/economy.scenario.test.ts` üretir: sahte claude ile bir simüle iş günü — 1 koordinatör (fable) + 2 üye
(sonnet), 1 onaylı plan, 10 görev; bir üye bir görevde takılır (koordinatör işi diğerine verir), biri bir fikir açar (koordinatör
kabul eder), günlük rapor hatırlatması gelir (anayasa varsayılanı: özet saatleri 9 ve 17; hatırlatma 17:00 özetiyle), ertesi sabahın
özet saati de geçer. Eşik: koordinatör turu ≤ 5 (main tabanı 14). Yeniden üretmek için (repo kökünden):

    ECONOMY_MEASURE_OUT=$PWD/docs/superpowers/notes/economy-measure.md pnpm --filter @cc/office-server exec vitest run test/economy.scenario.test.ts

- Tur = `turn.finished` olayı. Model = turun oturumunun açılışta bildirdiği model (sahte claude `--model`'i bildirir), yoksa kadrodaki model.
- Modellenmiş maliyet = Σ tur × ağırlık(model); ağırlıklar fable 15, opus 5, sonnet 1, haiku 0.2. Kaba bir ölçü: bağlam boyutunu ve
  önbelleği yok sayar, her tur aynı sayılır.
- Oturum = açılan claude oturumu (`session.started`): boşta 30 dk kalan uyur, uyanınca yeni oturum açar (soğuk başlangıç).

| Çalışan | Rol | Model | Tur | Oturum | Ağırlık | Modellenmiş maliyet |
|---|---|---|---:|---:|---:|---:|
| Koordinatör | koordinatör | fable | 4 | 4 | 15 | 60 |
| Ada | üye | sonnet | 6 | 1 | 1 | 6 |
| Can | üye | sonnet | 5 | 1 | 1 | 5 |
| **Toplam** | | | **15** | | | **71** |

Koordinatöre tur açan olaylar (simüle saat):

| # | Saat | Neden |
|---:|---|---|
| 1 | 09:00 | plan onayı |
| 2 | 10:07 | takılma + özet (Teslimler 2) |
| 3 | 11:00 | öneri + özet (Teslimler 2) |
| 4 | 17:00 | özet (Teslimler 6, Plan durumu 1) + rapor hatırlatması |
