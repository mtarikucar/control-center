# B9a — Geri alınamaz iş kapısı: kanca ve onay kaydı — birleştirme ve uygulama notu (`feat/b9a-gate`)

> **ÖNCE OKU: kapı varsayılan KAPALI gelir.** B9a canlıya girse de sahibi açana kadar hiçbir çağrı kapıya takılmaz;
> kanca her oturumda durur ama "geç" der ve olay yazmaz.
>
> **Açmak için:** ofis sayfası → Şirket → **Anayasa** sekmesi → "Geri alınamaz iş kapısı açık" kutucuğu → Kaydet.
> - Açtığın anda geçerli olur, oturumları yeniden başlatmak gerekmez.
> - Değişiklik olay kaydına (`budget.changed`) ve koordinatöre ("Geri alınamaz iş kapısı kapalı → açık") düşer.
> - Onay istekleri Şirket → **Onaylar** sekmesine ve üst çubuktaki sayaca gelir.
>
> Kapı kazara ve sıradan yolları kapatır; aynı kullanıcıdaki kararlı bir atlatmayı durdurmaz; sahibi onayı yalnız ofis
> sayfasından sayılır (§8).

- Tarih: 2026-10-08 · Yazan: Mert · Görev: e2d6707f (C5-1) · İnceleyen: Kerem
- Tasarım: Selin, `tasarim-b9-kanca-onay.md` sürüm 4 (arşiv:
  `company/archive/cekirdek-4-kpi-olcumu-b26-ve-p1-hazirlig/2026-10-08-3f7fe283-b9-tasarim-notu-tur-3-onemli-bulgusu-wor/`).
  §10'daki 14 madde aşağıda madde madde.
- Dal `feat/b9a-gate`, `integration/core-4` (8ecec35) üstünde.
  - Koordinatör kararı: core-3 değil core-4. Gerekçe: v21 v20'nin hemen arkasına gelsin, açılış denetimi dalda olsun.
  - İnceleme turu 1'de core-4'ün yeni ucuna (8ecec35, yalnız not) yeniden kuruldu.
- **Sahibi bu dalı tek başına almaz:** B8 ve B9b ile birlikte, çakışmaları çözülmüş olarak `integration/core-5-gate`'te
  gelir (§3, §4).
- Göç: **v21** (`approvals`, yalnız yeni tablo).

## 1. Ne geldi

| Parça | Dosya |
|---|---|
| Politika: çağrıyı sınıflar (kapıda mı, türü, kaba hedefi, parmak izi); saf fonksiyon | `apps/office-server/src/company/gate-policy.ts` |
| Kabuk okuyucu: tırnak, heredoc, alt kabuk, `$(…)`, döngü, `case`; düzenli ifade değil | `apps/office-server/src/company/shell.ts` |
| Kanca betiği: PreToolUse, bağımlılıksız, her hatada `exit 2` | `apps/office-server/hooks/gate.mjs` |
| Onay kaydı (v21) ve servisi | `company/approval-store.ts`, `company/approvals.ts` |
| Kapı servisi ve gerçek bağlam (git'e worktree durumu eşzamansız sorar, betik okur) | `company/gate.ts` |
| Araçlar `approvalRequest` (herkes), `approvalsRead` (kendi; koordinatör hepsi) | `mcp/tools.ts` |
| `POST /gate/check` (oturum jetonu), `GET /api/approvals`, `POST /api/approvals/:id/approve\|deny` (OwnerGuard) | `api.ts` |
| Sahibi işaretleri: `(method, yol, işaret)` başına saatte en çok bir koordinatör notu | `owner-flags.ts` |
| Oturum: `--settings` içinde `hooks.PreToolUse` + `disableAllHooks: false`; ortamda `OFFICE_GATE_URL`, `OFFICE_GATE_TOKEN` | `claude/args.ts`, `engine.ts`, `main.ts` |
| Anahtar `gateEnabled` (varsayılan kapalı), Anayasa kutucuğu | `packages/shared/src/budget.ts`, `company/budget.ts`, `BudgetTabs.tsx` |
| Web: Onaylar sekmesi ve kartı, üst çubuk sayacı, akış satırları | `apps/office-web/src/ui/ApprovalCard.tsx`, `CompanyView.tsx`, `TopBar.tsx`, `EventItem.tsx` |
| Çalışma kuralı ve koordinasyon maddesi | `company/craft/working.md`, `company/craft/coordination.md` (madde 7) |

## 2. Tasarımdan farklar (bilerek; her biri testli)

1. **Anahtar** `gateEnabled`, varsayılan kapalı.
   - Koordinatör onayı (askColleague, 2026-10-08). Gerekçe: canlıya girdiği gün her sınıflandırılmamış bağlayıcı aracı
     ve tarayıcı etkileşimi onay bekler; sahibi ne zaman açacağını seçsin.
   - Kapalıyken kapı olay yazmaz, her çağrı geçer.
2. **Kanca ucu `/gate/check`, `/api/` dışında** (tasarım §6 bu seçimi bana bırakıyordu).
   - OwnerGuard "`/api/` altındaki her değişiklik sahibinindir" kuralıyla bütün kalır; istisna yok.
   - Kanca oturumun kendi jetonuyla sorar. Jetonsuz istek 401, yabancı Origin 403.
   - Ofisin API kuralı `/gate/check`'i de izin listesi dışı sayar: çalışanın `curl`'ü kapıya takılır.
3. **Onaylar kartı web'de** (tasarımda ayrı iş B9b-web'di).
   - Koordinatör onayı; görev başlığı "onay kartı" diyor.
   - Onaylar sekmesi, üst çubuk sayacı ve akıştaki kart geldi.
4. **Korunan yollar tasarımdan geniş.**
   - Canlı checkout'un tamamı korunur, tasarımda yalnız `hooks/`, `src/`, `node_modules/` ve `package.json` vardı.
   - Veri dizininin tamamı korunur, kendi masa hariç (masanın `.claude/` klasörü yine korunur).
   - `~/.claude`'da masanın kendi bellek klasörü (`projects/<masa>/`) serbest; başka her yeri korunur.
5. **Parmak izi** `sha256(araç|tür|hedef)`. Türün eklenmesiyle düz bir `git push` onayı `git push --force`'u geçirmez.
6. **`Monitor` aracı** da kabuk komutu çalıştırır, Bash kurallarıyla kapıdadır.
7. **Ek kurallar** (tasarımın listesine eklenenler):
   - `pnpm office` her checkout'ta kapıda; `OFFICE_DATA_DIR` verilmişse geçer. Gerekçe: bir worktree'nin ofisi de canlı
     veri dizinini açıp göç çalıştırır.
   - `gh` için tasarımdaki listeye `issue`, `repo`, `api` yazımları eklendi.
   - Ayrıca kapıda: `docker push`, `twine upload`, `cargo publish`, `aws s3 cp/sync/rm`, `ssh`/`scp`/`rsync` uzak hedef,
     `mail`/`sendmail`, `find -delete`/`-exec`, `xargs`.
   - Betik çalıştırma: `bash dosya`, `source`, `./x.sh` ve `curl … | bash`. Betik okunur ve içi sınıflanır; okunamazsa
     kapıdadır.
8. **Canlı kayıttan gelen yanlış pozitif düzeltmeleri** (K4: Bash çağrılarında %5,2'den %1,9'a):
   - Aynı satırda heredoc ile yazılıp çalıştırılan betik okunur. Kerem'in `readOnly: true` betikleri geçer; işareti
     olmayan yine kapıda.
   - `mktemp` çıktısı kendi klasöründe sayılır.
   - Bilinen değerler üstündeki döngü her değer için ayrı denenir.
   - `${X:-varsayılan}` ve `${X:?}` açılır; betiğe verilen argümanlar `$1…$9` olur.
   - Düzenleme betiklerinin metin dizgileri (`git push`, `office.db`, `method: 'POST'`) ancak kod gerçekten komut ya da
     HTTP başlatıyorsa, ya da veritabanı açıyorsa sayılır.
   - Tasarımın sabitlediği "217 komutta 2 kapı" sayısı bu yüzden "0 tam komut + 4 kesik satır" oldu. 688 artık geçer:
     aynı satır betiği `readOnly: true` ile yazıyor. Test sabitliyor.

9. **İnceleme turu 1 (Kerem):**
   - **[önemli] Tarayıcıyla ofis sayfası.** Tarayıcı ofisin sayfasına ya da API'sine giderse çağrı ofisin kendisidir
     (`self`), çağrı başına kapıdadır; hiçbir tarayıcı ya da görev onayı onu geçirmez.
     - Kapsanan yollar: `navigate`, yeni sekme, `run_code_unsafe`/`evaluate` içinde ofis adresi ya da göreli
       `/api/`, `/gate/`, `/mcp`, ve `network_request`.
     - Host biçimleri curl ile aynı: `127.1`, `0x7f000001`, `*.localhost`, `[::1]`, `127.0.0.1.nip.io`, ofisin portu.
     - `self` türü görev boyunca istenemez (`scope: task` reddedilir), görev onayıyla da eşleşmez.
     - Ek olarak web istemcisi otomasyonla açılmış sayfada (`navigator.webdriver`, Playwright'ın tarayıcısı) sahibi
       anahtarını hiç almaz. Böylece bir dış site tarayıcıyı ofis sayfasına yönlendirse bile oradaki "Onayla" düğmesi
       çalışmaz.
   - **[küçük] Yorumlayıcının korunan dosyaya yazması.** python/node/perl/ruby kodu dosya yazıyorsa, bir yazma
     çağrısının aldığı yol korunan yola düşüyorsa kapıdadır. Yol literal ya da atandığı değişkenle verilebilir; mutlak,
     `~` ya da etkin cwd'ye göre çözülür.
   - **[küçük] Ucuz atlatmalar:**
     - ofisin portuna ham bağlantı (`/dev/tcp`, `nc`, `ncat`, `socat`);
     - `sqlite3 file:…` URI'si (kendi `mode`'u), `-cmd ".open …"`, `ATTACH`;
     - korunan yola `ln -s`;
     - liste biçimli komut başlatma (`subprocess.run([...])`, `execFileSync('git', [...])`, perl `system("git", …)`,
       `q{}`/`%q{}`);
     - başka komut çalıştıranlar (`watch`, `script -c`, `parallel`, `trap`, `alias`, `su -c`, `flock`, `tmux`, `screen`);
     - her konumdaki `publish` (`npm --registry x publish`, `yarn npm publish`);
     - `awk -i inplace`.
     - Komut başlatma ve veritabanı kodu dile göre ayrılır: düzenleme betiğindeki TypeScript metni, SQL `db.exec(`,
       perl yerine koymasındaki ters tırnak komut değildir.
     - Okunamayan satır kapıda kalır, ofisi çökertmez.
   - **[küçük] Eşleyici gerçek oturumun araçlarıyla karşılaştırıldı.**
     - Eşleyiciye eklendi: `SendMessage` (başka bir Claude oturumuna, sahibinin kendi oturumuna da iş yaptırabilir;
       gönderim), `PushNotification` ve `DesignSync`.
     - Eklenmedi: `ListAgents` yalnız listeler, `Skill` yalnız yönerge yükler.
     - `Task`/`Workflow`'un başlattığı alt ajanın çağrıları kancadan geçer. Kilitli K3 bunu sabitliyor: alt ajanın stub
       çağrısı kapıya takıldı.
   - **[küçük] Birleştirme:** B8 + B9b + B9a için `integration/core-5-gate`. Tek satır ön koşulları denetler, ofisi
     durdurur, `main.pre-gate` ve `office.pre-gate.db`'yi yazar; prova iki kez koşuldu (§4).
   - **[küçük] git'in durumu eşzamansız:**
     - Kapı önce önbellekle sınıflar (2 sn). Cevabı olmayan soru temkinli cevaplanır: worktree kirli, liste boş.
     - Sonra git'i `execFile` ile eşzamansız sorar (2 sn sınır, paralel) ve yeniden sınıflar.
     - Ofisin olay döngüsü git'i hiç beklemez (K2 testi bunu gösteriyor).

## 3. Göç ve sıra

- Sıra:
  1. core-3 (sahibi; `2026-10-08-core-3-merge.md`);
  2. core-4 (açılış denetimi + B26 v19 + B11 v20);
  3. **B9a (v21)**.
- B9a core-4'ten önce alınamaz: v19–v20 atlanır. Açılış denetimi bunu yakalar ve ofisi açmaz.
- v21 yalnız yeni tablo ve iki indekstir. Eski kod onu yok sayar, yalnız-kod geri alma güvenlidir.
- **B8 (`feat/capability-precheck`) ve B9b (`feat/b9b-session-deny`):** ikisi de core-3 üstünde, B9a ile çakışıyor. Sahibi
  çakışmayı elle çözmesin diye üçü `integration/core-5-gate`'te core-4 üstüne birleştirildi; çakışmaların hepsi "ikisi de
  tutulur" türünde. Ayrıntı o dalın notunda: `2026-10-08-core-5-gate-merge.md`.
  - B9b: `claude/args.ts`'te `sessionArgs` hem `hook` hem `disallowed` alır. `engine.ts` ikisini birlikte geçirir.
  - B8: anayasa anahtarları yan yana (`capabilityPrecheckEnabled`, `gateEnabled`); dağıtıcıda B26'nın `kpis`'i ile
    B8'in `precheck`'i yan yana.

## 4. Birleştirme (sahibi)

**Adım 4:** `integration/core-5-gate`, adım 1–3'ten sonra. Tek satır o dalın notunda
(`docs/superpowers/notes/2026-10-08-core-5-gate-merge.md`). Satırın yaptıkları:
- main'de adım 1–3 (açılış denetimi, core-3, core-4) yoksa hiçbir şeye dokunmadan durur;
- açık ofisi durdurur;
- `~/.control-center/main.pre-gate`'i yazar; dosya varsa durur, yani ikinci yapıştırmada hiçbir şeye dokunmaz;
- veritabanının tutarlı yedeğini alır: `office.pre-gate.db`;
- `integration/core-5-gate`'i `--no-ff` birleştirir, ofisi başlatır; açılışta v21 uygulanır.

Kapılar kapalı başlar.

## 5. Prova

- **Göç (K4, canlı DB'nin salt okunur kopyası; `outputs/b9a-gate/live-copy-check.txt`):**
  - v15 → v20 → **v21**: `approvals` tablosu boş;
  - v21 → v20: şema v20 ile birebir aynı;
  - v20 → v21: satır sayıları aynı (8 çalışan, 133 görev, 6 plan, 16 öneri).
  - Canlı DB yalnız okundu, sürümü hâlâ 15.
- **Kapı canlı kayıtta (K4, aynı kopya; inceleme turu 1 sonrası):** canlı ofisin bütün araç çağrıları kapıdan geçirildi,
  anahtar açık varsayıldı.
  - Bash: 2705 çağrının 56'sı kapıya takılırdı (%2,1).
  - Bu 56'nın 23'ü kayıtta 2000 karakterde kesilmiş satır. Ofisin olay kaydı araç girdisini kısaltıyor; gerçek komut
    bütündü.
  - Kalan 32:
    - canlı DB'ye salt-okunur işareti görünmeyen `node`/`python` erişimleri (15). Biri `backfill-task-cost.ts --apply`:
      doğru takılma;
    - adı çalışınca belli olan komutlar, okunamayan betikler ve stdin'den bash (7);
    - hedefi belirsiz yazma ya da silme (5);
    - `~/.claude/projects/…` silmeleri (3);
    - Kerem'in kapıyı deneyen bataryaları (3);
    - eşleşmeyen ters tırnaklı bozuk bir komut (1).
  - Write, Edit, WebFetch, Read ve ofis araçlarında takılan yok.
- **Tek satır ve B8 + B9b + B9a:** `integration/core-5-gate` notunda ve `outputs/b9a-gate/core-5-gate-rehearsal.txt`'te.
  Ön koşul eksikken durma, açık ofisi durdurup birleştirme, ikinci yapıştırmada dokunmadan durma, v21 göçü, yalnız kod
  geri alma ve yedekten dönüş denendi.

## 6. Geri alma

- **Kapıyı kapatmak:** Anayasa kutucuğunu kaldır. Anında geçerli, kod değişmez.
- **Yalnız kod (veri kaybı yok):** ofisi durdur;
  `cd ~/Projects/control-center && git reset --hard $(cat ~/.control-center/main.pre-gate) && pnpm office`.
  - Veritabanı v21'de kalır. Adım 3 kodu onu "koddan ileride [21]" uyarısıyla açar (prova D).
  - `approvals` tablosuna eski kod dokunmaz.
  - Birleştirmeden sonra main'e başka commit girdiyse: `git revert -m 1 --no-edit <birleştirme commit'i>`.
- **Veriyle tam dönüş:** ofisi durdur;
  `cp ~/.control-center/office.pre-gate.db ~/.control-center/office.db && rm -f ~/.control-center/office.db-wal ~/.control-center/office.db-shm`,
  sonra yalnız kod geri alma (prova E).

## 7. Doğrulama

- K1/K2 testleri:
  - `test/gate-policy.test.ts`: tasarım §7 K1-1 satırlarının hepsi, inceleme turu 1 satırları, 217 canlı komut veri olarak;
  - `approvals.test.ts`, `gate-api.test.ts`, `gate-hook.test.ts` (K2: gerçek alt süreç, geçici git deposu, olay döngüsü);
  - `args.test.ts`, `engine-gate.test.ts`, `db.test.ts` (v21), `owner-guard.test.ts` (`OWNER_ROUTES`);
  - web: `ApprovalCard.test.tsx`, `reducers.test.ts`, `api.test.ts` (`navigator.webdriver`).
- K3 kilitli: `test/gate.real.test.ts` (`OFFICE_SMOKE=1`; `outputs/b9a-gate/k3-real.txt`). 4/4 geçti; CLI'nin bildirdiği
  maliyet $0.0027 + $0.0039, abonelik kotasından, para harcanmadı.
  - **Akış:** kapı → `approvalRequest` → sayfa başlıklarıyla onay → "pong" → kapı.
  - **Eşleyici:** kanca ofis araçlarını hiç görmedi; olumsuz ileri bakış Claude Code'da çalışıyor.
  - **Masa ayarı:** masadaki `disableAllHooks: true` kancayı kapatamadı.
  - **Alt ajan (tur 1):** `Task` ile başlatılan alt ajanın stub çağrısı kancaya ulaştı ve kapıya takıldı.
  - **Bash:** kanca ayardayken Bash oturumda kalıyor.
  - **Çift `--disallowedTools`:** ikisi de uygulanıyor.
  - `lockdown.real` kilitsiz açıldığı için (sahibinin bağlayıcıları oturuma girer) çalıştırılmadı. Aynı soruyu soran
    kilitli eşdeğeri K3'ün içinde.
- Mutasyon (`outputs/b9a-gate/mutation-checks.txt`): geçici worktree, `setsid`.
  - Bu turda 102 mutanttan 101'i yakalandı. 26'sı tur 1 kuralları için yeni.
  - Kalan G7 eşdeğer: o kod yoluna hiç ulaşılmıyor. Aynı davranışı taklit eden G7b yakalandı.
  - Koşudan önce ve sonra worktree temiz (`git status --porcelain` boş).
- `pnpm test` ve `pnpm typecheck` çıkış 0 (460d007): sunucu 960 geçti, 17 atlandı; web 201 geçti
  (`outputs/b9a-gate/full-tests.txt`, `typecheck.txt`).

## 8. Kalan risk (tasarım §8; süreç ayrımı olmadan dürüst sınır)

- **Sahibi kimliği taklit edilebilir.** Çalışan sahibiyle aynı Unix kullanıcısında çalışıyor.
  - OwnerGuard (Origin + sayfa nonce'u) ve ofise giden Bash/WebFetch isteklerinin kapıda olması **sıradan** kendi kendine
    onayı durdurur. `curl -X POST …/approve` kapıya takılır, kaçsa bile sunucu `403 owner_origin` döner.
  - Uydurulmuş başlıklarla tam sahte istek geçer. `office.db` aynı kullanıcıya yazılabilir.
  - Bu, D4 katman 1 (ayrı kullanıcı ya da konteyner) olmadan kapanmaz. B9a bunu çözmez, yazar.
- **Kanca ve ayarlar çalışanın kendi kullanıcısında.**
  - `disableAllHooks: false` masa ayarını ezer (K3'te yeniden üretildi).
  - Kanca betiği, canlı checkout ve masaların `.claude/` klasörü korunan yollarda.
  - **Yakalanmayanlar:**
    - `python`/`node`/`perl` programı içinden yazma: yol çalışınca kuruluyorsa (`root + T`, birleştirme, okunan dosya) ya da
      program diskteki, okunamayan bir dosyadaysa; programdan HTTP, istek kütüphanesi tanınmıyorsa;
    - `make` ya da `package.json` betiğine gizlenen komut (`pnpm run` serbest);
    - `vim`, `ed` gibi düzenleyiciler ve listede olmayan yürütücüler;
    - dinamik son bileşenle `..` kaçışı (`/tmp/x/$(…)` statik klasöre göre karar verir);
    - önceki bir çağrıda `export` edilen değişken. `${X:-varsayılan}` bunu görmez ve varsayılanı alır;
    - `git branch -f main` ya da `git update-ref` ile canlı dalın başka bir worktree'den taşınması. Kural yalnız
      `REPO_ROOT` kökündeki çalışma ağacı yazıcılarına bakıyor.
- **Tarayıcı:**
  - Sahibi tarayıcının ofis sayfasına gitmesine (tek çağrılık `self` onayı) izin verirse sayfa o tarayıcıda açılır.
    Otomasyonla açılmış sayfada istemci sahibi anahtarını almaz. Ama kodla (`evaluate`) anahtarı kendisi isteyen
    kararlı bir betik bunu aşar; ofis adresi şifrelenmiş ya da parça parça kurulmuşsa kapı onu göremez.
  - Kapı tarayıcının hangi sayfada olduğunu bilmez: bir tıklama sayfaya bakılmadan sınıflanır.
- **Kapıyı deneyen betikler:** saldırı dizgilerini taşıyıp süreç başlatan test betikleri (Kerem'in bataryaları gibi)
  kapıya takılır. Bu bilinen ve kabul edilmiş bir yanlış pozitif.
- **Okuma kapatılmaz:** `~/.ssh` okunabilir, `SSH_AUTH_SOCK` ortamda kalır.
- **Model onaydan sonra çağrıyı değiştirirse** kaba hedef eşleşmez ve yeniden onay gerekir. Tarayıcı işi için
  `scope: task` var.
- **Kanca gecikmesi:** eşleşen her çağrıda bir `node` süreci başlar (≈30–60 ms). Ofis araçları ve salt-okunur yerleşik
  araçlar eşleyiciye girmez (K3: kanca ofis araçlarını hiç görmedi).
- **Kapalıyken de kanca çalışır:** ofise ulaşamazsa çağrı durur (fail-closed). Ofis kapalıyken oturumlar da zaten kapalı.
