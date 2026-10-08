# Sahibine ait uçlar: Origin + sayfa anahtarı (nonce) ve sınırı

Görev a5844985 (Kerem'in bulgusu, görev 675897e6) · dal `fix/owner-endpoint-origin` · 2026-10-08.
Satır numaraları bu daldaki `apps/office-server/src/api.ts` içindir.

## Neden

`checkRequest` (api.ts:86) Host doğruysa Origin başlığı **olmayan** isteği kabul ediyordu. Tarayıcı dışından gelen
istekte (curl) Origin olmadığı için, aynı Unix kullanıcısında çalışan herhangi bir süreç sahibine ait değiştiren uçları
çağırabiliyordu. Çalışanların Bash'i de böyle bir süreç. Olay kaydında da işlem sahibi yapmış gibi görünüyordu.

## Sınıflandırma: değiştiren uçlar ve kim çağırır

İki yol var ve birbirinden ayrı:

**A. Çalışan yolu: MCP araçları.** `POST /mcp` (api.ts:137), `handleMcp` ile işleniyor. Kimlik `Authorization: Bearer
<token>` başlığından geliyor (mcp/protocol.ts:39). Token her oturum açılışında yalnız o çalışana verilir (engine.ts
`#start`, `tokens.issue`). Araçlar şirket katmanını süreç içinden çağırır, HTTP sahibi uçlarına hiç gitmez (main.ts:91
`officeTools`). Bu yol **değişmedi**; sahibi kılavuzu `/mcp` dalından sonra çalışıyor (api.ts:145-146).

**B. Sahibi yolu: `/api/` altındaki her değiştiren istek** (GET/HEAD dışı). Hepsinin tek çağıranı ofis sayfası; web
istemcisinin tamamı `apps/office-web/src/net/api.ts` içindeki `request()` fonksiyonundan geçiyor.

| Uç | api.ts | Sayfada kim çağırır |
|---|---|---|
| POST /api/employees (işe alma) | 151 | HireDialog |
| POST /api/plans/:id/approve · decline · stop | 160 | PlanCard |
| POST /api/onboarding/answers | 166 | web istemcisinde çağıranı yok (sahibinin onboarding cevabı) |
| POST /api/goals/:id/stop | 171 | GoalsTab |
| POST /api/tasks/:id/park · release · prioritize | 174 | AgendaTab |
| POST /api/schedules/:id/pause · resume · stop | 190 | AgendaTab |
| POST /api/company/pause · resume | 191, 195 | TopBar |
| POST /api/company/coordinator/hire | 199 | CompanyView |
| POST /api/company/coordinator (atama) | 200 | CompanyView |
| POST /api/decisions/:id/revert (geri alma) | 208 | MemoryTabs |
| POST /api/constitution (anayasa, kota, para sınırı) | 223 | BudgetTabs |
| POST /api/proposals/:id/approve · reject (öneri kararı) | 230 | ProposalCard |
| DELETE /api/employees/:id (işten çıkarma) | 240 | FireControls |
| POST /api/employees/:id/messages (sahibinden mesaj) | 248 | Panel |
| POST /api/employees/:id/side-questions | 265 | Panel |
| POST /api/employees/:id/stop · resume | 266, 267 | Panel |
| POST · DELETE /api/employees/:id/terminal | 268, 269 | Panel |

Bu 27 uç-yöntem çiftinin hepsi `test/owner-guard.test.ts` içindeki `OWNER_ROUTES` listesinde, Origin'siz denemeyle sınanıyor.

Okuma uçları (GET: `/api/office`, olaylar, bütçe, hafıza…) ve `/ws` olay akışı **değişmedi**; bkz. "Kalan açıklar".

## Ne yapıldı

- **Kılavuz** (`apps/office-server/src/owner-guard.ts`, api.ts:145-146). `/api/` altındaki her değiştiren istek için:
  1. **Origin zorunlu.** Yabancı bir Origin'i `checkRequest` zaten reddediyordu. Origin yoksa 403 ve `code: owner_origin`.
  2. **Canlı bir nonce** `x-owner-nonce` başlığında olmalı. Yoksa, uydurmaysa ya da süresi geçmişse 403 ve `code: owner_nonce`.
- **Nonce'u alma.** Sayfa nonce'u `GET /api/owner/nonce` ile alır. Uç yalnız tarayıcının kendiliğinden eklediği
  `Sec-Fetch-Site: same-origin` başlığı varsa cevap verir, yoksa 403 ve `owner_fetch`. Nonce 32 rastgele bayttır ve
  1 saat geçerlidir; en fazla 50 tanesi aynı anda tutulur.
- **Web istemcisi** her değişiklikte nonce'u gönderir ve süresi dolmadan bir dakika önce yenisini alır. Sunucu nonce'u
  tanımıyorsa (yeniden başlamışsa) bir kez yeni nonce alıp yeniden dener. Dev ortamında Vite proxy'si tarayıcının
  Origin ve Sec-Fetch-Site başlıklarını taşır; dev kaynağı zaten `OFFICE_ALLOWED_ORIGINS` içinde.
- **Tespit.** Olay kaydına `owner.request.flagged` yazılır: `mark`, `outcome`, method, path, user-agent.

  | mark | ne zaman | outcome |
  |---|---|---|
  | `owner-endpoint, origin-less` | değiştiren istek, Origin yok | rejected |
  | `owner-endpoint, nonce-less` | Origin var, geçerli nonce yok | rejected |
  | `owner-endpoint, no fetch metadata` | nonce isteğinde `Sec-Fetch-Site: same-origin` yok | rejected |
  | `owner-endpoint, no fetch metadata` | Origin ve nonce geçerli ama `Sec-Fetch-Site` yok (tarayıcıdan gelmemiş) | accepted |

## Deneme: çalışan nonce'u curl ile alabilir mi? (sonuç: evet)

`outputs/owner-origin/curl-probe.sh` dalın kendi office-server'ını geçici bir veri klasörüyle ve sahte CLI ile açıp aynı
kullanıcıdan curl ile denedi. Canlı ofise dokunulmadı. Çıktısı `curl-probe-output.txt` dosyasında:

1. Düz curl (Origin yok): **reddedildi** (`owner_origin`), işaretlendi.
2. Origin uyduruldu, nonce yok: **reddedildi** (`owner_nonce`), işaretlendi.
3. Sayfanın HTML'inde nonce yok; sayfa onu JS ile alır.
4. Nonce ucu düz curl'e vermiyor (`owner_fetch`), işaretlendi.
5. `-H 'Sec-Fetch-Site: same-origin'` uydurulunca **nonce alındı**.
6. Origin + nonce ile değişiklik **geçti** (`{"paused":true}`); "no fetch metadata, accepted" diye işaretlendi.
7. Origin + nonce + `Sec-Fetch-Site` + tarayıcı User-Agent ile tam sahte istek **geçti ve hiç işaretlenmedi**.
8. API'ye hiç gerek yok: `office.db` aynı kullanıcıya **yazılabilir** (`-rw-r--r--`, sahibi aynı kullanıcı).

## Sınır: bu değişiklik neyi sağlar, neyi sağlamaz

**Sağlar:**
- Düz ya da kazara bir `curl` (bir çalışanın "yardımcı olmak için" API'yi çağırması) artık reddediliyor ve olay kaydında görünüyor.
- Bir başka sitenin, sahibinin tarayıcısı üzerinden istek atması (CSRF) eskisi gibi engelli.
- Kılavuzu atlatmak artık **bilinçli sahtecilik** istiyor: Origin uydurmak, nonce ucunu sahte başlıkla çağırmak, nonce'u
  taşımak. Bunu yapan çalışanın Bash komutları zaten kendi olay kaydında `tool.started` girdisi olarak duruyor. Bu, gizlenebilen
  ama gerçek bir iz.

**Sağlamaz (yanlış güven vermemek için):**
- **Aynı Unix kullanıcısındaki bir süreç, tarayıcının yaptığı her şeyi yapabilir.** Bütün başlıklar uydurulabilir:
  deneme 7, tam sahte isteğin işaretlenmeden geçtiğini gösteriyor.
- Aynı kullanıcı API'yi hiç kullanmadan `~/.control-center/office.db`'ye doğrudan yazabilir (deneme 8). Oradan anayasa,
  kararlar ve görevler değiştirilebilir. Sunucunun ortam değişkenleri (`/proc/<pid>/environ`) ve dosyaları da aynı kullanıcıya açık.
- Okuma uçları ve `/ws` olay akışı Origin'siz açık. Aynı kullanıcı her şeyi okuyabilir (zaten DB dosyasını da okuyabilir).
- Sahibinin kendi betikleri (eski plan belgelerindeki `curl -X POST …` örnekleri) artık reddedilir. Sahibi betikle
  değişiklik yapacaksa çalışanın yapabileceği sahteciliğin aynısını yapmak zorunda; iki durum HTTP katmanında ayırt edilemez.

**Gerçek sınır için öneri (bu dalda yapılmadı, karar sahibinde):**
- Çalışanları **ayrı bir Unix kullanıcısıyla** (ya da bir kapta) çalıştırmak: ofisin veri klasörüne erişimleri olmasın,
  127.0.0.1:<port>'a bağlanamasınlar. MCP araçları zaten token'la çalıştığı için bu yol etkilenmez.
- Ya da Claude Code'un Bash sandbox'ı (dosya sistemi ve ağ kısıtı): çalışanın Bash'i ofis portuna ve
  `~/.control-center`'a erişemesin. Her ikisi de ayrı bir iş ve kendi güvenlik testini ister.
