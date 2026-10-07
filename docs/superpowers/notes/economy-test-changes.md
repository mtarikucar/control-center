# Ekonomi dalı: main'e göre silinen ve beklentisi değişen testler (R12)

Yöntem: `node apps/office-server/scripts/test-changes.mjs --show` (repo kökünde). Önce `git diff main -- '*test*'`
ile değişen dosyalar bulunur, sonra main'deki ve daldaki her test dosyasında `it(...)` blokları adıyla
eşlendi. Bir blok, `describe`'ının kapanışına kadar sayıldı; boşluk farkı yok sayıldı. Aşağıdaki "ne değişti" sütunu
blokların satır satır farkıdır. Tarih: 2026-10-07, dal `office-economy`.

## Silinen

**Yok.** Dalın geçmişinde bir test silinmişti, geri getirildi:

| Dosya | Test | Ne oldu | Şimdi |
|---|---|---|---|
| `apps/office-server/test/dispatcher.test.ts` | reminds the coordinator once a day to report when something happened | 3b98d38'de silindi (rapor hatırlatması özete taşınırken) | **Main'deki metniyle birebir geri geldi.** Anahtarlar kapalıyken (varsayılan) eski hatırlatma kodu çalışıyor ve test main'deki gibi geçiyor. Özet açıkken yeni davranışı ayrı testler sınıyor: "the daily report reminder comes with the last digest hour…", "…not repeated for the same digest hour after a restart". |

## Beklentisi değişen (main'de olan testler)

Hiçbir beklenti gevşemedi: değişiklikler ya ekleme ya imza/fixture uyumu.

| Dosya | Test | Ne değişti | Neden |
|---|---|---|---|
| `office-server/test/dispatcher.test.ts` | a sleeping coordinator wakes for its notices; a sleeping member waits for real work | `notices.add(ada.id, 'Bilgi: toplantı yok.')` → `notices.add(ada.id, 'proposal.decided', 'Bilgi: toplantı yok.')`; metin ve beklenti main'deki gibi | `add` artık konu istiyor. Konu bir karar notu: karar notu bile üyeyi uyandırmıyor, main'den sıkı. (Dalda bir ara bilgi notuyla zayıflatılmıştı, geri alındı.) |
| `office-server/test/company.test.ts` | review focus: a pass chain deeper than the limit is refused and the coordinator is told | `some(n => n.text.includes('zincir'))` → aynı not `toMatchObject({ kind: 'decision', topic: 'limit.chain' })` | Daha sıkı: notun türü de sınanıyor (inceleme 1, bulgu 1) |
| `office-server/test/company.test.ts` | review focus: more than the daily limit from one employee is refused | + koordinatör işe alınıyor; + koordinatörün notu `decision`, konu `limit.tasks_per_day` | Ekleme (inceleme 1, bulgu 1) |
| `office-server/test/company-store.test.ts` | keeps notices until they are delivered | `add(id, metin)` → `add(id, konu, metin)`; + tür, konu ve `createdAt` beklentisi | İmza (not türleri); metin beklentisi aynı |
| `office-server/test/db.test.ts` | applies every migration up · round-trips up → down → up · is a no-op when run twice in either direction | `toBe(5)` → `toBe(7)` | Göç 6 ve 7 eklendi |
| `office-server/test/db.test.ts` | v5 adds proposals and the approved snapshot of plans… | `migrateUp(db)` → `migrateUp(db, upTo(5))` | Test 5'e kadar göçü sınıyor; "hepsi" artık 7'ye gidiyor. Beklenti aynı. |
| `office-server/test/budget.test.ts` | starts from the defaults and takes the owner's changes | + özet saatleri, model haritaları, kapatma anahtarları | Ekleme (yeni anayasa alanları) |
| `office-server/test/budget.test.ts` | review focus: refuses wrong types, out-of-range values and unknown keys, changing nothing | Reddedilen girdi listesine yeni alanlar | Ekleme |
| `office-server/test/quota.test.ts` | sums usage per employee for today and in total, including side answers | + `turns`/`sideAnswers` beklentileri; boş kullanım nesnesinde iki alan | Ekleme (tur sayacı) |
| `office-server/test/api.test.ts` | hires, lists and messages an employee, then returns its events | + `today.turns`, `sideAnswers` | Ekleme (tur sayacı, snapshot) |
| `office-web/src/store/reducers.test.ts` | follows lifecycle, tools, turns and session start | + `turns`/`sideAnswers` | Ekleme |
| `office-web/src/ui/BudgetTabs.test.tsx` | shows the reserve, the month against the cap… | + ekip satırında "7 tur" | Ekleme |
| `office-web/src/ui/BudgetTabs.test.tsx` | saves the owner's limits, an empty money cap meaning none | + özet saatleri, model haritaları, kapatma kutucuğu (varsayılan kapalı → açılıyor) | Ekleme (R9) |
| `office-web/src/ui/BudgetTabs.test.tsx` | important: refuses a money cap that is not a number… | + özet saati ve model haritası hataları | Ekleme |
| `office-web/src/ui/CompanyView.test.tsx` | puts tasks in columns by state and filters them by person | Bir görevde `difficulty: 'hard'`; + "zor" etiketi | Ekleme |
| `office-web/src/ui/PlanCard.test.tsx` | shows what an approved plan has spent next to its money | Fixture anayasasına yeni alanlar | Tip; beklenti aynı |
| `office-web/src/ui/format.test.ts` | formats tokens, cost and percent compactly | Fixture'a `turns`, `sideAnswers` | Tip; beklenti aynı |

## Dalda değiştirilen kendi testleri (main'de yoktu; bu turda)

| Test | Değişiklik | Neden |
|---|---|---|
| dispatcher › "information never wakes a sleeper…; a decision wakes anyone, a member too" | Yerine: "R10: notices never wake a member, a decision wakes the coordinator…" | R10b: main'in kuralı. Üyeyi not uyandırmaz, koordinatör ve lider uyanır. |
| dispatcher › "in the reserve a decision wakes only the coordinator…; a taken task wakes no one" | Adı "a sleeping member waits for their notices, in the reserve too; urgent work still wakes them" oldu; beklentiler aynı (hepsi üye üzerine) | R10b: main'in kuralı, payda da aynı (main'de payda lider de notla uyanır). İnceleme 1'in 6. bulgusundaki "payda lider uyanmaz" kuralı kaldırıldı. |
| dispatcher › "R7: with difficulty models switched off…" | Beklenti: görev metninde "Zorluk" satırı yok | R10c: kapalıyken mesaj main'le aynı |
| engine-model › "cannot start on the new model…" | `error` metni yerine `model.switch.failed` olayı | R13 |
| company-api › "the owner's message … goes on the owner model" | Yerine: "R11: the owner's message does not move a sonnet coordinator to fable…" | R11 |
| economy.scenario › tek koşu | İki koşu: "R10: every switch off…" (main'in golden'ı) ve "the economy on…" | R10a |

## Eklenen

44 yeni test (silinen 0, değişen 19). Hangi gereksinimi sınadıkları kabul belgesinin izlenebilirlik matrisinde:
[economy-acceptance.md](economy-acceptance.md).
