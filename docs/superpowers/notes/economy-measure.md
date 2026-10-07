# Ekonomi ölçümü — senaryo testi

`apps/office-server/test/economy.scenario.test.ts` üretir: sahte claude ile bir simüle iş günü — 1 koordinatör (fable) + 2 üye
(sonnet), 1 onaylı plan, 10 görev; bir üye bir görevde takılır (koordinatör işi diğerine verir), biri bir fikir açar (koordinatör
kabul eder), ertesi sabah günlük rapor hatırlatması gelir. Yeniden üretmek için (repo kökünden):

    ECONOMY_MEASURE_OUT=$PWD/docs/superpowers/notes/economy-measure.md pnpm --filter @cc/office-server exec vitest run test/economy.scenario.test.ts

- Tur = `turn.finished` olayı. Model = turun oturumunun açılışta bildirdiği model (sahte claude `--model`'i bildirir), yoksa kadrodaki model.
- Modellenmiş maliyet = Σ tur × ağırlık(model); ağırlıklar fable 15, opus 5, sonnet 1, haiku 0.2. Kaba bir ölçü: bağlam boyutunu ve
  önbelleği yok sayar, her tur aynı sayılır.
- Oturum = açılan claude oturumu (`session.started`): boşta 30 dk kalan uyur, uyanınca yeni oturum açar (soğuk başlangıç).

| Çalışan | Rol | Model | Tur | Oturum | Ağırlık | Modellenmiş maliyet |
|---|---|---|---:|---:|---:|---:|
| Koordinatör | koordinatör | fable | 14 | 8 | 15 | 210 |
| Ada | üye | sonnet | 6 | 1 | 1 | 6 |
| Can | üye | sonnet | 5 | 1 | 1 | 5 |
| **Toplam** | | | **25** | | | **221** |

Koordinatöre tur açan olaylar (simüle saat):

| # | Saat | Neden |
|---:|---|---|
| 1 | 09:00 | plan onayı |
| 2 | 09:47 | teslim |
| 3 | 09:50 | teslim |
| 4 | 10:07 | takılma |
| 5 | 10:40 | teslim |
| 6 | 10:54 | teslim |
| 7 | 11:00 | öneri |
| 8 | 11:30 | teslim |
| 9 | 11:41 | teslim |
| 10 | 12:20 | teslim |
| 11 | 12:28 | teslim |
| 12 | 13:10 | teslim |
| 13 | 14:00 | teslim + plan bitti |
| 14 | ertesi gün 09:01 | rapor hatırlatması |
