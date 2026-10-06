# control-center

Claude Code oturumlarını rol tanımı verilmiş çalışanlar olarak, canlı bir 3D ofiste çalıştıran platform.
Tasarım: `docs/superpowers/specs/2026-10-06-office-v1-design.md`.

## Ofisi açmak

```bash
pnpm install
pnpm office          # arayüzü derler ve office-server'ı başlatır
```

Sonra tarayıcıda **http://127.0.0.1:4319** adresini aç. Modeller `assets/3d/` altında ve `assets/3d/manifest.json`
ile tanımlıdır; eksik bir model yerine voksel kutu / figür görünür.

Arayüz geliştirme (anlık yenileme):

```bash
OFFICE_ALLOWED_ORIGINS=http://127.0.0.1:5180,http://localhost:5180 pnpm --filter @cc/office-server start
pnpm --filter @cc/office-web dev     # http://127.0.0.1:5180
```

## Şirket

Üst çubuktaki **Şirket** görünümünden bir **koordinatör** işe alın (Fable ile çalışır) ya da bir çalışanı koordinatör
yapın. Sonra yalnız koordinatörle konuşursunuz:

1. Ne istediğinizi yazın; koordinatör sohbette bir **plan kartı** açar (yaklaşım, kimler, görevler, tahmini kota/para/süre).
2. Tartışın; kart güncellenir. **Onayla** ile karar verin.
3. Koordinatör gerekirse çalışan alır (rol kartı, model ve karakter onun seçimi) ve görevleri dağıtır. Ofis her
   görevi, çalışanı boşa çıkınca sırayla verir; çalışanlar birbirine iş paslar ve teslim eder.
4. Şirket görünümünde örgüt şeması ve görev panosu canlı akar; koordinatör raporlarını sohbete yazar.

Çalışanlar ofis araçlarına (`taskFinish`, `taskPass`, `planPropose`, `hire`…) ofis sunucusunun `/mcp` adresinden,
her oturuma özel bir jetonla erişir.

## office-server

Gereken: Node 24+, pnpm 9, giriş yapılmış `claude` CLI.

```bash
pnpm install
pnpm --filter @cc/office-server start     # http://127.0.0.1:4319, veri: ~/.control-center
pnpm test                                  # sahte claude ile tüm testler
pnpm --filter @cc/office-server smoke      # gerçek claude (Haiku) ile duman testi
```

Ortam değişkenleri: `OFFICE_DATA_DIR` (repo içinde olamaz), `OFFICE_PORT`, `OFFICE_ALLOWED_ORIGINS`
(virgülle), `OFFICE_CLAUDE_COMMAND` (JSON dizi).

Çalışanlar onay istemeden ve sahibinin bütün bağlantılarıyla çalışır; ofis API'si yalnızca
`127.0.0.1`'den ve izin verilen kaynaklardan gelen istekleri kabul eder.
