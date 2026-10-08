# Kapı — birleştirme ve çıkış notu (`integration/core-5-gate`: adım 5)

> **SIRA:** bu, **adım 5**'tir. Önce adım 4 (`integration/core-5`, Can, ec929c7, onaylı c8c652e1) alınmış olmalı. Adım 4
> adım 1–3'ü (açılış denetimi, core-3, core-4) ve B8 ile B9b'yi zaten içeriyor. Aşağıdaki satır bunu kendisi denetler:
> core-5 main'de değilse hiçbir şeye dokunmadan durur. Yönetim döngüsü (v22) bundan sonra gelir (adım 6). Kaynak:
> Kerem'in birleştirme matrisi 3 §5 ve sahibine talimatın adım 5'i.
>
> **Bu dalın eski hali (core-4 tabanlı, uç b93779b) birleştirilmez.** O uç B8 + B9b + B9a'yı core-4 üstüne kuruyor ve
> notu "adım 4" diyordu; core-5'ten sonra alınırsa `main.ts`, `mcp/tools.ts` ve `args.test.ts`'te çakışır. Dal o uçtan
> bu uca taşındı (görev fc72b35b).
>
> **Kapı varsayılan KAPALI gelir.** Açmak için: ofis sayfası → Şirket → Anayasa → "Geri alınamaz iş kapısı açık".
> Ayrıntı: `2026-10-08-b9a-gate-merge.md`.

- Tarih: 2026-10-08 · Yazan: Mert · Görev: fc72b35b (isteyen ve inceleyen Kerem)
- Taban: `integration/core-5` ec929c7.

| Sıra | Dal (baş) | İçerik | Göç | İnceleme |
|---|---|---|---|---|
| 1 | `feat/pilot-metrics` (552b226) | Can'ın C5-5 test düzeltmesi: C5-5 testleri B9a'nın `approvals` tablosuyla da tablosuz da geçer | — | 9937b72a |
| 2 | `feat/b9a-gate` (80224af) | B9a kanca ve onay kaydı, anahtarla (kapalı) | **v21** | tur 2 |

- `feat/pilot-metrics` çakışmasız biner.
- `feat/b9a-gate` 12 dosyada 15 blokla çakışır. Hepsi iki tarafı tutarak çözüldü; çözücü
  `outputs/core-5-gate/resolve-b9a-on-core5.py`.
  - **B9b ile:** `claude/args.ts`'te `sessionArgs` hem `hook` hem `disallowed` alır. `engine.ts` ikisini birlikte geçirir:
    kanca ve rolün kapalı araçları aynı oturumda.
  - **B8 ile:** iki anayasa anahtarı yan yana (`capabilityPrecheckEnabled`, `gateEnabled`). Etkilenen yerler:
    `shared/budget.ts`, `SWITCHES`, Anayasa kutucukları, `budget.test.ts` ve web test sabitleri.
  - **`main.ts`:** B9b'nin `sessionDeny` import'u ile B9a'nın `REPO_ROOT`'u yan yana. `integrations` bir kez kurulur,
    B8'in koyduğu yerde (dağıtıcıdan önce). Ardından B9a'nın onay ve kapı kablolaması gelir.
  - **Import satırları üç yollu:**
    - `mcp/tools.ts`: core-5'in adları ve B9a'nın eklediği onay tipleri. C5-6'nın bıraktığı `MemoryHit` geri gelmez.
    - `test/args.test.ts`: B9b'nin `DISALLOWED_TOOLS`'u ve B9a'nın `GATE_MATCHER`/`gateHookCommand`'i.
- Kerem'in provası (ca58e1d, B9a 652ba90) ile karşılaştırma: `outputs/core-5-gate/compare-with-kerem-ca58e1d.txt`.
  - Aynı girdiyle 5 dosyada yalnız biçim farkı var: alanların ve import adlarının sırası, bir test yorumu.
  - Gerçek uçtaki fark, bunlara ek olarak B9a'nın 652ba90 → 80224af ilerleyişidir: iki test eki, bir sözcükleyici
    düzeltmesi ve not.

Göçler 1–21 boşluksuz ve tekrarsız. Bağımlılık değişmedi; `pnpm install` gerekmez.

## Birleştirme ve çıkış (sahibi; tek satır, bir kez)

```
cd ~/Projects/control-center && { git merge-base --is-ancestor ec929c7 HEAD || { echo 'Önce adım 4 (integration/core-5).'; false; }; } && L=~/.control-center/office.lock && { [ ! -e "$L" ] || { P=$(cat "$L"); kill -INT "$P" 2>/dev/null; while kill -0 "$P" 2>/dev/null; do sleep 1; done; }; } && (set -C; git rev-parse HEAD > ~/.control-center/main.pre-gate) && node -e 'new (require("node:sqlite").DatabaseSync)(process.argv[1],{readOnly:true}).prepare("VACUUM INTO ?").run(process.argv[2])' ~/.control-center/office.db ~/.control-center/office.pre-gate.db && git merge --no-ff --no-edit integration/core-5-gate && pnpm office
```

Satır sırasıyla:
1. main'de adım 4 (core-5, ec929c7) yoksa durur: "Önce adım 4 (integration/core-5)." Hiçbir şey değişmez.
2. Ofis açıksa durdurur ve kapanmasını bekler. Önceki adımların satırlarıyla aynı.
3. main'in şimdiki commit'ini `~/.control-center/main.pre-gate`'e yazar. Dosya varsa durur ("cannot overwrite existing
   file"): satır daha önce çalışmış demektir.
4. Veritabanının tutarlı yedeğini alır: `office.pre-gate.db` (v20).
5. `integration/core-5-gate`'i `--no-ff` ile birleştirir. Adım 4'ten sonraki main'e temiz biner; sonuç ağacı bu dalla
   birebir aynı.
6. Ofisi başlatır; açılışta v21 (`approvals`, boş) uygulanır. Kapı kapalı başlar.

**Satırı yeniden yapıştırma:**
- `pnpm office` açılmazsa yalnız `pnpm office`'i yeniden çalıştır.
- Satır 3. adımda durursa birleştirme yapılmıştır; yalnız `pnpm office`.
- `main.pre-gate` ve `office.pre-gate.db`'yi silme; geri alma ikisini kullanır.

## Geri alma

- **Kapıyı kapatmak:** Anayasa kutucuğu. Anında geçerli, kod değişmez.
- **Yalnız kod (veri kaybı yok):** ofisi durdur;
  `cd ~/Projects/control-center && git reset --hard $(cat ~/.control-center/main.pre-gate) && pnpm office`.
  - Veritabanı v21'de kalır. Adım 4 kodu onu `ahead=[21]` uyarısıyla açar ("veritabanı koddan ileride"); göç yalnız
    yeni bir tablodur.
  - Birleştirmeden sonra main'e başka commit girdiyse: `git revert -m 1 --no-edit <birleştirme commit'i>`.
- **Veriyle birlikte tam dönüş:** ofisi durdur;
  `cp ~/.control-center/office.pre-gate.db ~/.control-center/office.db && rm -f ~/.control-center/office.db-wal ~/.control-center/office.db-shm`,
  sonra yalnız kod geri alma. Çıkıştan sonra yazılan her şey (onay kayıtları dahil) kaybolur.

## Prova ve doğrulama

- Sonuçlar `outputs/core-5-gate/`'te:
  - `pnpm test` ve `pnpm typecheck` (`tests.txt`);
  - `OFFICE_SMOKE=1` ile `gate.real`, `lockdown.real` ve `session-deny.real` (`real-tests.txt`);
  - satırın provası (`rehearsal.txt`): geçici klonda adım 1–4'ten sonraki main, canlı DB'nin salt okunur kopyası,
    "açık ofis" yerine SIGINT'te çıkan ve kilidi tutan bir süreç.
