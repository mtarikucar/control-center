# Ekonomi tabanı — main, 2026-10-07

Plan "Ofis ekonomisi"nin ilk ölçümü: davranış değiştirmeden önce aynı senaryonun main üzerindeki sayıları.

**Nasıl ölçüldü.** main @ `e2889e8` ürün kodu, geçici bir detached worktree'de. Senaryo testi
(`apps/office-server/test/economy.scenario.test.ts`) ve test ikizi `test/fake-claude.mjs` (HOLD turları, `--model` bildirimi)
office-economy dalından oraya kopyalandı; main'e commit yok, worktree silindi. Üç koşu birebir aynı tabloyu verdi; office-economy
dalında (tur sayacıyla) aynı tablo bayt bayt çıktı: davranış henüz değişmedi. Senaryo ve sayım yöntemi:
[economy-measure.md](economy-measure.md).

Senaryo: 1 koordinatör (fable) + 2 üye (Ada, Can; sonnet), 1 onaylı plan, 10 görev (beşer). Ada'nın her işi 50 dk, Can'ınki 47 dk.
Can ikinci işinin 20. dakikasında takılır, koordinatör işi Ada'ya verir. Ada üçüncü işinin 20. dakikasında bir fikir açar,
koordinatör kabul eder. Ertesi sabah günlük rapor hatırlatması gelir, koordinatör raporlar. Herkes işini teslim eder (hatırlatma
ya da tırmandırma yok); kimse askColleague kullanmaz.

Bu tablolar ve aynı günün main'de kaydedilmiş mesaj/olay günlüğü (`2026-10-07-economy-baseline.log.json`) senaryo
testinin **golden**'ıdır. Dal, anahtarlar kapalıyken bunları birebir üretmek zorunda (R10, `economy.scenario.test.ts`).
Tabloyu değiştirmeden önce main'de yeniden ölç.

## Taban (main, 2026-10-07)

| Çalışan | Rol | Model | Tur | Oturum | Ağırlık | Modellenmiş maliyet |
|---|---|---|---:|---:|---:|---:|
| Koordinatör | koordinatör | fable | 14 | 8 | 15 | 210 |
| Ada | üye | sonnet | 6 | 1 | 1 | 6 |
| Can | üye | sonnet | 5 | 1 | 1 | 5 |
| **Toplam** | | | **25** | | | **221** |

- Koordinatör turların %56'sı (14/25), modellenmiş maliyetin **%95**'i (210/221).
- Üyeler iş başına tam bir tur harcıyor (Ada 5 + devralınan 1, Can 5); kendilerine gelen notlar ("görev başkasına verildi",
  "önerin kabul edildi") bir sonraki görevle aynı mesajda geliyor, ayrı tur açmıyor.
- Ağırlıklar kaba: fable 15, opus 5, sonnet 1, haiku 0.2; bağlam boyutunu ve önbelleği yok sayar, her tur aynı sayılır.

## Koordinatöre ayrı tur açan olaylar

Beklenti doğrulandı: her teslim, takılma, öneri ve rapor hatırlatması koordinatöre **ayrı bir tur** açıyor. Notlar yalnız aynı anda
gelirse birleşiyor (burada yalnız son teslim ile "planın açık görevi kalmadı" notu).

| Olay | Koordinatör turu | Not metni |
|---|---:|---|
| Plan onayı | 1 | `Plan onaylandı: …` (görevleri açar) |
| Görev teslimi | 10 | `Görev bitti: “…” (Ada): …` — her teslim tek başına bir fable turu |
| Takılma | 1 | `Can “…” görevinde takıldı: …` |
| Öneri (fikir) | 1 | `Ada bir fikir açtı: … proposalDecide ile karara bağla` |
| Plan bitti | 0 (son teslimle aynı tur) | `“…” planının açık görevi kalmadı …` — tek başına gelse ayrı tur olurdu |
| Günlük rapor hatırlatması | 1 | `Günlük özet zamanı: …` (ertesi sabah) |
| **Toplam** | **14** | |

Zaman çizelgesi (simüle saat):

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

Senaryoda bulunmayan ama aynı yoldan koordinatöre tur açan notlar: hatırlatmaya rağmen teslim edilmeyen iş (dispatcher
tırmandırması), kota payının devreye girmesi/çıkması, aylık sınır ya da plan bütçesi aşımı (recordSpend), zincir/günlük görev
sınırı, sahibinin plan ve öneri kararları, işten çıkarılanın devri.

## Gözlemler (sonraki görevler için)

1. **En büyük kalem teslim bildirimleri:** 10 fable turu = 150 / 221 (%68). Teslimleri toplu almak ya da bu turları ucuz modelde
   çalıştırmak en çok kazandıracak yer. Kaba örnek (ölçüm değil): teslimler ve rapor hatırlatması sonnet'te, plan/takılma/öneri
   fable'da olsaydı 3×15 + 11×1 + 11 = 67 (−%70).
2. **Koordinatör gün içinde 7 kez uyanıyor (8 oturum).** Boşta uyuma 30 dk; iki olay arası ≥30 dk olunca koordinatör uyuyor, bir
   sonraki notla uyanıp oturumu yeniden açıyor. Tur ağırlığı bunu görmez, ama gerçekte her uyanış soğuk başlangıç (bağlam
   önbelleksiz yeniden okunur; fable'da pahalı). Öte yandan bu sınırlar modeli ek maliyetsiz değiştirmenin doğal anları: bu
   senaryoda günde 7 tane.
3. Takılan üye hatırlatma almıyor (takılı görev `in_progress` sayılmıyor) ve sıradaki işine geçiyor; takılma koordinatöre yalnız
   bir tur ekliyor, devralma bir üye turu.
4. Ölçümün sınırları: sahte claude anında ve sabit tokenla cevaplar (token/USD burada anlamsız, yalnız tur sayılır); sahibinin
   mesajları, askColleague (yan cevaplar) ve teslim etmeyen üyeler (hatırlatma + tırmandırma turları) senaryoda yok.

## Yöntem

- Belirlenimci ayrık olay simülasyonu: dispatcher'ın `now` ve `defer`'i testin; saat bir olaydan ötekine atlar, her olaydan sonra
  ofis durulana kadar çalışır. Mesai boyunca 5 simüle dakikada bir tarama (üretimde tik 60 sn); günlük rapor hatırlatması gerçek
  tikle (`tickMs` 25) gelir.
- Üyenin işi tek uzun tur: sahte claude HOLD içeren turu test bırakana dek açık tutar; test teslimi (taskFinish yerine
  `company.finish`) simüle saatinde yapıp turu bırakır. Koordinatörün araç çağrıları (createTask, assign, proposalDecide,
  reportToOwner) aldığı nota göre test tarafından oynanır.
- Sayım olay günlüğünden: tur = `turn.finished`; model = turun oturumunun `session.started`'da bildirdiği model, yoksa kadrodaki;
  oturum = `session.started` sayısı. Test ayrıca her sistem mesajının tam bir tur açtığını doğrular.

## Sonra: not türleri ve sunucu özeti (office-economy)

Aynı senaryo, bilgi notları ayrı tur açmadan (karar turuna biner ya da özet saatinde tek tur; rapor hatırlatması 17:00
özetinde). Önce/sonra aynı test kodu, aynı simüle saatle ölçüldü (önce = `e9cfd86`, geçici worktree):

| | Koordinatör turu | Koordinatör oturumu | Üye turları | Modellenmiş maliyet |
|---|---:|---:|---:|---:|
| Önce (taban) | 14 | 8 | 6 + 5 | 221 |
| Sonra | **4** | 4 | 6 + 5 | **71** (−%68) |

Koordinatör turları: 09:00 plan onayı · 10:07 takılma (+ özet: 2 teslim) · 11:00 öneri (+ özet: 2 teslim) · 17:00 özet
(6 teslim, plan bitti) + rapor hatırlatması. Senaryo testinin eşiği: koordinatör turu ≤ 5. Güncel tablo:
[economy-measure.md](economy-measure.md).

