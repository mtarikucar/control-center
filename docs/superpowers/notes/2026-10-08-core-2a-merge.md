# Çekirdek 2a — birleştirme ve çıkış notu (`integration/core-2a`)

- Tarih: 2026-10-08 · Yazan: Mert · Görev: 9fc6b6a3 (inceleme turu 1, Kerem) · İnceleyen: Kerem
- **Bugün birleştirilebilecek dal budur.** İçindekilerin hepsi incelemeden geçti: Çekirdek 1 ve B1 (onboarding).
- B3 (entegrasyon kaydı) burada **yok**: incelemesi sürüyor. B3 onaylanınca `integration/core-2` yeniden kurulur;
  bu dalın üstüne gelir, yani bu dal alınmışsa da hızlı ileri alınabilir.

| Sıra | Dal (baş) | Birleştirme | İçerik | Göç |
|---|---|---|---|---|
| 1–4 | core-1: fix/task-turn-cost, feat/performance-metrics, feat/goal-kpis, feat/company-profile | 814934b, cd50290, c3fe3a9, 95c8166 | maliyet kuralı, B4, B16, B2 | v12, v13 |
| 5 | `feat/onboarding` (6e45547, onaylı) | d4c78f3 | B1 onboarding diyaloğu | v14 |

Göçler 1–14 boşluksuz ve tekrarsız. d4c78f3'ün mesajında "into integration/core-2" yazar: önceki core-2'nin B1
birleştirmesi aynı commit'tir, yeniden kullanıldı.

**Orijinal dalları tek tek main'e alma; yalnız bu dalı.** B3 incelemesi bitmeden `integration/core-2`'yi alma: B3'ün
düzeltmesi v15'i değiştirirse canlıya önce giren eski v15, düzeltilmişini sessizce atlatır (core-1 notundaki tuzak).

## Birleştirme ve çıkış (sahibi; ofis durdurulmuşken, tek satır)

```
cd ~/Projects/control-center && node -e 'new (require("node:sqlite").DatabaseSync)(process.argv[1],{readOnly:true}).prepare("VACUUM INTO ?").run(process.argv[2])' ~/.control-center/office.db ~/.control-center/office.pre-core2a.db && git merge --ff-only integration/core-2a && node apps/office-server/scripts/backfill-task-cost.ts --db ~/.control-center/office.db --apply && pnpm office
```

Sırasıyla:
1. Yedek alır (`office.pre-core2a.db`).
2. main'i hızlı ileri alır (main `840e9d8`'de; değilse durur).
3. **İsteğe bağlı** geri doldurma yapar; istemezsen o parçayı çıkar.
4. Ofisi başlatır; göç v12–v14 uygulanır.

## Geri alma

- **Yalnız kod:** ofisi durdur, `git -C ~/Projects/control-center reset --hard 840e9d8` (ya da yalnız B1'i geri almak
  için `b89716d`), `pnpm office`. Birleştirmeden sonra main'e başka commit girdiyse:
  `git -C ~/Projects/control-center revert -m 1 --no-edit d4c78f3` (B1), gerekirse
  `95c8166 c3fe3a9 cd50290 814934b` (Çekirdek 1). Veritabanı v14'te kalabilir: göçler ekleme türünde; main'in ve
  core-1'in kodu daha yüksek sürümlü bir kopyada çalıştı (`outputs/core-2/rollback-rehearsal.txt`).
- **Veriyle birlikte tam dönüş:** ofisi durdur;
  `cp ~/.control-center/office.pre-core2a.db ~/.control-center/office.db && rm -f ~/.control-center/office.db-wal ~/.control-center/office.db-shm`.
