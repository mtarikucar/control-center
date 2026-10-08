# control-center — Yetenek ön-kontrolü (B8) tasarım notu

- Tarih: 2026-10-08 · Yazan: Mert · Görev: f8c12de9 (plan "Çekirdek 4", B8) · İnceleyen: Kerem
- Dayandığı:
  - `bosluk-analizi.md` §3 "B8 — Yetenek ön-kontrolü yok";
  - `hedef-mimari.md` §4 D3 (önden eşleme: eksikse `blocked` + sahibine `need`; sonradan tespit: bağlayıcı aracının
    `isError`'ı yeteneğe bağlanır);
  - B7 (`coverage`, `toolClass`, `tasks.requires`) ve B3 (kayıt).
- Dal `feat/capability-precheck`, `integration/core-3` (onaylı, 8690f13) üstünde. **Göç yok** (v23 kullanılmadı, §6).

## 1. Bugün ve kapsam

B7 ile görev yetenek ister (`tasks.requires`) ve her masanın o yeteneğe sahip olup olmadığı okunur (`coverage`). Ama
eksik yetenek işi durdurmaz: görev dağıtılır, çalışan tur ortasında araç hatası alır, kendi başına çözüm arar ya da
takılır (canlıda 9 hatalı araç sonucu).

Bu iş, **varsayılan kapalı** bir anayasa anahtarıyla (`capabilityPrecheckEnabled`) şunları yapar:
1. **Önden:** görev dağıtılmadan önce, istediği bir yetenek atananın masasında açık değilse görev bloklanır. Sahibine
   o yetenek için tek bir `need` önerisi düşer.
2. **Geri bırakma:** yetenek açılınca bloklanan görev kendiliğinden sıraya döner.
3. **Sonradan:** bir bağlayıcı aracı hata verirse araç yeteneğe bağlanır ve aynı öneri bir kez açılır.

**Kapsam dışı:**
- Görev açılırken reddetmek. `taskCreate`, `taskPass` ve `taskAssign` cevapları eksik yeteneği zaten söylüyor (B7).
  Engel dağıtım anındadır; atama değişirse yeni atananın masası denetlenir.
- Rol yeteneklerine göre işe almayı engellemek (B5 kartı gösteriyor).
- Kapıyı (rolde olmayan dışa dönük aracı kapatmak) B9 yapar.

## 2. Kural

**Ne bloklar:** yalnız `coverage` durumu `shut` (masada var, açık değil) ya da `missing` (yok) olan yetenekler.
- `open` ve `manual` (elle kayıtlı adaptör/CLI, doğrulanamaz) bloklamaz.
- `unseen` bloklamaz: masanın henüz oturumu yok. Masalar sahibinin ayarlarını devralır, bağlayıcı büyük olasılıkla
  gelir. İlk oturumdan sonra bir sonraki dağıtım yeniden denetler. Masanın oturumu hiç yoksa ilk görev oturumu açar.
- Görev yetenek istemiyorsa (`requires` boş) hiçbir şey değişmez.

**Ne zaman:** dağıtıcı bir çalışana sıradaki görevi verirken (`#consider`, `nextFor` sonrası). Bloklanan görev
`waiting`'den `blocked`'a geçer ve sıradaki görev denenir. Notu `Yetenek ön-kontrolü:` ile başlar: hangi yetenek,
hangi durumda, "yetenek açılınca görev kendiliğinden sıraya döner". Koordinatöre `task.blocked` notu gider.

**Geri bırakma:** dağıtıcının her taramasında (saat ya da olay) bu notla bloklanmış görevler yeniden denetlenir:
- yetenekleri artık bloklamıyorsa görev `waiting`'e döner, not silinir;
- anahtar kapatıldıysa hepsi `waiting`'e döner (davranış eskisine döner).

Bloğu ön-kontrol koyduğu için onu yalnız ön-kontrol kaldırır. Koordinatör görevi `taskAssign` ile başka birine
verirse `waiting` olur ve yeni masa denetlenir.

## 3. Sahibine öneri

Önerinin biçimi:
- Başlık: `Yetki gerekiyor: <yetenek> (<ad>)`.
- Açan: koordinatör. Koordinatörün önerisi doğrudan sahibine gider (`status: owner`). Koordinatör yoksa atanan açar;
  karar veren olmadığı için o da sahibine gider.
- Metin:
  - neden: hangi görev, kimin masası ya da hangi araç hata verdi;
  - hangi bağlantılar sağlıyor ve bu masada durumları (yetki bekliyor, masa ayarı, hata, kayıtta kapalı; B3);
  - ne yapılmalı: yetkilendir, masa ayarını bilinçli kaldır, bağla ya da integrationRegister ile kaydet;
  - B3'teki yetki notu (`authNeeded`) varsa o da.

**Yinelenmez:** aynı yetenek için bekleyen (`open`/`owner`) ya da sahibinin **reddettiği** bir `need` önerisi
varsa yenisi açılmaz. Sahibi hayır dediyse her yeni görevde yeniden sorulmaz; görev bloklu kalır ve koordinatör
başkasına verir ya da iptal eder. Kabul edilmiş bir öneriden sonra yetenek hâlâ eksikse yeni bir görev yeniden
sorabilir. Bu bir hatırlatmadır.

Ayrım öneri başlığıyla yapılır, ek tablo yok. Yeniden başlatmadan sonra da geçerlidir.

## 4. Sonradan tespit

Ön-kontrol olay deposunu dinler. Bir masanın bağlayıcı aracı (`mcp__…`) `tool.finished isError` verirse, aracın
`tool.started` adı `toolClass`'tan geçer:
- **Sınıflandırılmışsa** (bir yeteneğe aitse) aynı kuralla o yetenek için `need` önerisi açılır. Metin aracı ve hata
  metninin başını taşır.
- Sınıflandırılmamış araçta öneri açılmaz: hangi yeteneğe ait olduğu bilinmez, B7 okuması onları zaten gösterir.
- Ofisin kendi araçlarında ve yerleşik araçlarda da öneri açılmaz.

Olay işlenirken yeni olay yazılmasın diye (iç içe yazma yok) iş bir sonraki döngüye ertelenir.

**Sınır:** her `isError` yetki eksikliği değildir (yanlış argüman, geçici hata). Öneri bu yüzden yalnız bir kez
açılır (§3), metninde hata metni bulunur ve kararı sahibi verir. Bu tespit görevi bloklamaz.

## 5. Anahtar

`capabilityPrecheckEnabled`, anayasanın dördüncü açma-kapama anahtarıdır; diğer üçü gibi:
- varsayılan `false`; anahtarı olmayan veritabanında da `false`;
- sahibi Anayasa sekmesindeki kutucukla açar (`POST /api/constitution`).

**Kapalıyken davranış öncekiyle aynıdır:**
- dağıtım bloklamaz;
- `isError` öneri açmaz;
- ön-kontrol olay yazmaz;
- daha önce bloklanmış görevler sıraya döner.

## 6. Göç

Gerekmedi. Blok, görevin mevcut `blocked` durumu ve not öneki; tekrarlamama, öneri başlığı. v23 kullanılmadı; karar
defterindeki sıradaki numara boş kalır.

## 7. Doğrulama

- **Birim (K1):**
  - shut ve missing bloklar; open, manual ve unseen bloklamaz; requires boşken değişiklik yok;
  - tek öneri, bekleyen ve reddedilen tekrarlanmaz, kabul edilenden sonra yeniden;
  - geri bırakma, anahtar kapatılınca geri bırakma;
  - isError: sınıflandırılmış araç → öneri; sınıflandırılmamış, ofis ve yerleşik araç → yok;
  - dağıtıcı: bloklanan görev teslim edilmez, sıradaki gider;
  - anahtar kapalı: her şey eskisi gibi (teslim, öneri yok, olay yok);
  - anayasa anahtarı doğrulaması.
- **Mutasyon kontrolü** (geçici worktree).
- **K4 (kopya):** canlı DB'nin salt okunur kopyasında anahtar açıkken bütün açık görevler denetlenir; hiçbiri yanlış
  bloklanmaz. Geçmiş `isError` olayları bu kuralla kaç öneri açardı, ayrıca listelenir.
- **K3:** gerekmedi. Davranış ofisin kendi kodunda; girdisi olan oturum araç listesi ve kayıt B3/B7'nin K3'lerinde
  kanıtlı.
