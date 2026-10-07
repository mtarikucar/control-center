# Ofis ekonomisi — yayın runbook'u

Sahibi yapar. Her blok kopyala-yapıştır hazırdır (bash). Kabul ölçütleri ve tetikleyiciler:
[economy-acceptance.md](economy-acceptance.md). Önerilen yol **adım adım** yayındır: üç anahtar kapalı başlanır, sonra
sırayla açılır; her adım ≥1 gün ve ≥10 teslim sürer.

Değişkenler (her yeni terminalde önce bunu yapıştır):

```bash
REPO=~/Projects/control-center
ECON=~/Projects/control-center-economy
DATA=~/.control-center
API=http://127.0.0.1:4319
```

## 0. Öncesi

```bash
cd "$ECON" && git log --oneline main..office-economy | head -30
cd "$ECON" && pnpm test 2>&1 | grep -E "Test Files|Tests " && pnpm typecheck 2>&1 | grep -E "error|Done"
# İsteğe bağlı, gerçek claude (haiku + sonnet, ~$0.15): model geçişi ve geçmiş korunuyor mu
cd "$ECON" && pnpm --filter @cc/office-server smoke 2>&1 | grep -E "✓|×|Tests "
```

Beklenen: testler ve typecheck yeşil; smoke'ta iki test geçer.

## 1. Sakin bir an seç ve ofisi durdur

Kimse çalışmıyor olmalı (idle, sleeping, stopped). Çalışan biri varsa işi bitene dek bekle.

```bash
curl -s "$API/api/office" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const e of JSON.parse(s).employees)console.log(e.lifecycle.padEnd(10), e.name)})'
```

Ofisi durdur: ofisin terminalinde Ctrl+C, ya da:

```bash
PID=$(cat "$DATA/office.lock"); kill -INT "$PID"; while kill -0 "$PID" 2>/dev/null; do sleep 1; done; echo "ofis durdu"
```

## 2. Yedek

Bütün veri klasörü (veritabanı + -wal/-shm, masalar, şirket arşivi):

```bash
B=~/control-center-backups/economy-$(date +%Y%m%d-%H%M) && mkdir -p "$B" && cp -a "$DATA"/. "$B"/ && echo "yedek: $B" && ls -la "$B"
node --input-type=module -e "import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync('$B/office.db',{readOnly:true}); console.log(db.prepare('PRAGMA integrity_check').get(), db.prepare('SELECT MAX(version) AS sürüm FROM schema_migrations').get()); db.close()"
```

Beklenen: `integrity_check: 'ok'`, `sürüm: 5`. **`$B` yolunu not et**; geri dönüşte gerekir.

## 3. Göç provası (yedeğin kopyasında, canlıya dokunmaz)

```bash
cd "$ECON" && node apps/office-server/scripts/migration-rehearsal.ts --from "$B/office.db"
```

Beklenen son satır: `Bütün kontroller geçti.` (5 → 7 → 5 → 7, satır sayıları aynı, eski notlar `decision`, yedekten
dönüş). Geçmezse dur; yayın yok.

## 4. Birleştir

```bash
cd "$REPO" && git status --short && git checkout main
PRE=$(git rev-parse HEAD) && echo "birleştirme öncesi: $PRE"
git merge --no-ff office-economy -m "Merge branch 'office-economy': office economy (notice kinds, digest, model policy, task difficulty, turn counter)"
MERGE=$(git rev-parse HEAD) && echo "birleştirme: $MERGE"
pnpm install
```

`PRE` ve `MERGE` değerlerini not et. (`assets/` izlenmeyen klasör olarak kalabilir; birleştirmeyi etkilemez.)

## 5. Anahtarları kapalı başlat (adım adım yayın)

Ofis durmuşken üç anahtarı kapalı yaz. Yeni kod ilk açılışta bunları okur; eski kod zaten bu anahtarları tanımaz:

```bash
node --input-type=module -e "import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(process.env.HOME+'/.control-center/office.db'); const s=db.prepare('INSERT INTO constitution (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'); for (const k of ['digestEnabled','modelPolicyEnabled','difficultyModelsEnabled']) s.run(k, 'false'); console.log(db.prepare('SELECT key, value FROM constitution').all()); db.close()"
```

Hepsini birden açmak istersen bu adımı atla (varsayılan: üçü de açık).

Kapalıyken bile şunlar yeni davranıştır: not türleri ve konuları kaydedilir; günlük rapor hatırlatması günün son özet
saatinde (17:00) gelir; görev kartı zorluk taşır; inceleme düzeltmeleri (kayıpsız teslim, kritik → zor, uyanma kuralları)
açıktır.

## 6. Başlat ve doğrula

Ofisi kendi terminalinde başlat (göçler açılışta kendiliğinden çalışır, 5 → 7):

```bash
cd "$REPO" && pnpm office
```

Başka bir terminalde:

```bash
node --input-type=module -e "import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(process.env.HOME+'/.control-center/office.db',{readOnly:true}); console.log(db.prepare('SELECT MAX(version) AS sürüm FROM schema_migrations').get()); db.close()"
curl -s "$API/api/budget" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s).constitution;console.log({digestEnabled:c.digestEnabled,modelPolicyEnabled:c.modelPolicyEnabled,difficultyModelsEnabled:c.difficultyModelsEnabled,digestHours:c.digestHours,coordinatorModels:c.coordinatorModels})})'
tail -5 "$DATA/office.log"
```

Beklenen: `sürüm: 7`; anahtarlar adım 5'e göre; çalışanlar boşta, hata yok. `YAYIN=$(date +%Y-%m-%dT%H:%M)` ile başlangıç
anını not et.

## 7. Adım adım açma

Her adım ≥1 gün ve ≥10 teslim sürsün; geçmeden önce §8'deki metriklere bak. Açmak (ya da kapatmak) için Anayasa
sekmesindeki kutucuk ya da:

```bash
# Adım 1: özet
curl -s -X POST "$API/api/constitution" -H 'content-type: application/json' -d '{"digestEnabled":true}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).digestEnabled))'
# Adım 2: model politikası (koordinatör sahibine fable, karara sonnet, özete haiku)
curl -s -X POST "$API/api/constitution" -H 'content-type: application/json' -d '{"modelPolicyEnabled":true}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).modelPolicyEnabled))'
# Adım 3: zorluk modelleri (koordinatöre görevlere zorluk vermesini söyle)
curl -s -X POST "$API/api/constitution" -H 'content-type: application/json' -d '{"difficultyModelsEnabled":true}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).difficultyModelsEnabled))'
```

Her adımın başlangıç anını not et (`ADIM1=$(date +%Y-%m-%dT%H:%M)` …).

## 8. İzleme (her gün)

Salt okunur; canlı veritabanını açar ama yazmaz:

```bash
cd "$REPO" && node apps/office-server/scripts/economy-report.ts --since "$YAYIN"
# bir adımın penceresi:
cd "$REPO" && node apps/office-server/scripts/economy-report.ts --since "$ADIM1" --until "$ADIM2"
```

Bakılacak satırlar ve kabul belgesindeki karşılıkları:

| Satır | Metrik | Gereksinim |
|---|---|---|
| `Teslim başına … sahibinin mesajları hariç` | koordinatör turu / teslim | R1 |
| `Teslim başına … koordinatör $` | koordinatör USD / teslim | R2 |
| `Not gecikmesi … karar … p95` | karar notu → tur, dk | R3 |
| `Pencere sonunda bekleyen not` | bekleyen karar/bilgi notu ve en eski yaşı | R3, R4 |
| `Olaylar: kaybolan/iptal mesaj` · `başarısız model geçişi` | mesaj kaybı, geçiş hatası | R5 |
| `Kalite: … takılan … oran` · `kuyruğa dönen` · `biten plan süresi` | iş kalitesi | R6 |
| `Modeller (tur)` | koordinatör/üye model dağılımı | R2, R5 |

Taban (main, K4, n = 4 teslim): [economy-live-baseline.md](economy-live-baseline.md). Koordinatör (sahibi hariç)
1,25 tur/teslim, koordinatör $1,83/teslim, takılan oranı 0, karar gecikmesi p95 0 dk.

## 9. Geri alma tetikleyicileri

Kabul belgesinden (§Yayın planı 4) ve ek:

| Tetikleyici | Eşik | Önce kapat |
|---|---|---|
| Karar notu gecikmesi | p95 > 5 dk (koordinatör boştayken) | `digestEnabled` |
| Kayıp mesaj | `kaybolan/iptal mesaj bildirimi` ≥ 1 ve bir görev/not kayboldu | `modelPolicyEnabled` |
| Başarısız model geçişi | ≥ 3 / gün | `modelPolicyEnabled` |
| Takılan görev oranı | tabanın %25 üstü (taban küçükse: oran > 0,25) | `difficultyModelsEnabled`, sonra `modelPolicyEnabled` |
| Koordinatör turu azalmıyor | R1 penceresinde tabanın %80'i üstü | `digestEnabled` açık mı bak; sonra kod geri alma |
| Bekleyen bilgi notu yaşı | uyanık alıcıda > özet aralığı + 5 dk | `digestEnabled` |

## 10. Geri alma

**a. Anahtar (anında, veri kaybı yok):** ilgili özelliği kapat; sonraki turdan itibaren eski davranış.

```bash
curl -s -X POST "$API/api/constitution" -H 'content-type: application/json' -d '{"digestEnabled":false,"modelPolicyEnabled":false,"difficultyModelsEnabled":false}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s);console.log(c.digestEnabled,c.modelPolicyEnabled,c.difficultyModelsEnabled)})'
```

**b. Kod (önceki sürüm, veri kaybı yok):** veritabanı 7'de kalır. Main'in kodu 7 şemasında çalışır (2026-10-07'de canlı
kopyada denendi: göç adımı boş geçer, yeni sütunlar varsayılan alır, yeni anayasa anahtarları yok sayılır, dalın yazdığı
notlar/görevler okunur).

```bash
PID=$(cat "$DATA/office.lock"); kill -INT "$PID"; while kill -0 "$PID" 2>/dev/null; do sleep 1; done; echo "ofis durdu"
cd "$REPO" && git revert -m 1 --no-edit "$MERGE" && git log --oneline -3
cd "$REPO" && pnpm office
```

(`$MERGE` adım 4'ten. Geçmişi değiştirmez; yeniden yayın için ileride revert geri alınır.)

**c. Veritabanı (yalnız veri bozulduysa):** yedekten sonra yazılan her şey (görevler, notlar, olaylar) kaybolur. Önce
(b) yapılmış olmalı (eski kod + eski şema).

```bash
PID=$(cat "$DATA/office.lock"); kill -INT "$PID"; while kill -0 "$PID" 2>/dev/null; do sleep 1; done; echo "ofis durdu"
X=~/control-center-backups/bozuk-$(date +%Y%m%d-%H%M) && mkdir -p "$X" && mv "$DATA"/office.db* "$X"/ && echo "bozuk kopya: $X"
cp -a "$B"/office.db* "$DATA"/ && ls -la "$DATA"/office.db*
node --input-type=module -e "import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(process.env.HOME+'/.control-center/office.db',{readOnly:true}); console.log(db.prepare('PRAGMA integrity_check').get(), db.prepare('SELECT MAX(version) AS sürüm FROM schema_migrations').get()); db.close()"
cd "$REPO" && pnpm office
```

Beklenen: `integrity_check: 'ok'`, `sürüm: 5`. Masalar ve şirket klasörü de geri istenirse (nadiren): ofis durmuşken
`cp -a "$B"/desks "$B"/company "$DATA"/`.

Veri kaybı olmadan şemayı 5'e indirmek (gerekmez; eski kod 7'de çalışır) yalnız dal kodu ile mümkündür:
`node --input-type=module -e "import {openDb, migrateDown} from '$ECON/apps/office-server/src/db.ts'; console.log(migrateDown(openDb(process.env.HOME+'/.control-center/office.db'), 5))"`
(ofis durmuşken; provada denendi, satır sayıları korunur).

## 11. Kabul

Pencereler bitince her adım için `economy-report` çıktısını kabul belgesinin izlenebilirlik matrisine (R1, R2, R6 = K4)
işle; tetikleyici olmadıysa sahibi onaylar, retrospektif yazılır.
