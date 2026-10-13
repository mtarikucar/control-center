# control-center — Ofis odaları (alt proje 2: 3D) tasarım notu

- Tarih: 2026-10-13 · Sahibinin kararlarıyla (departmanlar spec'i Ek B), sahibinin "soru sorma, devam et" talimatıyla
  açık kalanlar burada karara bağlandı (§9).
- Dal `feat/departments` (alt proje 1'in üstünde, aynı dal). Yeni göç **yok**: odanın numarası alt proje 1'in henüz
  yayınlanmamış v24 göçüne `departments.room` sütunu olarak eklenir (§4.1).
- Dayandığı: `2026-10-13-departments-design.md` (Ek B), bugünkü 3D ofis (`apps/office-web/src/office/layout.ts`,
  `scene/*`), sunucunun masa modeli (`roster.ts`, `config.ts deskCount`, `budget.ts maxEmployees`).

## 1. Bugün ve kapsam

Ofis 18 × 14 m'lik elle çizilmiş tek bir kat: dörderli iki masa kümesi (8 masa), toplantı odası, sunucu odası, kahve
köşesi, lounge, resepsiyon. Sunucu en çok 8 masa verir (`deskCount: 8`), Anayasa en çok 8 çalışan der. Çalışan
`deskIndex`'e göre oturur; boşta gezerken kahveye ya da lounge'a gider. Departmanlar (alt proje 1) yalnız veri olarak
var; 3D ofiste görünmezler.

**Bu iş:**
- **Yeni kat planı:** ortada **merkez** (koordinatörün masası ve üstünde ışık hüzmesi, toplantı masası, kahve,
  lounge, sunucu köşesi, merkez masaları), kuzeyde ve güneyde üçer **departman odası** (6 oda).
- **Oda:** cam bölmeli, kapısı merkeze bakar, kapısının üstünde **tabela** (departmanın adı ya da "Boş oda"),
  6 masalık bir küme. Boş oda **karanlık**: halısı koyu, lambaları sönük, ekranlar kapalı.
- **Işık hüzmesi:** merkezde, koordinatörün masasına inen bir ışık konisi; koordinatör çalışırken nabız gibi
  parlar, boştayken sakin, uyurken sönük.
- **Masa modeli "oda + koltuk":** 45 koltuk (koordinatör 1, oda başına 6 × 6 = 36, merkez 8). Departman üyesi kendi
  odasına oturur; oda doluysa merkezdeki bir masaya; departmansızlar merkeze. Departman değişince kişi yeni yerine
  yürür.
- **Sınırlar:** `deskCount` 45; Anayasa'daki çalışan sınırının varsayılanı 8 → **12** (en çok 45).

**Kapsam dışı:** 2D görünüm; yeni 3B model üretimi (eksik model yerine bugünkü kutu/figür düşüşü kullanılır); oda
içi mobilyanın departmana göre değişmesi; oda başına farklı yerleşim.

## 2. Kat planı

Ölçüler metre; x doğuya, z güneye; kamera güneydoğudan bakar (kuzey ve batı duvarları tam boy, güney ve doğu alçak —
bugünkü kuralla aynı).

```
 z=0  ┌──────────┬──────────┬──────────┐   kuzey dış duvar (tam boy)
      │  Oda 0   │  Oda 1   │  Oda 2   │   kuzey odaları: z 0–7
      │  6 masa  │  6 masa  │  6 masa  │   kapılar güney cam duvarda (merkeze)
 z=7  ├──[kapı]──┴──[kapı]──┴──[kapı]──┤
      │ kahve      toplantı            │
      │ köşesi      masası     lounge  │   merkez: z 7–17
      │      merkez   ☼ koordinatör    │   ☼ ışık hüzmesi (x 16, z 12)
      │ sunucu       masaları          │
 z=17 ├──[kapı]──┬──[kapı]──┬──[kapı]──┤
      │  Oda 3   │  Oda 4   │  Oda 5   │   güney odaları: z 17–24
      │  6 masa  │  6 masa  │  6 masa  │   kapılar kuzey cam duvarda (merkeze)
 z=24 └──────────┴──────────┴──────────┘   güney dış duvar (alçak)
      x=0       x=10.7     x=21.3     x=32
```

- Kat **32 × 24 m**, hücre 0,5 m.
- **Odalar:** her biri yaklaşık 10,7 × 7 m. Odaları ayıran duvarlar ve merkeze bakan duvarlar **cam**; kapı 1,4 m
  (bugünkü 1,2 m kapılardan geniş, iki odalı yürüyüş için). Dış duvarlar bugünkü kurala göre.
- **Masa kümesi:** 3 sütun × 2 sıra sırt sırta, bugünkü `cluster()` gibi (masa 1,4 × 0,75; sandalye arkada).
- **Merkez:** koordinatörün masası ortada ve ışık hüzmesinin altında; toplantı masası (6 koltuk) kuzeyinde; kahve
  köşesi batıda; lounge doğuda; sunucu köşesi güneybatıda; 8 merkez masası iki sıra halinde koordinatörün iki yanında.
- **Gezinme noktaları:** kahve 12, lounge 12, sunucu 12, toplantı 6. Bugünkü gibi koltuk numarasından seçilir; 24
  kişiye kadar iki kişi aynı noktaya düşmez.
- **Kapı ve yol:** her odanın her koltuğundan merkezdeki her noktaya yol olmalı (bugünkü A* ızgarası değişmeden
  kullanılır).

## 3. Koltuklar

Koltuk numarası `deskIndex` olarak kalır (sütun ve tipler değişmez), anlamı değişir:

| Koltuk | Yer |
|---|---|
| 0 | koordinatörün masası (merkez, ışık hüzmesinin altı) |
| 1 + 6·r … 6 + 6·r | oda r'nin altı masası (r = 0…5) |
| 37 … 44 | merkez masaları |

**Kim nereye oturur** (`seatFor`, saf işlev, sunucuda):
1. Koordinatör → 0.
2. Bir departmanın üyesi ve departmanın bir odası var → o odanın ilk boş koltuğu; oda doluysa ilk boş merkez masası
   (departmanda kişi sınırı yok).
3. Departmansız (merkez) → ilk boş merkez masası.
4. Hiçbiri yoksa → hiçbir açık departmanın tutmadığı odaların koltukları, en yüksek numaralı oda önce (yeni departman
   en küçük boş odayı alır); sonra öteki departmanların odaları; koordinatörün masası (0) en son. Hiç boş koltuk
   yoksa işe alım bugünkü "Ofis dolu" hatasını verir.

Bir kişi bulunduğu yerde kalabiliyorsa yerinden kaldırılmaz (oda değişmediyse koltuk değişmez).

**Ne zaman:** işe alımda; departmana girip çıkınca, başkan olunca/bitince, departman kapanınca; koordinatörlük
değişince; ofis her açıldığında bir kez herkes için (`reseatAll`, idempotent — bugünkü 8 masadan yeni koltuklara geçiş
budur). Bir departman oda alınca, kapanınca, biri departmandan çıkınca, başka departmandan başkan olunca ya da işten
çıkarılınca da herkes için `reseatAll`: boşalan koltuğu bekleyen oturur, departmanın aldığı odada oturan merkezliler
çıkar.

## 4. Odalar

### 4.1 Departmanın odası

`Department.room: number | null` (0–5). Departman açılınca **en küçük boş oda** verilir; kapanınca oda boşalır
(`null`). Benimseme (`adoptTeams`) de aynı kuralla oda verir. 6 departman sınırı zaten 6 odaya denk. Boşalan oda
(kapanış) ve her açılışta `adoptTeams`'in başında, odası olmayan en önce açılmış açık departmana verilir (en küçük boş
oda); `department.changed` `updated` gider ve o departmanın kişileri odaya yürür (`DepartmentStore.setRoom`).

Sütun alt proje 1'in yayınlanmamış v24 göçüne eklenir: `departments.room INTEGER` (yeni göç açılmaz; v24'ün down'ı
tabloyu zaten kaldırır). `DepartmentStore` yazar ve okur.

### 4.2 Görünüş

- **Dolu oda:** halı departmanın rengi (6 rengin biri, oda numarasına göre), lambalar yanık, ekranlar açık, kapı
  tabelasında departmanın adı ve başkanın adı.
- **Boş oda:** halı koyu gri, oda lambaları sönük, masalarda ekran kapalı, tabelada "Boş oda".
- **Ortak oda:** departmanı yok ama içinde merkezden oturan biri var: halı koyu gri, lambası yanık, oturulan masaların
  ekranı açık, tabelada "Ortak oda".
- **Oda etiketi:** tabela varsayılan yakınlıkta okunmaz (≈ 31 × 10 px), bu yüzden departmanın odasının zemininde,
  kameraya bakan (güney) kenarında — kuzey odalarda merkeze bakan camın, güney odalarda alçak dış duvarın yanında;
  odadakilerin etiketleri yukarı, kuzeye doğru düştüğü için orası boş kalır — piksel boyutlu bir etiket (drei `<Html>`)
  odanın rengini ve departmanın adını gösterir; tıklama ve sürüklemeyi almaz, çalışanların etiketlerinin altında kalır.
- **Tabela:** kapının üstünde, merkeze bakan, çift yüzlü düzlem; metin bir `<canvas>`'ta çizilip doku olur (ağdan
  yazı tipi indirmez; ofis yerel çalışır).

### 4.3 Işık hüzmesi

Koordinatörün masasının üstünde, tavandan (y ≈ 6) masaya inen yarı saydam bir koni (eklemeli harmanlama, derinlik
yazmaz) ve aynı yere bakan bir spot ışığı. Parlaklık koordinatörün durumuna göre:

| Durum | Hüzme |
|---|---|
| çalışıyor (`working`) | parlak, yavaş nabız (yaklaşık 2,5 sn) |
| boşta (`idle`, `starting`) | sakin, sabit |
| uyuyor, durdu, sınırda, hata | sönük |
| koordinatör yok | hüzme yok |

Mevcut Bloom efekti (eşik 0,92) hüzmenin parlak kısmını hafifçe parlatır; ek son işlem yok.

## 5. Sunucu değişiklikleri

- `config.ts`: `deskCount` → `SEAT_COUNT` (45, `@cc/shared` içinde, web ile ortak).
- `Roster.create` isteğe bağlı `deskIndex` alır (boş ve aralıkta olmalı); verilmezse bugünkü gibi en küçük boş.
  Yeni: `Roster.setDesk(id, deskIndex)`.
- `seating.ts`: `seatFor` ve `reseat(employeeId)`, `reseatAll()`; `Company.hire`, `appointCoordinator` ve
  `Departments` (move, setHead, close, adoptTeams, create-with-head) koltuk değişince çağırır. Koltuk değişen kişi
  için olay: mevcut `role.changed` zaten web'de anlık görüntüyü yeniler; yalnız koltuğu değişen (rolü değişmeyen) kişi
  için yeni olay `seat.changed { deskIndex }`.
- Anayasa: `DEFAULT_CONSTITUTION.maxEmployees` 8 → 12; doğrulama üst sınırı masa sayısı (45). Sahibinin kayıtlı bir
  değeri varsa o kalır.
- `Department` JSON'una `room` eklenir (anlık görüntü ve olaylar).

## 6. Web değişiklikleri

- `office/layout.ts`: yeni kat planı (§2); `Layout`'a `rooms: RoomGeometry[]` (oda dikdörtgeni, kapısı, tabelasının
  yeri, koltuk numaraları, halı rengi) ve `beam: { x, z }` eklenir. Koltuk listesi 45, gezinme listeleri §2'deki
  sayılarda.
- `scene/RoomsLayer.tsx` (yeni): oda halıları (dolu/boş), tabelalar, boş odanın sönük lambaları ve kapalı ekranları
  için `DeskDressing` ve `FurnitureLayer`'a "bu oda boş" bilgisi.
- `scene/Beam.tsx` (yeni): ışık hüzmesi, koordinatörün yaşam döngüsüne bağlı.
- `scene/camera.ts` / `OfficeScene.tsx`: kat büyüdü; başlangıç yakınlığı ve kaydırma sınırları katın boyutundan
  hesaplanır (bugün elle 18 × 14'e göre).
- `scene/Lighting.tsx`: güneşin gölge kutusu katın boyutundan.
- `Room.tsx`'in duvar yüzü kuralı (`frameOf`, katın ortasına göre "iç" yüz) odaların kendi duvarlarına da doğru
  çalışmalı: bir bölme duvarının iç yüzü odanın merkezine göre seçilir.
- Mevcut testlerin eski kat planını sabitleyenleri (koltuk sayısı 8, boyut 18 × 14, sunucu kapısı, `spotFor`
  eşlemeleri) yeni plana göre yeniden yazılır; kalanlar aynen kalır.

## 7. Uyumluluk

- Sütun ve API değişmez (`deskIndex` aynı alan); eski bir istemci yeni koltuk numarasıyla bilinmeyen bir masaya
  düşerse `spotFor`'un mod kuralıyla bir yere oturur (bugünkü davranış).
- Departmansız bir ofis (alt proje 1 öncesi gibi) merkezde çalışır: herkes merkez masalarında, odalar boş ve karanlık;
  merkezin sekiz masası dolunca dokuzuncu ve sonrası hiçbir departmanın tutmadığı en yüksek numaralı odaya (oda 5'ten
  başlayarak), o da yoksa öteki odalara oturur ve oturdukları oda "Ortak oda" olarak aydınlanır.

## 8. Doğrulama

- **Sunucu (birim):** `seatFor` kuralları (koordinatör, oda, oda dolu, merkez, ofis dolu, yerinde kalma); oda
  verme/boşaltma (en küçük boş oda, kapanınca boşalır, benimsemede); `reseatAll` idempotent ve eski 8 masalık
  veritabanını yeni koltuklara taşıyor; `Roster.create(deskIndex)` doğrulaması; `maxEmployees` varsayılanı ve üst
  sınırı; v24 göç testi `room` sütunuyla.
- **Web (birim):** kat planı: 45 koltuk, her koltuk serbest hücrede, her koltuktan her gezinme noktasına ve toplantıya
  yol, oda koltukları oda dikdörtgeninde, kapılar geçilebilir, 24 kişiye kadar ortak nokta yok; `spotFor`'un yeni
  eşlemeleri; oda durumu (dolu/boş) ve tabela metni seçimi (saf işlev); hüzmenin parlaklık seçimi (saf işlev).
- **Görsel:** ofis bir tarayıcıda açılıp ekran görüntüsü alınır (kahve, oda, hüzme, tabela görünür; boş oda karanlık).
  Bu, yayın öncesi el ile kontrol; otomatik test değil.

## 9. Açık kalanların kararları (sahibi soru istemedi)

- **Işık hüzmesinin anlamı:** yalnız görsel değil, koordinatörün durumunu gösterir (§4.3); başka bir odaya uzanmaz
  (koordinatörün konuştuğu kişiyi göstermek, mesaj akışını izlemeyi gerektirir; sonraki iş).
- **`assets/2d/`:** sahibinin 3B model üretimi için referans görselleri (Meshy girdisi; `palette.ts` renkleri genel
  bakış görselinden alır). Bu işle ilgisi yok; dokunulmaz.
- **Oda kapasitesi:** fiziksel 6 masa; departmanda kişi sınırı yok — 7. kişi merkez masasına oturur.
- **Çalışan sınırı:** varsayılan 12 (yeni başkanlar alınabilsin); sahibi Anayasa'dan değiştirir, en çok 45.
