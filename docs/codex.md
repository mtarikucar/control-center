# Codex ile ControlCenter

Claude ve Codex aynı ofiste birlikte çalışır. Sağlayıcı her çalışanda saklanır; koordinatörün sağlayıcısı
ekibin sağlayıcılarını sınırlamaz. `pnpm office` karma ofisi açar. `OFFICE_PROVIDER` yalnız yeni çalışan
varsayılanıdır; `pnpm office:codex` bu varsayılanı Codex yapıp ayrı bir veri klasörü açar.

## Kurulum

Node.js 24+, pnpm 9 ve yerel, giriş yapılmış Codex CLI gerekir. Claude çalışanları için giriş yapılmış
Claude CLI da gerekir. `codex --version` ve
`codex login status` ile kontrol et. Bu entegrasyon Codex app-server'ın özel stdio bağlantısını
kullanır; ağda bir Codex portu açmaz. Yerel Codex/ChatGPT hesabının mevcut kimlik doğrulaması
kullanılır, anahtar veya erişim jetonu proje dosyalarına yazılmaz.

```bash
codex login
pnpm install
pnpm office
```

Sonra http://127.0.0.1:4319 adresinde **Şirket → Koordinatörün sağlayıcısı** seçimini yapıp **Koordinatör
işe al**. **Çalışan al → Sağlayıcı** her çalışan için bağımsızdır. Sohbette görevi tarif et;
plan, görevlendirme, paslama, inceleme, kanıtlı teslim, şirket hafızası ve zamanlama ofisin
mevcut araçlarıyla yürür. Anayasa'nın plan onayı ve tam serbest ayarları aynen uygulanır.

Özel sunucu başlatma (PowerShell):

```powershell
$env:OFFICE_PROVIDER = 'codex'
$env:OFFICE_PORT = '4320'
pnpm --filter @cc/office-server start
```

Arayüz daha önce `pnpm --filter @cc/office-web build` ile derlenmiş olmalı.

| Ayar | Varsayılan / anlamı |
| --- | --- |
| `OFFICE_PROVIDER` | Yeni çalışan varsayılanı: `claude` veya `codex`; mevcut çalışanları değiştirmez |
| `OFFICE_CODEX_COMMAND` | `["codex"]`; farklı bir yerel çalıştırıcı için JSON dizisi |
| `OFFICE_CODEX_MODEL` | Verilmezse Codex'in yerel model ayarı / kataloğun varsayılanı |
| `OFFICE_DATA_DIR` | Codex'te `~/.control-center-codex`, Claude'da `~/.control-center` |

Windows'ta `codex` PATH'te bulunmuyorsa `OFFICE_CODEX_COMMAND` içine Codex uygulamasındaki
`codex.exe` yolunu bir JSON dizisi olarak ver. Npm kurulumunda gerekirse `["node", "<codex.js yolu>"]`
biçimini kullan. Komut shell'de birleştirilmez; argümanlar ayrı verilir.

## Oturumlar ve çalışma düzeyleri

Codex seçilen çalışanın bir app-server süreci ve saklanan bir Codex thread'i vardır. Masadaki
`codex-session.json` yalnız thread kimliğini ve model adını tutar; yeniden açılışta `thread/resume`
kullanılır. Mevcut oturum okunamıyorsa sessizce yeni hafıza yaratılmaz, hata raporlanır.
Görev sırasında gelen mesaj `turn/start` aracılığıyla devam eden tura yönlendirilir. **Durdur**
`turn/interrupt` gönderir; **Devam** aynı thread'i yeniden açar. **Terminalde aç** yerel shell için
`codex resume` komutu verir. Yan sorular, asıl thread'i değiştirmeyen ayrı bir geçici kopyada,
salt okuma izinleriyle yanıtlanır; dosya ve komut değişikliği onayları reddedilir.

Veritabanının mevcut model anahtarları korunur; Codex arayüzünde çalışma düzeyi olarak gösterilir:

| Anahtar | Çalışma düzeyi | Codex düşünme düzeyi |
| --- | --- | --- |
| `haiku` | Düşük | `low` |
| `sonnet` | Dengeli | `medium` |
| `opus` | Yüksek | `high` |
| `fable` | En yüksek ofis düzeyi | `xhigh` |

Model bir düzeyi desteklemiyorsa kataloğun varsayılan düzeyi kullanılır; gerçek değer oturum
kaydında görünür. Bu dört anahtar Codex modunda Claude modellerini başlatmaz. Koordinatörün tur
türü ve görevin zorluğu aynı ofis politikası üzerinden düzeyi seçer.

Rol kartı `CLAUDE.md` ve ofis rehberinin birleşimi, Codex'in okuyacağı `AGENTS.md` dosyasına
dönüştürülür. `AGENTS.md` yönetilen bir kopyadır; rolü ofis arayüzünden veya rol kartından değiştir.
Veritabanı göçü v23 mevcut çalışanları Claude olarak korur; eski Claude oturum kimlikleri değişmez.
`employees.provider` çalışanın sağlayıcısını, `provider_sessions` her sağlayıcının oturumu açılıp açılmadığını
tutar. Aynı şirket/veri klasöründe iki sağlayıcı kullanılabilir.

## Yerleşik Imagegen

Codex çalışanları kendi oturumlarının yerleşik `image_gen` / `imagegen` aracını kullanabilir.
Ofis normal çalışan oturumlarında `features.image_generation` özelliğini açar; yalnız okuma amaçlı
yan soru kopyalarında kapatır. Bu, kişisel MCP bağlantılarından ayrı bir Codex yeteneğidir ve
ana Codex sohbetinden görsel kopyalanmasını gerektirmez. Hesabın ve kurulu Codex sürümünün desteği gerekir;
gerçek üretim hataları ofis akışında gösterilir. API anahtarı ya da başka servise otomatik geçiş yapılmaz.

Çalışandan fotoğraf istediğinde rolünde görsel üretimini yasaklayan eski bir talimat olmadığından emin ol.
Koordinatör bu rolü `editRoleCard` ile değiştirebilir. Çalışan üretilen dosyanın gerçek yolunu
`taskFinish.outputs` listesine ekler; mevcut teslim arşivi dosyayı saklar. Native `imageGeneration`
olayında `savedPath` geldiğinde ofis sohbetinde önizleme ve indirme bağlantısı görünür. Görselin base64
içeriği olay günlüğüne yazılmaz; yerel dosya yolu bildirmeyen sürümlerde metin durumu gösterilir.
Önizleme yalnız kayda geçmiş PNG/JPEG/WebP çıktıları için sunulur.

Kontrol edilen resmi kaynak: [Codex görsel üretimi](https://learn.chatgpt.com/docs/image-generation).
Codex oturumunun modeli ve yerleşik araçları kullanılabilir; masaüstü uygulamasının bütün bağlantıları
ve arayüz özellikleri ControlCenter'a kendiliğinden aktarılmış sayılmaz.

## Karma ekip ve koordinatörü değiştirmek

Claude koordinatör `hire(provider: "codex", ...)` ile Codex çalışanı alabilir; Codex koordinatör de
`provider: "claude"` seçebilir. `officeStatus` sağlayıcıları gösterir. `taskCreate`, `taskAssign`, `taskPass`,
`taskFinish` ve `reviewDecide` sağlayıcıdan bağımsızdır. Blueprint rolünde de `provider` verilebilir.

Sahibi, çalışan veya koordinatör panelinden sağlayıcıyı değiştirebilir. Çalışan boşta olmalı ya da önce
**Durdur** kullanılmalı; süren iş/arka plan süreci ve terminal devri sırasında değişiklik reddedilir.
Görev sahipliği, rol, dosyalar, teslimler ve şirket hafızası korunur. Son 20 sohbet mesajının sınırlı kopyası
`provider-handoff.md` üzerinden diğer sağlayıcıya aktarılır; bu tam sohbet aktarımı değildir. Claude'un
session kimliği ile Codex'in thread kimliği ayrı tutulur; geri dönünce o sağlayıcının eski oturumu sürdürülür.
Sağlayıcı seçimi owner endpoint'idir (`POST /api/employees/:id/provider`); koordinatör çalışan alırken
sağlayıcı seçebilir, sahibinin mevcut çalışan seçimini kendiliğinden değiştiremez.

## Onaylar ve bağlantılar

Oturumlar `read-only` sandbox ve `untrusted` onay politikasıyla açılır. Codex'in gönderdiği komut
ve dosya değişikliği onay istekleri, çalışanın kendi jetonuyla `/gate/check` üzerinden mevcut ofis
kapısına gider. Kapı izin verirse tek çağrı kabul edilir; kapıya erişilemiyorsa çağrı reddedilir.
Kapının tuttuğu iş için model mevcut `approvalRequest` aracını kullanır; sahibi Şirket/Onaylar'dan
karar verir. Anayasa'daki `gateEnabled` ofis kapısının sınıflandırmasını yönetmeye devam eder.

Ofisin kendi MCP araçları zaten rol ve yetki kontrolünden geçtiği için bu sunucunun araç politikası
`approve` olarak ayarlanır. Jeton yalnız alt sürecin ortamında durur; komut argümanında yer almaz.
Kişisel Codex MCP sunucuları, uygulama bağlantıları ve eklentileri çalışan oturumunda kapatılır.
Claude bağlantıları Codex'e otomatik taşınmaz; bu sürümde dış bağlantıları isteyen görevler,
yetenek ön kontrolü açıkken mevcut eksik yetenek davranışına tabidir.

Codex onay istekleri Claude'un her araç çağrısını gören PreToolUse kancasının eşdeğeri değildir.
Sandbox içinde zaten izinli salt okuma işlemleri ve Codex'in yerel/kurumsal yürütme kuralları ayrıca
geçerlidir. Ofis kapısı bir işletim sistemi güvenlik sınırı değildir; aynı kullanıcıya ait süreçleri
birbirinden ayırmaz. Dış bağlantı ve tam kanca politikası eşitliği bu entegrasyonun kapsamı dışındadır.

## Kullanım ve maliyet

Codex token kullanımının toplamı ile önbellek okuması ayrı kaydedilir (çift sayılmaz). Claude ve Codex
kotaları ayrı tutulur: Codex okuması Claude kotasının üzerine yazılmaz. Sahibinin payı ilgili sağlayıcının
çalışanlarında uygulanır; iki hesaptan biri haftalık durdurma sınırına gelirse şirket duraklatılır (bu anayasa
kararı iki sağlayıcı için de geçerlidir). Eksik kota penceresi sıfır
kullanım sayılmaz. Codex app-server USD maliyeti bildirmez: arayüz bunu **bilinmiyor** gösterir.
Ortak USD toplamları yalnız bildirilen Claude kullanımını içerir; Codex maliyeti eksiktir. Mevcut sayısal
maliyet alanlarındaki 0, ücretsiz kullanım iddiası değildir. Geçmiş olayların sağlayıcısı saklanır; çalışan
sağlayıcı değiştirse de eski Codex turu Claude fiyatıyla gösterilmez. `recordSpend` ile
kaydedilen dış harcamalar ve onların bütçe sınırları devam eder.

## Doğrulama

`pnpm --filter @cc/office-server test -- test/codex.test.ts` sahte JSON-RPC süreciyle model seçimi,
rol kartı, hafızayı sürdürme, mesaj teslimi, durdurma, yan soru kopyası, araç ve kapı olaylarını sınar.
`test/mixed-providers.test.ts` mevcut Claude verisinin göçünü, Claude koordinatör → Codex çalışan → Claude
inceleyici akışını, aynı koordinatörün iki oturum arasında gidip gelmesini ve hesap kotalarının ayrılığını sınar.
Gerçek Codex testi varsayılan olarak kapalıdır; bir kısa tur için hesaptan kullanım yapar:

```powershell
$env:OFFICE_CODEX_SMOKE = '1'
pnpm --filter @cc/office-server test -- test/codex.smoke.real.test.ts
```

`OFFICE_MIXED_SMOKE=1` aynı dosyadaki ikinci tanıyı açar: gerçek Claude koordinatör gerçek Codex çalışanına
ofis aracıyla görev verir; Codex dosya üretip taskFinish ile teslim eder, ofis dosyayı arşivler. İki hesabın da
giriş yapmış olması gerekir ve iki kısa tur kullanım yapar. Her iki tanı şirketten ayrı geçici veri kullanır.

Test, geçici bir masada teslim dosyası yazar, kapıdan onay alır ve jetonlu yerel MCP aracını çağırır;
gerçek şirket verilerini kullanmaz. App-server sürümleri değişebildiği için test edilen sürüm:
`codex-cli 0.162.0-alpha.17.2`. Protokolün kaynakları:
[Codex App Server](https://learn.chatgpt.com/docs/app-server) ve
[MCP araç politikaları](https://learn.chatgpt.com/docs/config-file/config-reference).
