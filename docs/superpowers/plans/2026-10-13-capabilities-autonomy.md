# Capabilities and autonomy — sub-project 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every capability carries a kind the gate reads (vocabulary v3, `messages.read`, `calendar` and `call` approvals); the company adds capabilities of its own (an employee proposes, the coordinator decides, the owner sees, adds, overrules and retires); the owner's outward policy lets the system send, publish and call through connectors on mechanical rules (sends per hour per department, bulk recipients, special contacts, call hours, calls per day) while everything critical still goes to the owner; every outward call the gate lets out is written to an outbox the coordinator, the heads and the owner read; everyone's guide and the customer-facing templates carry the judgment layer. The gate itself stays exactly as the owner set it.

**Architecture:** `capabilities.json` gains a `kind` per capability (version 3) and the parser checks it against `outward`; `gate-policy.ts` drops its kind map and reads the capability's kind, and a connector's part carries its `capability`. Migration v25 adds `custom_capabilities` and `outbox`; a `CustomCapabilityStore` and an `OutboxStore` hold their rows. `capabilities.ts` becomes a merge layer — the product's vocabulary plus the company's active capabilities, rebuilt by a generation counter — so `toolClass`, `sessionDeny`, `coverage`, `capabilityIds` and the gate all see them. A `CustomCapabilities` service owns the proposal/decision rules, events and notices. The constitution gains `outwardPolicy`, `specialContacts`, `sendsPerHour`, `bulkRecipients`, `callHours` and `callsPerDay`. Pure helpers read a call's recipients and special contacts and apply the rules (`recipients.ts`, `outward-rules.ts`); `Gate.check` gains a system path between the owner's approvals and the held answer, and writes every outward call it lets out to the outbox (`outbox.sent`). New tools (`capabilityPropose`, `capabilityDecide`, `outboxRead`; `approvalRequest` from a call's own input), owner API routes, the judgment layer in `craft/working.md`, new template versions, and on the web the Anayasa fields and the Yetenekler and Giden kutusu tabs.

**Tech Stack:** Node 24 (type stripping, `node:sqlite`), TypeScript 5.9, vitest 3, React 19 + zustand + @testing-library/react (office-web), pnpm 9 workspace.

**Spec:** `docs/superpowers/specs/2026-10-13-capabilities-autonomy-design.md` (whole document). Background: `docs/superpowers/specs/2026-10-13-departments-design.md` and `docs/superpowers/plans/2026-10-13-departments.md` (the `Departments` service — `find`, `of`, `headOf`, `members`; `companyFor(…, { departments: true })`; `Employee.departmentId`; `HireInput.departmentId` / `head`; `OfficeData.departments`), `docs/superpowers/plans/2026-10-13-office-rooms.md` (no migration of its own; seats). Gate facts gathered before planning: `.superpowers/sdd/notes/subproject3-gate-facts.md`.

**Base:** branch `feat/departments` with sub-project 1's plan (Tasks 1–15) and sub-project 2's plan (Tasks 1–12) done. Worktree `~/Projects/control-center-departments`. The departments migration is **v24** and sub-project 2 adds none, so this plan's is **v25**. If sub-project 1's Task 15 Step 5 renumbered the departments migration to 25 (the knowledge base's 24 on main), read every `v25`, `upTo(25)`, `migrateDown(db, 24)`, `V25_TABLES` and `toBe(25)` below one higher (26 / 25 / `V26_TABLES` built on `V25_TABLES`); find the departments migration by its name `departments: the rooms, their heads, an employee’s department and the notes on plan streams`.

## Global Constraints

- Node 24 type stripping: no enums, no parameter properties, `import type` for types, `.ts` extensions in imports.
- Every migration is reversible: `up` + `down`; `down` removes exactly what `up` added and is a no-op when already reverted; `up` uses `IF NOT EXISTS`; round trip (up → down → up) tested.
- Migrations are numbered 1, 2, 3 … with no gap (`db.test.ts` checks it). This plan adds **25**: `custom_capabilities` and `outbox`, one migration. It is renumbered at integration like the others (Task 13 Step 5).
- Tool descriptions in English; tool results, errors, notices, guides and UI text in Turkish.
- Code comments in English, in the repository's voice (why, not what), as dense as the surrounding code.
- Commits: plain conventional commits as the user (`tarik`), **no AI trailer, no "Generated with", no Claude/Anthropic marker anywhere** (message, body, author, committer, branch name).
- Work only in the worktree. Never touch `~/Projects/control-center` (the live office runs from it), never use port 4319 (also not through `pnpm --filter @cc/office-web dev`: its proxy goes to 4319), never run real-claude tests (`*.real.test.ts`, `OFFICE_SMOKE=1`). `assets/2d/` (the owner's untracked reference images) is never touched.
- **This work does not turn the gate on.** `DEFAULT_CONSTITUTION.gateEnabled` stays `false`; no code, migration, seed or start-up step writes `gateEnabled`; the live office's constitution is not touched. Everything added to the gate acts only while the owner has it on (with it off, every call passes and nothing is written — as today).
- An office that never uses the new things behaves as today: `capability.changed` only on a company capability change, `outbox.sent` only for a call the gate let out while on; no new notices otherwise; the economy scenario's log stays main's.
- The vocabulary's company source is module state in `capabilities.ts`: `main.ts` wires it once; **every test that calls `useCompanyCapabilities` resets it with `useCompanyCapabilities(null)` in `afterEach`** (a source over a closed test database would break the next test's reads).
- Values (pinned by tests):
  - `CAPABILITY_KINDS = ['read', 'send', 'calendar', 'call', 'publish', 'pay', 'delete']`; `outward === (kind !== 'read')`; vocabulary version **3**, **24** product capabilities.
  - `APPROVAL_KINDS = ['publish', 'send', 'calendar', 'call', 'pay', 'delete', 'browser', 'self', 'other']`; labels `calendar: 'takvim'`, `call: 'arama'`.
  - `OUTWARD_POLICY_KINDS = ['send', 'publish', 'call', 'calendar']`; default `outwardPolicy = { send: 'system', publish: 'system', call: 'system', calendar: 'owner' }`.
  - `specialContacts: []` (at most 200, each ≤ 200 characters); `sendsPerHour: 30` (0–1000); `bulkRecipients: 5` (1–1000); `callHours: [9, 19]` (whole hours 0–24, from < to); `callsPerDay: 20` (0–1000).
  - Outbox: at most `OUTBOX_MAX_RECIPIENTS = 20` recipients, summary at most `OUTBOX_SUMMARY_CHARS = 300` characters; `outboxRead` limit 1–200 (default 30); `GET /api/outbox` 1–200 (default 200).
  - Company capability: id `/^[a-z]+\.[a-z]+$/`, title ≤ 80, summary ≤ 300, 1–30 tools (`mcp__server__tool`), note ≤ 500.

## Spec rulings (decided here)

- **`outward` stays in the file and must agree with the kind**; the parser refuses a mismatch. `messages.read` sits just before `messages.send`; `crm.read`'s summary becomes "Müşteri adaylarını, kişileri, fırsatları ve huniyi okur." (the conversations moved).
- **Which parts the system may handle:** a `GatePart` carries `capability` only when it comes from a connector's classified tool. The system path needs every part of the call to have one and a kind the policy leaves to `'system'`. Unclassified connector tools (`other`), the browser, Bash, Monitor, SendMessage and PushNotification never qualify, whatever the policy.
- **Order at the gate:** an owner's approval matching the call is used first (written to the outbox `via: 'owner'`, never counted); then the system path; else held as today. A system-let-out call writes no `gate.checked` (that event keeps meaning "the gate held it or let a held one through on an approval"); it writes `outbox.sent`.
- **The outbox's scope:** every call the gate lets out that has a part of kind send, publish, call or calendar — by the system, or on the owner's approval whatever the tool (an approved `git push` is a publish line). Pay, delete, browser, self and other are not outbox lines (they live in the approvals and `gate.checked`).
- **Counting:** "the last hour" is `at >= now − 1 h`; "today" starts at local midnight; a limit is reached when the count `>=` the value (0: the system never does it). Rules in this order, the first broken one is the held call's reason: special contact, bulk, call hours, calls per day, sends per hour. A calendar invitation counts against neither counter but obeys special contacts and bulk.
- **Recipients:** the fields `to`, `cc`, `bcc`, `recipient(s)`, `attendee(s)`, `guests`, `invitees`, `participants`, `emails`, `phone(s)`, `phone_numbers`, `numbers`, `contacts`, `contact_ids`, `lead_ids`, `audience`, at any depth (keys compared folded, `_` and `-` ignored); a string is split on `,` `;` and newlines; an object in a list gives its `email`, `address`, `phone`, `number`, `id` or `name`; each recipient counted once (folded).
- **Special contacts:** e-mails and user names are compared with the office's `fold` (Turkish-aware lower case); a user name as a whole word, its `@` dropped; a phone by its digits — equal, or the same last ten (a country code or a leading 0 apart). Searched in every string and number of the input, not only the recipient fields.
- **Asking before a call:** `approvalRequest` gains `input` (with `tool`): the gate's new `preview` classifies the call, so the approval's print is that very call's and the judgment layer's "ask first" approval is the one the later call uses.
- **Company capabilities:**
  - a rejected or retired id may be proposed again (the row starts over); a proposed or active one may not;
  - the coordinator decides anyone else's proposal; the owner decides any, and is the only one for the coordinator's own (a decision on one's own proposal is refused);
  - the coordinator's kind change: keep it, `read` → any outward kind, any non-pay/delete kind → `pay` or `delete`; `pay` and `delete` never move; everything else (outward → `read`, sideways among send/publish/call/calendar) is the owner's (`setKind`, any way, also on an active one);
  - a rejection needs a note (the owner's from the page sends "Sahibi reddetti.");
  - tools: never the office's own, never a product capability's (the error names the capability — a product pay tool proposed as `read` is refused there), never another active company capability's; checked again on acceptance;
  - notices: `capability.proposed` (decision, to the coordinator) and `capability.decided` (decision, to the proposer; to the coordinator when the owner adds one, accepts someone else's, or retires one);
  - the Yetenekler tab marks "yeni · koordinatör onayladı" on an active one decided by someone other than the owner in the last seven days (no extra column);
  - only the owner retires (`retire`) and changes an active one's kind.
- **Vocabulary merge:** the product's capabilities first, then the company's active ones in creation order; the version stays the product's; a connector known by name only leaves `knownConnectors` once the company classifies one of its tools. Only `main.ts` wires `useCompanyCapabilities` (and the tests that need it); the service calls `invalidateVocabulary()` on every change to an active capability.
- **Constitution keys are appended** after `maxSchedules`, in the order `outwardPolicy, specialContacts, sendsPerHour, bulkRecipients, callHours, callsPerDay` (the owner's notice lists changes in this order).
- **Template rule test:** the six templates the spec names (`iletisim-yoneticisi`, `musteri-temsilcisi`, `sosyal-medya`, `satis-muduru`, `aday-arastirmaci`, `pazarlama-muduru`) say "Kritik olan sahibine, geri kalanı sistemce"; the other outward templates keep "sahibinin onayı" (their outward work is money, the owner's own mail, or content others publish). New template versions apply to new hires and new departments; nothing already hired or open is rewritten (as with every template version before).
- **`working.md`'s limit** grows from 3000 to 3600 characters: the judgment layer is everyone's (spec §8).
- **`outboxRead` for a lead with no department** (an office without departments) is refused: the coordinator reads it.

## Review Focus

1. **A bulk e-mail to six people slipping through as the system's** (the default threshold is 5; `to` + `cc` + `bcc` together) — Task 7 pins the rule, Task 8 pins it at the gate: held with "toplu gönderim: 6 alıcı > 5", then approved by the owner it passes as the owner's and is not counted.
2. **A special contact written in another case or format** ("ALI@firma.COM" for "Ali@Firma.com", "0532 111 22 33" or `905321112233` for "+90 (532) 111 22 33", "@aliveli" for "@AliVeli", "IPEK" for "İpek") passing as the system's — Task 7 pins the matching, Task 8 at the gate.
3. **A coordinator re-classifying a pay tool as read** — a `pay` proposal accepted as `read` or `send`, an outward one loosened to `read`, a product pay tool (`jeeta_reallocate_budget`) put in a company capability as `read` — Task 4 pins every refusal (and that the owner may).
4. **A Bash `curl` POST passing as system-handled** (or a `mail` command, a `SendMessage`, an unclassified connector tool), whatever the policy — Task 1 pins that only connector parts carry a capability, Task 8 that such calls are held and written nowhere.
5. **The hourly cap counting another department's sends** (Satış at its cap must not stop Pazarlama; one person without a department must not stop another) — Task 8 pins it through the gate, and the hour moving on.

---

### Task 1: Capability kinds — the vocabulary v3, `messages.read`, and the gate reads the kind

**Files:**
- Modify: `packages/shared/src/capability.ts`, `packages/shared/src/approval.ts`, `apps/office-server/src/company/capabilities.ts`, `apps/office-server/src/company/craft/capabilities.json`, `apps/office-server/src/company/gate-policy.ts`
- Test: `apps/office-server/test/capabilities.test.ts`, `apps/office-server/test/company-api.test.ts`, `apps/office-server/test/gate-policy.test.ts`, `apps/office-server/test/approvals.test.ts`

**Interfaces:**
- Produces: `CAPABILITY_KINDS`, `CapabilityKind`, `CAPABILITY_KIND_LABELS`; `Capability.kind: CapabilityKind`; `APPROVAL_KINDS` with `calendar` and `call`; `capabilityKind(id: string): CapabilityKind | null` (capabilities.ts); `GatePart.capability?: string` (set only for a classified connector tool's part). `KIND_BY_CAPABILITY` is removed.

- [ ] **Step 1: Write the failing tests**

In `test/capabilities.test.ts`, replace `SAMPLE` with:

```ts
const SAMPLE = JSON.stringify({
  version: 3,
  capabilities: [
    { id: 'email.read', title: 'E-posta okuma', summary: 'Gelen kutusunu okur.', kind: 'read', outward: false, builtin: [], tools: ['mcp__claude_ai_Gmail__get_message'] },
    { id: 'web.fetch', title: 'Web’den okuma', summary: 'Sayfaları okur.', kind: 'read', outward: false, builtin: ['WebFetch'], tools: [] },
    { id: 'email.send', title: 'E-posta gönderme', summary: 'Gönderir.', kind: 'send', outward: true, builtin: [], tools: ['mcp__claude_ai_Gmail__send_message'] },
  ],
});
```

In `'reads a vocabulary: its version and each capability as written'` change `expect(v.version).toBe(2)` to `toBe(3)` and the last expectation to:

```ts
    expect(v.capabilities[2]).toEqual({ id: 'email.send', title: 'E-posta gönderme', summary: 'Gönderir.', kind: 'send', outward: true, builtin: [], tools: ['mcp__claude_ai_Gmail__send_message'] });
```

In `'review focus: refuses a wrong vocabulary, saying what is wrong'` add to `bad`:

```ts
      [variant((v) => void (v.capabilities[0]!.kind = 'mail')), /email.read: kind read, send, calendar, call, publish, pay, delete olmalı/],
      [variant((v) => void delete v.capabilities[2]!.kind), /email.send: kind read, send/],
      [variant((v) => void (v.capabilities[2]!.outward = false)), /email.send: outward türle uyuşmuyor \(send → true\)/],
      [variant((v) => void (v.capabilities[0]!.kind = 'pay')), /email.read: outward türle uyuşmuyor \(pay → true\)/],
```

Replace the head of `'the shipped vocabulary: twenty-three capabilities, …'` (its name, the version and the two id lists) with:

```ts
  it('the shipped vocabulary (version 3): twenty-four capabilities, each with its kind, which go outward, which the session always has, the connectors named by their tools', () => {
    const v = capabilityVocabulary();
    expect(v.version).toBe(3);
    expect(v.capabilities.map((c) => c.id)).toEqual([
      'docs.read', 'docs.write', 'web.fetch', 'email.read', 'email.draft', 'email.send', 'calendar.read', 'calendar.write',
      'social.read', 'social.draft', 'social.publish', 'crm.read', 'crm.write', 'payments.read', 'payments.charge', 'ecommerce.orders',
      'email.delete', 'messages.read', 'messages.send', 'calls.make', 'ads.manage', 'web.publish', 'media.generate', 'automation.run',
    ]);
    // Spec capabilities §2: the kinds, as the gate's map had them, an invitation and a call now apart; the rest only read.
    expect(Object.fromEntries(v.capabilities.filter((c) => c.kind !== 'read').map((c) => [c.id, c.kind]))).toEqual({
      'email.send': 'send', 'calendar.write': 'calendar', 'social.publish': 'publish', 'payments.charge': 'pay', 'email.delete': 'delete',
      'messages.send': 'send', 'calls.make': 'call', 'ads.manage': 'pay', 'web.publish': 'publish', 'media.generate': 'pay', 'automation.run': 'pay',
    });
    for (const c of v.capabilities) expect(c.outward, c.id).toBe(c.kind !== 'read');
    expect(v.capabilities.filter((c) => c.outward).map((c) => c.id)).toEqual([
      'email.send', 'calendar.write', 'social.publish', 'payments.charge', 'email.delete', 'messages.send', 'calls.make', 'ads.manage', 'web.publish', 'media.generate', 'automation.run',
    ]);
```

(keep the rest of that test). In the same test, after `expect(capability('automation.run').tools).toEqual(['mcp__claude_ai_apify__call-actor']);` add:

```ts
    // Spec capabilities §3: conversations are messages — read apart from the customer records.
    expect(capability('messages.read')).toMatchObject({ kind: 'read', outward: false, tools: [`${J}jeeta_list_conversations`, `${J}jeeta_read_conversation`] });
    expect(capability('crm.read').tools).not.toContain(`${J}jeeta_list_conversations`);
    expect(capability('crm.read').tools).not.toContain(`${J}jeeta_read_conversation`);
    expect(capability('crm.read').summary).toBe('Müşteri adaylarını, kişileri, fırsatları ve huniyi okur.');
```

In the `capabilitiesRead` test change the header expectation to:

```ts
    expect(all).toContain('# Yetenek sözlüğü (24 yetenek, sürüm 3) — ofisteki karşılığı; salt okunur, hiçbir bağlayıcı çağrılmadı.');
```

In `test/company-api.test.ts` (`'shows the owner the capability vocabulary …'`): `expect(all.version).toBe(3);`, `expect(all.capabilities).toHaveLength(24);`, and `toMatchObject({ title: 'E-posta gönderme', kind: 'send', outward: true })`.

In `test/gate-policy.test.ts`, inside `describe('gate policy (K1) — connector, browser, file and web tools', …)` after `tool('mcp__claude_ai_jeeta__jeeta_publish_social_post', …)` add:

```ts
  // Spec capabilities §2: a connector call's kind is its capability's — an invitation is calendar, a dial a call.
  tool('mcp__claude_ai_Google_Calendar__create_event', { summary: 'Tanışma', attendees: ['a@b.co'] }, 'calendar');
  tool('mcp__claude_ai_jeeta__jeeta_click_to_dial', { phone: '+905321112233' }, 'call');
  tool('mcp__claude_ai_jeeta__jeeta_send_message', { to: '+905321112233', text: 'x' }, 'send');
  tool('mcp__claude_ai_jeeta__jeeta_reallocate_budget', { campaign_id: 'c1' }, 'pay');
  tool('mcp__claude_ai_Gmail__trash_message', { id: 'm1' }, 'delete');
  tool('mcp__claude_ai_jeeta__jeeta_read_conversation', { id: 'c1' }, 'pass');
```

and inside `describe('gate policy (K1) — targets and fingerprints (§4 madde 4)', …)`:

```ts
  it('review focus 4: a connector’s part names its capability (the only parts the system may handle); a shell, a built-in or an unclassified part names none', () => {
    expect(classifyCall('mcp__claude_ai_Gmail__send_message', { to: 'a@b.co' }, DESK, ctx).parts).toEqual([
      { kind: 'send', target: 'send_message to=a@b.co', why: 'dışarıya gönderir (email.send)', capability: 'email.send' },
    ]);
    expect(first(classifyCall('mcp__claude_ai_Google_Calendar__create_event', {}, DESK, ctx))).toMatchObject({ kind: 'calendar', why: 'takvime yazar, katılımcılara davet gider (calendar.write)', capability: 'calendar.write' });
    expect(first(bash('curl -X POST https://api.example.com/x'))).not.toHaveProperty('capability');
    expect(first(bash('mail a@b.co'))).not.toHaveProperty('capability');
    expect(first(classifyCall('SendMessage', { to: 'x', message: 'y' }, DESK, ctx))).not.toHaveProperty('capability');
    expect(first(classifyCall('mcp__foo__bar', {}, DESK, ctx))).not.toHaveProperty('capability');
    expect(first(classifyCall('mcp__plugin_playwright_playwright__browser_click', {}, DESK, ctx))).not.toHaveProperty('capability');
  });
```

In `test/approvals.test.ts`, at the end of `'what a request needs: a reason, a kind from the list, a task for a task’s scope'`:

```ts
    // Spec capabilities §2: an invitation and a dial are kinds of their own, with their own labels.
    expect(t.approvals.request(t.ada.id, { kind: 'calendar', tool: 'mcp__claude_ai_Google_Calendar__create_event', target: 'create_event summary=Tanışma', summary: 's' })).toMatchObject({ kind: 'calendar' });
    expect(t.approvals.request(t.ada.id, { kind: 'call', tool: 'mcp__claude_ai_jeeta__jeeta_click_to_dial', target: 'jeeta_click_to_dial', summary: 's' })).toMatchObject({ kind: 'call' });
    expect([APPROVAL_KIND_LABELS.calendar, APPROVAL_KIND_LABELS.call]).toEqual(['takvim', 'arama']);
```

(add `APPROVAL_KIND_LABELS` to that file's `@cc/shared` import).

- [ ] **Step 2: Run them to see them fail**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/capabilities.test.ts test/company-api.test.ts test/gate-policy.test.ts test/approvals.test.ts`
Expected: FAIL — `parseCapabilities(SAMPLE)` throws "email.read: “kind” bilinmeyen alan", the shipped version is 2, the calendar row is `send`, `kind must be one of …` for `calendar`.

- [ ] **Step 3: Shared types**

`packages/shared/src/capability.ts` — after the file's opening comment, before `export interface Capability`:

```ts
/**
 * What a capability does (spec 2026-10-13-capabilities-autonomy §2): the gate takes a connector call's approval kind
 * from it, and every kind but `read` goes outward (the vocabulary keeps `outward` beside it, checked to agree).
 */
export const CAPABILITY_KINDS = ['read', 'send', 'calendar', 'call', 'publish', 'pay', 'delete'] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];
export const CAPABILITY_KIND_LABELS: Record<CapabilityKind, string> = {
  read: 'okuma', send: 'gönderim', calendar: 'takvim', call: 'arama', publish: 'yayın', pay: 'ödeme/harcama', delete: 'silme',
};
```

and in `interface Capability`, after `summary: string;`:

```ts
  /** What it does (CAPABILITY_KINDS); `outward` is `kind !== 'read'`. */
  kind: CapabilityKind;
```

`packages/shared/src/approval.ts`:

```ts
/** What a held call would do: publish, send, invite, call, pay or spend, delete, act in a browser, touch the office itself, other. */
export const APPROVAL_KINDS = ['publish', 'send', 'calendar', 'call', 'pay', 'delete', 'browser', 'self', 'other'] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const APPROVAL_KIND_LABELS: Record<ApprovalKind, string> = {
  publish: 'yayın',
  send: 'gönderim',
  calendar: 'takvim',
  call: 'arama',
  pay: 'ödeme/harcama',
  delete: 'silme',
  browser: 'tarayıcı',
  self: 'ofisin kendisi',
  other: 'diğer',
};
```

- [ ] **Step 4: The file — kinds, version 3, `messages.read`**

Run from the worktree root (rewrites the file in its own `JSON.stringify(…, null, 2)` style; refuses if a capability's `outward` disagrees with its kind):

```bash
cd ~/Projects/control-center-departments
node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
const file = "apps/office-server/src/company/craft/capabilities.json";
const KIND = { "email.send": "send", "messages.send": "send", "calendar.write": "calendar", "calls.make": "call", "social.publish": "publish", "web.publish": "publish", "payments.charge": "pay", "ads.manage": "pay", "media.generate": "pay", "automation.run": "pay", "email.delete": "delete" };
const MOVED = ["mcp__claude_ai_jeeta__jeeta_list_conversations", "mcp__claude_ai_jeeta__jeeta_read_conversation"];
const v = JSON.parse(readFileSync(file, "utf8"));
const out = [];
for (const c of v.capabilities) {
  const kind = KIND[c.id] ?? "read";
  if (c.outward !== (kind !== "read")) throw new Error(`${c.id}: outward ${c.outward}, kind ${kind}`);
  let { id, title, summary, outward, builtin, tools } = c;
  if (id === "crm.read") { summary = "Müşteri adaylarını, kişileri, fırsatları ve huniyi okur."; tools = tools.filter((t) => !MOVED.includes(t)); }
  if (id === "messages.send") out.push({ id: "messages.read", title: "Gelen mesajları ve yorumları okuma", summary: "SMS, WhatsApp ve sosyal medya mesajlarını, gönderi yorumlarını okur; hiçbir şey göndermez.", kind: "read", outward: false, builtin: [], tools: MOVED });
  out.push({ id, title, summary, kind, outward, builtin, tools });
}
writeFileSync(file, JSON.stringify({ version: 3, capabilities: out, knownConnectors: v.knownConnectors }, null, 2) + "\n");
'
git diff --stat apps/office-server/src/company/craft/capabilities.json
```

Expected: one file changed (24 `"kind"` lines, the new `messages.read` entry, `crm.read` two tools shorter, `"version": 3`).

- [ ] **Step 5: The parser and `capabilityKind`** — in `src/company/capabilities.ts`:

Import `CAPABILITY_KINDS` and `type CapabilityKind` from `@cc/shared` (add to the existing import). Replace `const FIELDS = …` with:

```ts
const FIELDS = ['id', 'title', 'summary', 'kind', 'outward', 'builtin', 'tools'] as const;
```

In `parseCapabilities`, replace the line `if (typeof entry.outward !== 'boolean') throw fail(…);` with:

```ts
    if (typeof entry.kind !== 'string' || !(CAPABILITY_KINDS as readonly string[]).includes(entry.kind)) throw fail(`${id}: kind ${CAPABILITY_KINDS.join(', ')} olmalı.`);
    const kind = entry.kind as CapabilityKind;
    if (typeof entry.outward !== 'boolean') throw fail(`${id}: outward true ya da false olmalı.`);
    // Kept in the file for its reader; derived from the kind, so the two must agree.
    if (entry.outward !== (kind !== 'read')) throw fail(`${id}: outward türle uyuşmuyor (${kind} → ${kind !== 'read'}).`);
```

and the capability's `return` with:

```ts
    return { id, title: (entry.title as string).trim(), summary: (entry.summary as string).trim(), kind, outward: entry.outward, builtin: entry.builtin as string[], tools };
```

After `capability(id)` add:

```ts
/** A capability's kind in the vocabulary; null for an id it does not have. */
export function capabilityKind(id: string): CapabilityKind | null {
  return capabilityVocabulary().capabilities.find((c) => c.id === id)?.kind ?? null;
}
```

- [ ] **Step 6: The gate reads the kind** — in `src/company/gate-policy.ts`:

Change the capabilities import to `import { capabilityKind, toolClass } from './capabilities.ts';`. In `interface GatePart`, after `why: string;`:

```ts
  /**
   * The connector capability this part comes from — only for a classified connector tool (spec capabilities §5): the
   * only parts the owner's outward policy may leave to the system. Bash and built-in parts never carry one.
   */
  capability?: string;
```

Delete `KIND_BY_CAPABILITY` and its comment. Replace `KIND_WHY` with:

```ts
const KIND_WHY: Record<ApprovalKind, string> = {
  publish: 'dışarıda yayımlar', send: 'dışarıya gönderir', calendar: 'takvime yazar, katılımcılara davet gider', call: 'telefonla arar', pay: 'para harcar',
  delete: 'geri alınamaz siler', browser: 'tarayıcıda iş yapar', self: 'ofisin kendisine dokunur', other: 'ne yaptığı bilinmiyor',
};
```

In `classifyCall`, replace the `if (c.kind === 'classified') { … }` block with:

```ts
  if (c.kind === 'classified') {
    if (!c.outward) return done([]);
    // The capability's own kind (spec capabilities §2); an outward id the vocabulary lost meanwhile is 'other'.
    const k = capabilityKind(c.capability);
    const kind: ApprovalKind = k === null || k === 'read' ? 'other' : k;
    return done([{ kind, target: mcpTarget(short, input), why: `${KIND_WHY[kind]} (${c.capability})`, capability: c.capability }]);
  }
```

- [ ] **Step 7: Run the tests and the typecheck**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/capabilities.test.ts test/company-api.test.ts test/gate-policy.test.ts test/approvals.test.ts test/session-deny.test.ts test/integrations.test.ts test/precheck.test.ts && cd ~/Projects/control-center-departments && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 8: Whole server suite, then commit**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run` — Expected: PASS (as the baseline at the start of this plan, plus the new tests). A test failing here because it lists the 23 ids, version 2, or `crm.read`'s conversation tools is updated to the new vocabulary the same way as Step 1.

```bash
cd ~/Projects/control-center-departments
git add packages/shared/src/capability.ts packages/shared/src/approval.ts apps/office-server/src/company/capabilities.ts apps/office-server/src/company/craft/capabilities.json apps/office-server/src/company/gate-policy.ts apps/office-server/test
git commit -m "feat(capabilities): capability kinds in the vocabulary (v3) and messages.read; the gate takes a connector call's kind from its capability — calendar and call approvals"
```

---

### Task 2: Shared types, migration v25, and the two stores

**Files:**
- Create: `packages/shared/src/autonomy.ts`, `apps/office-server/src/company/custom-capability-store.ts`, `apps/office-server/src/company/outbox-store.ts`
- Modify: `packages/shared/src/capability.ts`, `packages/shared/src/events.ts`, `packages/shared/src/index.ts`, `apps/office-server/src/migrations.ts`
- Test: `apps/office-server/test/db.test.ts`, `apps/office-server/test/autonomy-stores.test.ts`

**Interfaces:**
- Produces (shared): `CUSTOM_CAPABILITY_STATUSES`, `CustomCapabilityStatus`, `CUSTOM_CAPABILITY_STATUS_LABELS`, `CustomCapability`, `NewCustomCapability`, `CapabilityChange`; `OUTWARD_POLICY_KINDS`, `OutwardPolicyKind`, `OUTWARD_DECIDERS`, `OutwardDecider`, `OUTWARD_DECIDER_LABELS`, `OutwardPolicy`, `isOutwardPolicyKind(kind: string): kind is OutwardPolicyKind`, `OUTBOX_VIA`, `OutboxVia`, `OUTBOX_VIA_LABELS`, `OUTBOX_MAX_RECIPIENTS`, `OUTBOX_SUMMARY_CHARS`, `OutboxEntry`; events `capability.changed`, `outbox.sent`.
- Produces (server): tables `custom_capabilities`, `outbox` (v25); `class CustomCapabilityStore { constructor(db: Db); find(id): CustomCapability | null; get(id): CustomCapability; list(o?: { statuses?: readonly CustomCapabilityStatus[] }): CustomCapability[]; put(c: CustomCapability): CustomCapability; update(id, patch: CustomCapabilityPatch): CustomCapability }`; `type CustomCapabilityPatch`; `class OutboxStore { constructor(db: Db, now?: () => number); add(e: NewOutboxEntry): OutboxEntry; list(o?: { departmentId?: string | null; kind?: OutwardPolicyKind; since?: number; limit?: number }): OutboxEntry[]; countSystem(o: { departmentId: string | null; employeeId: string; kinds: readonly OutwardPolicyKind[]; since: number }): number }`; `type NewOutboxEntry = Omit<OutboxEntry, 'id' | 'at'>`.

- [ ] **Step 1: Shared types**

`packages/shared/src/capability.ts` — append:

```ts
/** A company capability's state (spec capabilities §4): proposed, then active or rejected; an active one the owner retires. */
export const CUSTOM_CAPABILITY_STATUSES = ['proposed', 'active', 'rejected', 'retired'] as const;
export type CustomCapabilityStatus = (typeof CUSTOM_CAPABILITY_STATUSES)[number];
export const CUSTOM_CAPABILITY_STATUS_LABELS: Record<CustomCapabilityStatus, string> = {
  proposed: 'karar bekliyor', active: 'etkin', rejected: 'reddedildi', retired: 'geri alındı',
};

/** A capability the company added to the vocabulary (spec capabilities §4.1; table custom_capabilities, v25). */
export interface CustomCapability {
  /** `area.action`, none of the product's. */
  id: string;
  title: string;
  summary: string;
  kind: CapabilityKind;
  /** Connector tools by full name; none of them in a product capability or in another active company one. */
  tools: string[];
  status: CustomCapabilityStatus;
  /** An employee's id, or 'owner'. */
  proposedBy: string;
  /** The coordinator's id or 'owner'; null while proposed. */
  decidedBy: string | null;
  note: string | null;
  createdAt: number;
  decidedAt: number | null;
}

/** What a proposal or the owner's addition gives. */
export interface NewCustomCapability {
  id: string;
  title: string;
  summary: string;
  kind: CapabilityKind;
  tools: string[];
}

export type CapabilityChange = 'proposed' | 'activated' | 'rejected' | 'retired' | 'kind';
```

Create `packages/shared/src/autonomy.ts`:

```ts
/**
 * Autonomy (spec 2026-10-13-capabilities-autonomy §5–§7): which outward kinds of a connector's call the owner leaves
 * to the system, and the outbox — the record of every outward call the gate let out.
 */

/** The outward kinds the owner's policy decides; pay, delete, the browser, the office itself and other are always the owner's. */
export const OUTWARD_POLICY_KINDS = ['send', 'publish', 'call', 'calendar'] as const;
export type OutwardPolicyKind = (typeof OUTWARD_POLICY_KINDS)[number];

export const OUTWARD_DECIDERS = ['owner', 'system'] as const;
export type OutwardDecider = (typeof OUTWARD_DECIDERS)[number];
export const OUTWARD_DECIDER_LABELS: Record<OutwardDecider, string> = { owner: 'Sahibine sor', system: 'Sistem halletsin' };

export type OutwardPolicy = Record<OutwardPolicyKind, OutwardDecider>;

export const isOutwardPolicyKind = (kind: string): kind is OutwardPolicyKind => (OUTWARD_POLICY_KINDS as readonly string[]).includes(kind);

/** Who let a call out: the system on the policy and its rules, or the owner's approval. */
export const OUTBOX_VIA = ['system', 'owner'] as const;
export type OutboxVia = (typeof OUTBOX_VIA)[number];
export const OUTBOX_VIA_LABELS: Record<OutboxVia, string> = { system: 'sistem', owner: 'sahibinin onayıyla' };

export const OUTBOX_MAX_RECIPIENTS = 20;
export const OUTBOX_SUMMARY_CHARS = 300;

/** One outward call the gate let out (table outbox, v25): an "allowed", not a "delivered", record. */
export interface OutboxEntry {
  id: number;
  employeeId: string;
  /** The caller's department when it went; null: the centre. */
  departmentId: string | null;
  tool: string;
  kind: OutwardPolicyKind;
  /** The gate's coarse target, as an approval names it. */
  target: string;
  /** Whom it was for, as read from the input (at most OUTBOX_MAX_RECIPIENTS). */
  recipients: string[];
  /** The input without secret-looking fields, its first OUTBOX_SUMMARY_CHARS characters. */
  summary: string;
  via: OutboxVia;
  approvalId: string | null;
  at: number;
}
```

`packages/shared/src/index.ts` — after `export * from './approval.ts';`:

```ts
export * from './autonomy.ts';
```

`packages/shared/src/events.ts` — add the imports `import type { OutboxEntry } from './autonomy.ts';` and `import type { CapabilityChange, CustomCapability } from './capability.ts';`, and to the `OfficeEvent` union, right after the `approval.changed` member:

```ts
  /** Spec capabilities §4: a company capability was proposed, activated, rejected, retired or given another kind. */
  | { type: 'capability.changed'; change: CapabilityChange; capability: CustomCapability }
  /** Spec capabilities §7: the gate let an outward call out — by the system, or on the owner's approval. */
  | { type: 'outbox.sent'; entry: OutboxEntry }
```

- [ ] **Step 2: Write the failing migration test** — in `test/db.test.ts`, after `V24_TABLES`:

```ts
const V25_TABLES = [...V24_TABLES, 'custom_capabilities', 'outbox'].sort();
```

Change `'applies every migration up'` and `'round-trips up → down → up'` to expect `25` and `V25_TABLES`, and `'is a no-op when run twice in either direction'` to expect `25`. Inside `describe('migrations', …)` add:

```ts
  it('v25 adds the company’s capabilities and the outbox, empty; v25 down restores v24', () => {
    const db = openDb(':memory:');
    migrateUp(db, upTo(24));
    expect(migrateUp(db, upTo(25))).toBe(25);
    expect(tables(db)).toEqual(V25_TABLES);
    expect(columns(db, 'custom_capabilities')).toEqual(['id', 'title', 'summary', 'kind', 'tools', 'status', 'proposed_by', 'decided_by', 'note', 'created_at', 'decided_at']);
    expect(columns(db, 'outbox')).toEqual(['id', 'employee_id', 'department_id', 'tool', 'kind', 'target', 'recipients', 'summary', 'via', 'approval_id', 'at']);
    db.prepare("INSERT INTO custom_capabilities (id, title, summary, kind, status, proposed_by, created_at) VALUES ('sms.send', 'SMS', 's', 'send', 'proposed', 'e1', 1)").run();
    expect(() => db.prepare("INSERT INTO custom_capabilities (id, title, summary, kind, status, proposed_by, created_at) VALUES ('x.y', 'X', 's', 'spend', 'proposed', 'e1', 1)").run()).toThrow();
    expect(() => db.prepare("INSERT INTO outbox (employee_id, tool, kind, target, via, at) VALUES ('e1', 't', 'pay', 'x', 'system', 1)").run()).toThrow();
    expect(() => db.prepare("INSERT INTO outbox (employee_id, tool, kind, target, via, at) VALUES ('e1', 't', 'send', 'x', 'nobody', 1)").run()).toThrow();
    const indexes = () => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'outbox%' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
    expect(indexes()).toEqual(['outbox_at', 'outbox_count']);
    expect(migrateDown(db, 24)).toBe(24);
    expect(tables(db)).toEqual(V24_TABLES);
    expect(indexes()).toEqual([]);
    expect(migrateDown(db, 24)).toBe(24);
    expect(migrateUp(db, upTo(25))).toBe(25);
  });
```

- [ ] **Step 3: Run it to see it fail**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/db.test.ts`
Expected: FAIL — `migrateUp(db)` returns 24.

- [ ] **Step 4: Append the migration** to `MIGRATIONS` in `src/migrations.ts`:

```ts
  {
    // 25 on feat/departments (after the departments' 24); renumbered at integration like the others (plan Task 13).
    version: 25,
    name: 'capabilities and autonomy: the company’s own capabilities and the outbox',
    // New tables only: code from before ignores them, so rolling back is safe.
    up: `CREATE TABLE IF NOT EXISTS custom_capabilities (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('read', 'send', 'calendar', 'call', 'publish', 'pay', 'delete')),
        tools TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL CHECK (status IN ('proposed', 'active', 'rejected', 'retired')),
        proposed_by TEXT NOT NULL, decided_by TEXT, note TEXT, created_at INTEGER NOT NULL, decided_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id TEXT NOT NULL, department_id TEXT, tool TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('send', 'publish', 'call', 'calendar')), target TEXT NOT NULL,
        recipients TEXT NOT NULL DEFAULT '[]', summary TEXT NOT NULL DEFAULT '',
        via TEXT NOT NULL CHECK (via IN ('system', 'owner')), approval_id TEXT, at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS outbox_count ON outbox (via, department_id, employee_id, kind, at);
      CREATE INDEX IF NOT EXISTS outbox_at ON outbox (at);`,
    down: `DROP INDEX IF EXISTS outbox_at;
      DROP INDEX IF EXISTS outbox_count;
      DROP TABLE IF EXISTS outbox;
      DROP TABLE IF EXISTS custom_capabilities;`,
  },
```

- [ ] **Step 5: Run the db tests**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/db.test.ts`
Expected: PASS (including "numbers the migrations 1, 2, 3 …" and the round trip).

- [ ] **Step 6: Write the failing store tests** — `test/autonomy-stores.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import type { CustomCapability } from '@cc/shared';
import { CustomCapabilityStore } from '../src/company/custom-capability-store.ts';
import { OutboxStore, type NewOutboxEntry } from '../src/company/outbox-store.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

function db() {
  const s = setup();
  cleanups.push(s.cleanup);
  return s.db;
}

describe('CustomCapabilityStore (spec capabilities §4.1)', () => {
  it('puts a row and reads it back; updates its decision; a row put again under its id starts over; lists by status, oldest first', () => {
    const store = new CustomCapabilityStore(db());
    const base: CustomCapability = { id: 'sms.send', title: 'SMS', summary: 's', kind: 'send', tools: ['mcp__netgsm__send_sms'], status: 'proposed', proposedBy: 'e1', decidedBy: null, note: null, createdAt: 1, decidedAt: null };
    expect(store.put(base)).toEqual(base);
    expect(store.find('x.y')).toBeNull();
    expect(() => store.get('x.y')).toThrow(/Şirket yeteneği bulunamadı: x\.y/);
    expect(store.update('sms.send', { status: 'rejected', decidedBy: 'c1', note: 'gerek yok', decidedAt: 2 })).toEqual({ ...base, status: 'rejected', decidedBy: 'c1', note: 'gerek yok', decidedAt: 2 });
    store.put({ ...base, id: 'sms.read', kind: 'read', tools: ['mcp__netgsm__inbox'], status: 'active', decidedBy: 'owner', createdAt: 3, decidedAt: 3 });
    expect(store.put({ ...base, title: 'SMS gönderme', createdAt: 4 })).toEqual({ ...base, title: 'SMS gönderme', createdAt: 4 });
    expect(store.list().map((c) => c.id)).toEqual(['sms.read', 'sms.send']);
    expect(store.list({ statuses: ['active'] }).map((c) => c.id)).toEqual(['sms.read']);
  });
});

describe('OutboxStore (spec capabilities §7)', () => {
  let now = 1_000;
  const make = () => {
    now = 1_000;
    const outbox = new OutboxStore(db(), () => now);
    const line = (over: Partial<NewOutboxEntry> = {}) =>
      outbox.add({ employeeId: 'e1', departmentId: 'd1', tool: 'mcp__claude_ai_Gmail__send_message', kind: 'send', target: 'send_message to=a@x.co', recipients: ['a@x.co'], summary: '{"to":"a@x.co"}', via: 'system', approvalId: null, ...over });
    return { outbox, line };
  };

  it('keeps each line as written (at most 20 recipients, a 300-character summary), newest first; narrows by department (null: the centre), kind and time', () => {
    const { outbox, line } = make();
    const a = line({ recipients: Array.from({ length: 25 }, (_, i) => `k${i}@x.co`), summary: 'x'.repeat(400) });
    expect(a).toMatchObject({ id: 1, at: 1_000 });
    expect(a.recipients).toHaveLength(20);
    expect(a.summary).toHaveLength(300);
    now = 2_000;
    const b = line({ employeeId: 'e2', departmentId: null, kind: 'call', target: 'jeeta_click_to_dial' });
    now = 3_000;
    const c = line({ via: 'owner', approvalId: 'ap1' });
    expect(outbox.list()).toEqual([c, b, a]);
    expect(outbox.list({ departmentId: 'd1' }).map((e) => e.id)).toEqual([c.id, a.id]);
    expect(outbox.list({ departmentId: null }).map((e) => e.id)).toEqual([b.id]);
    expect(outbox.list({ kind: 'call' }).map((e) => e.id)).toEqual([b.id]);
    expect(outbox.list({ since: 2_000, limit: 1 }).map((e) => e.id)).toEqual([c.id]);
  });

  it('counts what the system let out: a department’s, or — someone without one — theirs alone; never the owner’s approvals', () => {
    const { outbox, line } = make();
    line();
    line({ employeeId: 'e3' });
    line({ employeeId: 'e3', kind: 'publish' });
    line({ via: 'owner', approvalId: 'ap1' });
    line({ kind: 'call' });
    line({ departmentId: 'd2' });
    line({ employeeId: 'e5', departmentId: null });
    line({ employeeId: 'e6', departmentId: null });
    const count = (departmentId: string | null, employeeId: string, kinds: Array<'send' | 'publish' | 'call'>, since = 0) => outbox.countSystem({ departmentId, employeeId, kinds, since });
    expect(count('d1', 'e9', ['send', 'publish'])).toBe(3);
    expect(count('d1', 'e1', ['call'])).toBe(1);
    expect(count('d2', 'e1', ['send', 'publish'])).toBe(1);
    expect(count(null, 'e5', ['send', 'publish'])).toBe(1);
    expect(count(null, 'e7', ['send', 'publish'])).toBe(0);
    expect(count('d1', 'e1', ['send', 'publish'], 1_001)).toBe(0);
  });
});
```

- [ ] **Step 7: Run them to see them fail**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/autonomy-stores.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 8: Implement the stores**

`src/company/custom-capability-store.ts`:

```ts
import type { CapabilityKind, CustomCapability, CustomCapabilityStatus } from '@cc/shared';
import type { Db } from '../db.ts';
import { NotFoundError } from '../errors.ts';

interface Row {
  id: string;
  title: string;
  summary: string;
  kind: string;
  tools: string;
  status: string;
  proposed_by: string;
  decided_by: string | null;
  note: string | null;
  created_at: number;
  decided_at: number | null;
}

const fromRow = (r: Row): CustomCapability => ({
  id: r.id, title: r.title, summary: r.summary, kind: r.kind as CapabilityKind, tools: JSON.parse(r.tools) as string[], status: r.status as CustomCapabilityStatus,
  proposedBy: r.proposed_by, decidedBy: r.decided_by, note: r.note, createdAt: r.created_at, decidedAt: r.decided_at,
});

export type CustomCapabilityPatch = Partial<Pick<CustomCapability, 'kind' | 'status' | 'decidedBy' | 'note' | 'decidedAt'>>;

/** The company's own capabilities (spec capabilities §4.1, v25): rows only; the rules are the CustomCapabilities service's. */
export class CustomCapabilityStore {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  find(id: string): CustomCapability | null {
    const row = this.#db.prepare('SELECT * FROM custom_capabilities WHERE id = ?').get(id) as unknown as Row | undefined;
    return row ? fromRow(row) : null;
  }

  get(id: string): CustomCapability {
    const found = this.find(id);
    if (!found) throw new NotFoundError(`Şirket yeteneği bulunamadı: ${id}`);
    return found;
  }

  /** Oldest first. */
  list(o: { statuses?: readonly CustomCapabilityStatus[] } = {}): CustomCapability[] {
    const statuses = o.statuses ?? [];
    const where = statuses.length ? `WHERE status IN (${statuses.map(() => '?').join(', ')})` : '';
    const rows = this.#db.prepare(`SELECT * FROM custom_capabilities ${where} ORDER BY created_at, rowid`).all(...statuses) as unknown as Row[];
    return rows.map(fromRow);
  }

  /** A new row, or one rejected or retired before started over under the same id (the service decides which may). */
  put(c: CustomCapability): CustomCapability {
    this.#db
      .prepare(
        `INSERT INTO custom_capabilities (id, title, summary, kind, tools, status, proposed_by, decided_by, note, created_at, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET title = excluded.title, summary = excluded.summary, kind = excluded.kind, tools = excluded.tools,
           status = excluded.status, proposed_by = excluded.proposed_by, decided_by = excluded.decided_by, note = excluded.note,
           created_at = excluded.created_at, decided_at = excluded.decided_at`,
      )
      .run(c.id, c.title, c.summary, c.kind, JSON.stringify(c.tools), c.status, c.proposedBy, c.decidedBy, c.note, c.createdAt, c.decidedAt);
    return this.get(c.id);
  }

  update(id: string, patch: CustomCapabilityPatch): CustomCapability {
    const next = { ...this.get(id), ...patch };
    this.#db
      .prepare('UPDATE custom_capabilities SET kind = ?, status = ?, decided_by = ?, note = ?, decided_at = ? WHERE id = ?')
      .run(next.kind, next.status, next.decidedBy, next.note, next.decidedAt, id);
    return this.get(id);
  }
}
```

`src/company/outbox-store.ts`:

```ts
import { OUTBOX_MAX_RECIPIENTS, OUTBOX_SUMMARY_CHARS, type OutboxEntry, type OutboxVia, type OutwardPolicyKind } from '@cc/shared';
import type { Db } from '../db.ts';

interface Row {
  id: number;
  employee_id: string;
  department_id: string | null;
  tool: string;
  kind: string;
  target: string;
  recipients: string;
  summary: string;
  via: string;
  approval_id: string | null;
  at: number;
}

const fromRow = (r: Row): OutboxEntry => ({
  id: r.id, employeeId: r.employee_id, departmentId: r.department_id, tool: r.tool, kind: r.kind as OutwardPolicyKind, target: r.target,
  recipients: JSON.parse(r.recipients) as string[], summary: r.summary, via: r.via as OutboxVia, approvalId: r.approval_id, at: r.at,
});

export type NewOutboxEntry = Omit<OutboxEntry, 'id' | 'at'>;

/** What the gate let out (spec capabilities §7, v25): an "allowed", not a "delivered", record; never changed once written. */
export class OutboxStore {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  add(e: NewOutboxEntry): OutboxEntry {
    const at = this.#now();
    const recipients = e.recipients.slice(0, OUTBOX_MAX_RECIPIENTS);
    const summary = e.summary.slice(0, OUTBOX_SUMMARY_CHARS);
    const { lastInsertRowid } = this.#db
      .prepare('INSERT INTO outbox (employee_id, department_id, tool, kind, target, recipients, summary, via, approval_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(e.employeeId, e.departmentId, e.tool, e.kind, e.target, JSON.stringify(recipients), summary, e.via, e.approvalId, at);
    return { ...e, recipients, summary, id: Number(lastInsertRowid), at };
  }

  /** Newest first. `departmentId`: one department's (null: the centre's); `kind` and `since` narrow it. */
  list(o: { departmentId?: string | null; kind?: OutwardPolicyKind; since?: number; limit?: number } = {}): OutboxEntry[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (o.departmentId === null) where.push('department_id IS NULL');
    else if (o.departmentId !== undefined) {
      where.push('department_id = ?');
      params.push(o.departmentId);
    }
    if (o.kind !== undefined) {
      where.push('kind = ?');
      params.push(o.kind);
    }
    if (o.since !== undefined) {
      where.push('at >= ?');
      params.push(o.since);
    }
    const rows = this.#db
      .prepare(`SELECT * FROM outbox ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY at DESC, id DESC LIMIT ?`)
      .all(...params, o.limit ?? 200) as unknown as Row[];
    return rows.map(fromRow);
  }

  /**
   * Calls of these kinds the system let out (via 'system') since `since`: a department's, or — for someone in none —
   * theirs alone (spec §6). The owner's approvals never count.
   */
  countSystem(o: { departmentId: string | null; employeeId: string; kinds: readonly OutwardPolicyKind[]; since: number }): number {
    const kinds = o.kinds.map(() => '?').join(', ');
    const scope = o.departmentId ? 'department_id = ?' : 'department_id IS NULL AND employee_id = ?';
    const row = this.#db
      .prepare(`SELECT COUNT(*) AS n FROM outbox WHERE via = 'system' AND kind IN (${kinds}) AND at >= ? AND ${scope}`)
      .get(...o.kinds, o.since, o.departmentId ?? o.employeeId) as unknown as { n: number };
    return row.n;
  }
}
```

- [ ] **Step 9: Run the store and db tests, the typecheck, the whole server suite**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/autonomy-stores.test.ts test/db.test.ts && cd ~/Projects/control-center-departments && pnpm -r typecheck && cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
cd ~/Projects/control-center-departments
git add packages/shared/src apps/office-server/src/migrations.ts apps/office-server/src/company/custom-capability-store.ts apps/office-server/src/company/outbox-store.ts apps/office-server/test/db.test.ts apps/office-server/test/autonomy-stores.test.ts
git commit -m "feat(autonomy): migration v25 (company capabilities, outbox), their stores, and the shared types and events"
```

---

### Task 3: The vocabulary merges the company's active capabilities

**Files:**
- Modify: `packages/shared/src/capability.ts`, `apps/office-server/src/company/capabilities.ts`
- Test: `apps/office-server/test/company-vocabulary.test.ts`

**Interfaces:**
- Consumes: `Capability.kind` (Task 1).
- Produces: `Capability.company?: true`; in capabilities.ts `productVocabulary(): CapabilityVocabulary`, `useCompanyCapabilities(source: (() => Capability[]) | null): void`, `invalidateVocabulary(): void`, `TOOL_NAME: RegExp`, `productToolOwner(tool: string): string | null`; `capabilityVocabulary()` and `toolClass()` now see the company's active capabilities.

- [ ] **Step 1: Write the failing tests** — `test/company-vocabulary.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import type { Capability, Integration, IntegrationDesk } from '@cc/shared';
import { capabilityIds, capabilityKind, capabilityVocabulary, coverage, invalidateVocabulary, productToolOwner, productVocabulary, toolClass, unclassifiedTools, useCompanyCapabilities } from '../src/company/capabilities.ts';
import { classifyCall } from '../src/company/gate-policy.ts';
import { sessionDeny } from '../src/company/session-deny.ts';
import { DESK, testContext } from './gate-helpers.ts';

afterEach(() => useCompanyCapabilities(null));

const SMS = 'mcp__netgsm__send_sms';
const sms = (over: Partial<Capability> = {}): Capability => ({ id: 'sms.send', title: 'SMS gönderme', summary: 'Netgsm ile SMS gönderir.', kind: 'send', outward: true, builtin: [], tools: [SMS], company: true, ...over });
const ctx = testContext();

describe('the vocabulary with the company’s capabilities (spec capabilities §4.1)', () => {
  it('an active company capability follows the product’s; its tools are classified by its kind, a role may declare it, coverage counts it', () => {
    useCompanyCapabilities(() => [sms()]);
    const v = capabilityVocabulary();
    expect(v.version).toBe(3);
    expect(v.capabilities).toHaveLength(productVocabulary().capabilities.length + 1);
    expect(v.capabilities.at(-1)).toMatchObject({ id: 'sms.send', company: true });
    expect(toolClass(SMS)).toEqual({ kind: 'classified', capability: 'sms.send', outward: true });
    expect(capabilityKind('sms.send')).toBe('send');
    expect(classifyCall(SMS, { to: '05321112233', text: 'x' }, DESK, ctx).parts).toEqual([expect.objectContaining({ kind: 'send', capability: 'sms.send' })]);
    expect(capabilityIds(['sms.send', 'email.read'], 'Yetenekler')).toEqual(['sms.send', 'email.read']);
    expect(coverage([], ['sms.send'])[0]).toMatchObject({ id: 'sms.send', status: 'missing' });
    // The product's own never changes, and no product capability names the company's tool.
    expect(productVocabulary().capabilities.some((c) => c.id === 'sms.send')).toBe(false);
    expect(productToolOwner(SMS)).toBeNull();
    expect(productToolOwner('mcp__claude_ai_jeeta__jeeta_reallocate_budget')).toBe('ads.manage');
  });

  it('kept until told: a change is seen after invalidateVocabulary (the service calls it on every change)', () => {
    let list = [sms()];
    useCompanyCapabilities(() => list);
    expect(toolClass(SMS).kind).toBe('classified');
    list = [];
    expect(toolClass(SMS).kind).toBe('classified');
    invalidateVocabulary();
    expect(toolClass(SMS)).toEqual({ kind: 'unclassified', outward: true });
    expect(classifyCall(SMS, {}, DESK, ctx).parts[0]).toMatchObject({ kind: 'other' });
    expect(classifyCall(SMS, {}, DESK, ctx).parts[0]).not.toHaveProperty('capability');
  });

  it('a session closes a company capability’s outward tools unless its role declares it; a read one stays open; a classified tool is no longer listed unclassified', () => {
    useCompanyCapabilities(() => [sms(), sms({ id: 'sms.read', kind: 'read', outward: false, tools: ['mcp__netgsm__inbox'] })]);
    expect(sessionDeny({ capabilities: [], seen: [], closedServers: [] })).toContain(SMS);
    expect(sessionDeny({ capabilities: ['sms.send'], seen: [], closedServers: [] })).not.toContain(SMS);
    expect(sessionDeny({ capabilities: [], seen: ['mcp__netgsm__inbox'], closedServers: [] })).not.toContain('mcp__netgsm__inbox');
    const desk: IntegrationDesk = { employeeId: 'a', name: 'Ada', deskIndex: 0, status: 'connected', raw: 'connected', tools: 3, toolNames: [SMS, 'mcp__netgsm__inbox', 'mcp__netgsm__balance'], seenAt: 1, open: true, closedBy: null };
    const netgsm: Integration = { name: 'netgsm', kind: 'local_mcp', status: 'connected', registryClosed: false, desks: [desk], capabilities: [], authNeeded: null, costNote: null, note: null, registeredBy: null, registeredAt: null, firstSeen: null, lastSeen: null };
    expect(unclassifiedTools([netgsm])).toEqual([expect.objectContaining({ server: 'netgsm', unclassified: ['mcp__netgsm__balance'], atLeast: 1 })]);
  });

  it('a pay kind is pay at the gate; a connector known by name only is known by its tool once the company classifies one', () => {
    useCompanyCapabilities(() => [sms({ id: 'sms.credits', kind: 'pay', tools: ['mcp__netgsm__buy_credits'] }), sms({ id: 'slack.send', tools: ['mcp__claude_ai_Slack__send_message'] })]);
    expect(classifyCall('mcp__netgsm__buy_credits', {}, DESK, ctx).parts[0]).toMatchObject({ kind: 'pay', capability: 'sms.credits' });
    expect(capabilityVocabulary().knownConnectors.map((k) => k.name)).toEqual(['claude.ai Google Drive']);
    useCompanyCapabilities(null);
    expect(capabilityVocabulary().knownConnectors.map((k) => k.name)).toEqual(['claude.ai Slack', 'claude.ai Google Drive']);
    expect(toolClass('mcp__netgsm__buy_credits')).toEqual({ kind: 'unclassified', outward: true });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/company-vocabulary.test.ts`
Expected: FAIL — `useCompanyCapabilities` is not exported.

- [ ] **Step 3: `Capability.company`** — in `packages/shared/src/capability.ts`, `interface Capability`, after `tools: string[];`:

```ts
  /** Added by the company (custom_capabilities, spec capabilities §4), not shipped with the product. */
  company?: true;
```

- [ ] **Step 4: The merge layer** — in `src/company/capabilities.ts`:

Rename `const TOOL = …` to an export and use it in the parser:

```ts
/** A connector tool's full name (mcp__server__tool), as the vocabulary and a company capability write it. */
export const TOOL_NAME = /^mcp__[A-Za-z0-9_-]+__\S+$/;
```

(`if (!TOOL_NAME.test(tool)) …` in `parseCapabilities`). Replace everything from `let cached: CapabilityVocabulary | null = null;` through the end of `capabilityVocabulary()` with:

```ts
let product: CapabilityVocabulary | null = null;
/** The company's active capabilities (spec capabilities §4.1) as main.ts wires them; none until then, and in tests that do not. */
let companyCapabilities: () => Capability[] = () => [];
/** Bumped whenever the company's capabilities change: the next read builds the vocabulary and the tool table again. */
let generation = 0;
let built: { generation: number; vocabulary: CapabilityVocabulary; byTool: Map<string, Capability> } | null = null;

/** The product's vocabulary, read once from the file. */
export function productVocabulary(): CapabilityVocabulary {
  product ??= parseCapabilities(readFileSync(FILE, 'utf8'));
  return product;
}

/** Where the company's active capabilities come from (main.ts: the CustomCapabilities service); null: none (tests reset it). */
export function useCompanyCapabilities(source: (() => Capability[]) | null): void {
  companyCapabilities = source ?? (() => []);
  invalidateVocabulary();
}

/** The company's capabilities changed: the vocabulary and the tool table are built again on their next read. */
export function invalidateVocabulary(): void {
  generation += 1;
}

function current(): { vocabulary: CapabilityVocabulary; byTool: Map<string, Capability> } {
  if (built?.generation === generation) return built;
  const base = productVocabulary();
  const company = companyCapabilities();
  const capabilities = [...base.capabilities, ...company];
  const classified = (k: KnownConnector) => company.some((c) => c.tools.some((t) => t.startsWith(mcpToolPrefix(k.name))));
  built = {
    generation,
    // A connector the company classified a tool of is known by that tool now, not by its name only.
    vocabulary: { version: base.version, capabilities, knownConnectors: base.knownConnectors.filter((k) => !classified(k)) },
    byTool: new Map(capabilities.flatMap((c) => c.tools.map((t) => [t, c] as const))),
  };
  return built;
}

/** The vocabulary: the product's capabilities and, after them, the company's active ones (spec capabilities §4.1). */
export function capabilityVocabulary(): CapabilityVocabulary {
  return current().vocabulary;
}

/** The product capability that names this tool, or null. */
export function productToolOwner(tool: string): string | null {
  return productVocabulary().capabilities.find((c) => c.tools.includes(tool))?.id ?? null;
}
```

In `toolClass`, delete `let byTool: … = null;` and the `byTool ??= …` line, and read the table from the current build:

```ts
  const c = current().byTool.get(name);
```

Update the comment above `export type ToolClass` from "a capability names it" to "a capability — the product's or the company's active one — names it".

- [ ] **Step 5: Run the tests**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/company-vocabulary.test.ts test/capabilities.test.ts test/session-deny.test.ts test/gate-policy.test.ts test/integrations.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, whole server suite, commit**

Run: `cd ~/Projects/control-center-departments && pnpm -r typecheck && cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run` — Expected: PASS.

```bash
cd ~/Projects/control-center-departments
git add packages/shared/src/capability.ts apps/office-server/src/company/capabilities.ts apps/office-server/test/company-vocabulary.test.ts
git commit -m "feat(capabilities): the vocabulary is the product's and the company's active capabilities, rebuilt when they change"
```

---

### Task 4: The CustomCapabilities service

**Files:**
- Create: `apps/office-server/src/company/custom-capabilities.ts`
- Modify: `apps/office-server/src/company/notices.ts`
- Test: `apps/office-server/test/custom-capabilities.test.ts`

**Interfaces:**
- Consumes: `CustomCapabilityStore` (Task 2), `productVocabulary`, `productToolOwner`, `TOOL_NAME`, `invalidateVocabulary`, `useCompanyCapabilities` (Task 3).
- Produces:
  - `interface CustomCapabilitiesDeps { store: CustomCapabilityStore; roster: Roster; events: EventStore; notices: NoticeStore; coordinator: () => Employee | null; now?: () => number }`
  - `class CustomCapabilities` with `list(): CustomCapability[]`, `active(): CustomCapability[]`, `get(id: string): CustomCapability`, `propose(by: string, input: Record<string, unknown>): CustomCapability`, `ownerAdd(input: Record<string, unknown>): CustomCapability`, `decide(by: string, id: string, d: { accept: boolean; kind?: unknown; note?: unknown }): CustomCapability`, `retire(id: string, note?: unknown): CustomCapability` (the owner's), `setKind(id: string, kind: unknown): CustomCapability` (the owner's)
  - `asCapability(c: CustomCapability): Capability`, `coordinatorMayChange(from: CapabilityKind, to: CapabilityKind): boolean`
  - notice topics `capability.proposed` (decision), `capability.decided` (decision).

- [ ] **Step 1: Notice topics** — in `src/company/notices.ts`, `NOTICE_TOPICS`, after `'approval.decided': 'decision',`:

```ts
  /** Spec capabilities §4.2: someone proposed a capability for the vocabulary — accept it (with its kind) or reject it. */
  'capability.proposed': 'decision',
  /** Your proposed capability was decided; or the owner added, activated or retired one (put it on the roles that need it). */
  'capability.decided': 'decision',
```

- [ ] **Step 2: Write the failing tests** — `test/custom-capabilities.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER, type Employee } from '@cc/shared';
import { capabilityIds, toolClass, useCompanyCapabilities } from '../src/company/capabilities.ts';
import { asCapability, coordinatorMayChange, CustomCapabilities } from '../src/company/custom-capabilities.ts';
import { CustomCapabilityStore } from '../src/company/custom-capability-store.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
  useCompanyCapabilities(null);
});

const SMS = 'mcp__netgsm__send_sms';
const proposal = (over: Record<string, unknown> = {}) => ({ id: 'sms.send', title: 'SMS gönderme', summary: 'Netgsm ile müşteriye SMS gönderir.', kind: 'send', tools: [SMS], ...over });

function make() {
  let now = 1_000;
  const clock = () => now;
  const s = setup(8, clock);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, ['coder'], clock);
  const caps = new CustomCapabilities({ store: new CustomCapabilityStore(s.db), roster: s.roster, events: s.events, notices: c.notices, coordinator: () => c.company.coordinator(), now: clock });
  // As main.ts wires it.
  useCompanyCapabilities(() => caps.active().map(asCapability));
  const coordinator = c.company.hireCoordinator();
  const ada = c.company.hire(OWNER, { name: 'Ada', role: 'r' });
  const changes = () => s.events.list({ limit: 1000 }).filter((e) => e.event.type === 'capability.changed').map((e) => (e.event as { change: string }).change);
  const said = (who: Employee) => c.notices.pending(who.id).map((n) => `${n.topic}: ${n.text}`).join('\n');
  return { ...s, ...c, caps, coordinator, ada, changes, said, tick: (ms: number) => void (now += ms) };
}

describe('company capabilities — proposing and deciding (spec capabilities §4.2)', () => {
  it('an employee proposes; the coordinator hears and accepts it: active, in the vocabulary at once, the proposer told', () => {
    const t = make();
    const p = t.caps.propose(t.ada.id, proposal());
    expect(p).toMatchObject({ id: 'sms.send', status: 'proposed', kind: 'send', proposedBy: t.ada.id, decidedBy: null, createdAt: 1_000 });
    expect(toolClass(SMS)).toEqual({ kind: 'unclassified', outward: true });
    expect(t.said(t.coordinator)).toMatch(/capability\.proposed: Ada sözlüğe yeni bir yetenek önerdi: sms\.send — SMS gönderme \(gönderim; araçlar: mcp__netgsm__send_sms\)/);
    t.tick(500);
    expect(t.caps.decide(t.coordinator.id, 'sms.send', { accept: true })).toMatchObject({ status: 'active', decidedBy: t.coordinator.id, decidedAt: 1_500 });
    expect(toolClass(SMS)).toEqual({ kind: 'classified', capability: 'sms.send', outward: true });
    expect(capabilityIds(['sms.send'], 'Yetenekler')).toEqual(['sms.send']);
    expect(t.said(t.ada)).toMatch(/capability\.decided: Koordinatör önerdiğin sms\.send yeteneğini kabul etti \(gönderim\)/);
    expect(t.changes()).toEqual(['proposed', 'activated']);
  });

  it('the coordinator’s own proposal is the owner’s to decide (the doer is not the checker); no one else decides', () => {
    const t = make();
    t.caps.propose(t.coordinator.id, proposal());
    expect(t.said(t.coordinator)).not.toMatch(/capability\.proposed/);
    expect(() => t.caps.decide(t.coordinator.id, 'sms.send', { accept: true })).toThrow(/Kendi önerini karara bağlayamazsın/);
    expect(() => t.caps.decide(t.ada.id, 'sms.send', { accept: true })).toThrow(/koordinatör ya da sahibi/);
    expect(t.caps.decide(OWNER, 'sms.send', { accept: true })).toMatchObject({ status: 'active', decidedBy: OWNER });
    expect(t.said(t.coordinator)).toMatch(/capability\.decided: Sahibi önerdiğin sms\.send yeteneğini kabul etti/);
  });

  it('review focus 3: the coordinator never moves a pay or delete kind and never loosens an outward one; it keeps or tightens; the owner may do any', () => {
    const t = make();
    t.caps.propose(t.ada.id, proposal({ id: 'sms.credits', kind: 'pay', tools: ['mcp__netgsm__buy_credits'] }));
    expect(() => t.caps.decide(t.coordinator.id, 'sms.credits', { accept: true, kind: 'read' })).toThrow(/ödeme\/harcama türündeki bir yetenek başka bir türe yalnız sahibince çekilir/);
    expect(() => t.caps.decide(t.coordinator.id, 'sms.credits', { accept: true, kind: 'send' })).toThrow(/yalnız sahibince/);
    expect(t.caps.get('sms.credits')).toMatchObject({ status: 'proposed', kind: 'pay' });
    expect(t.caps.decide(t.coordinator.id, 'sms.credits', { accept: true })).toMatchObject({ status: 'active', kind: 'pay' });
    t.caps.propose(t.ada.id, proposal());
    expect(() => t.caps.decide(t.coordinator.id, 'sms.send', { accept: true, kind: 'read' })).toThrow(/Koordinatör türü yalnız sıkılaştırır/);
    expect(() => t.caps.decide(t.coordinator.id, 'sms.send', { accept: true, kind: 'publish' })).toThrow(/sıkılaştırır/);
    expect(t.caps.decide(t.coordinator.id, 'sms.send', { accept: true, kind: 'pay' })).toMatchObject({ kind: 'pay' });
    t.caps.propose(t.ada.id, proposal({ id: 'sms.read', kind: 'read', tools: ['mcp__netgsm__inbox'] }));
    expect(t.caps.decide(t.coordinator.id, 'sms.read', { accept: true, kind: 'send' })).toMatchObject({ kind: 'send' });
    // The owner may loosen, also an active one.
    expect(t.caps.setKind('sms.credits', 'read')).toMatchObject({ kind: 'read', decidedBy: OWNER });
    expect(toolClass('mcp__netgsm__buy_credits')).toEqual({ kind: 'classified', capability: 'sms.credits', outward: false });
    expect([coordinatorMayChange('delete', 'pay'), coordinatorMayChange('calendar', 'delete'), coordinatorMayChange('call', 'send'), coordinatorMayChange('read', 'call')]).toEqual([false, true, false, true]);
  });

  it('refuses what cannot be, saying why: a product id or tool (a pay tool as read), the office’s own, a tool another active one has, a bad id, kind or list; a rejected id may be proposed again', () => {
    const t = make();
    const bad: Array<[Record<string, unknown>, RegExp]> = [
      [proposal({ id: 'email.send' }), /email\.send ürünle gelen bir yetenek/],
      [proposal({ id: 'ads.cheap', kind: 'read', tools: ['mcp__claude_ai_jeeta__jeeta_reallocate_budget'] }), /ürünle gelen ads\.manage yeteneğinde/],
      [proposal({ tools: ['mcp__office__taskFinish'] }), /ofisin kendi aracı/],
      [proposal({ id: 'SMS.send' }), /alan\.eylem biçiminde/],
      [proposal({ kind: 'spend' }), /Tür \(kind\) şunlardan biri olmalı: read, send, calendar, call, publish, pay, delete/],
      [proposal({ tools: [] }), /en az bir bağlayıcı aracının/],
      [proposal({ tools: ['send_sms'] }), /bir bağlayıcı aracı değil/],
      [proposal({ title: ' ' }), /Başlık \(title\) boş olamaz/],
    ];
    for (const [input, error] of bad) expect(() => t.caps.propose(t.ada.id, input), String(error)).toThrow(error);
    expect(t.caps.list()).toEqual([]);
    t.caps.ownerAdd(proposal());
    expect(() => t.caps.propose(t.ada.id, proposal({ id: 'sms.bulk' }))).toThrow(/şirketin sms\.send yeteneğinde/);
    expect(() => t.caps.propose(t.ada.id, proposal({ tools: ['mcp__netgsm__other'] }))).toThrow(/sms\.send zaten etkin/);
    t.caps.propose(t.ada.id, proposal({ id: 'sms.read', kind: 'read', tools: ['mcp__netgsm__inbox'] }));
    expect(() => t.caps.decide(t.coordinator.id, 'sms.read', { accept: false })).toThrow(/Not boş olamaz/);
    t.caps.decide(t.coordinator.id, 'sms.read', { accept: false, note: 'gerek yok' });
    expect(t.said(t.ada)).toMatch(/capability\.decided: Koordinatör önerdiğin sms\.read yeteneğini reddetti: gerek yok/);
    expect(() => t.caps.decide(t.coordinator.id, 'sms.read', { accept: true })).toThrow(/karar beklemiyor/);
    expect(t.caps.propose(t.ada.id, proposal({ id: 'sms.read', kind: 'read', tools: ['mcp__netgsm__inbox'] }))).toMatchObject({ status: 'proposed', note: null, decidedBy: null });
  });

  it('the owner adds one (active at once, the coordinator told) and retires it: its tools are unclassified again', () => {
    const t = make();
    t.caps.ownerAdd(proposal());
    expect(toolClass(SMS).kind).toBe('classified');
    expect(t.said(t.coordinator)).toMatch(/capability\.decided: Sahibi sözlüğe sms\.send yeteneğini ekledi \(gönderim; araçlar: mcp__netgsm__send_sms\)/);
    expect(t.caps.retire('sms.send', 'Netgsm bitti')).toMatchObject({ status: 'retired', decidedBy: OWNER, note: 'Netgsm bitti' });
    expect(toolClass(SMS)).toEqual({ kind: 'unclassified', outward: true });
    expect(() => capabilityIds(['sms.send'], 'Yetenekler')).toThrow(/Bilinmeyen yetenek: sms\.send/);
    expect(t.said(t.coordinator)).toMatch(/capability\.decided: Sahibi sms\.send yeteneğini geri aldı \(Netgsm bitti\)/);
    expect(() => t.caps.retire('sms.send')).toThrow(/etkin değil/);
    expect(t.changes()).toEqual(['activated', 'retired']);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/custom-capabilities.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/company/custom-capabilities.ts`**

```ts
import {
  CAPABILITY_KIND_LABELS, CAPABILITY_KINDS, CUSTOM_CAPABILITY_STATUS_LABELS, OWNER,
  type Capability, type CapabilityChange, type CapabilityKind, type CustomCapability, type Employee,
} from '@cc/shared';
import { mcpToolPrefix } from '../claude/normalize.ts';
import { ConflictError, ForbiddenError, ValidationError } from '../errors.ts';
import type { EventStore } from '../event-store.ts';
import type { Roster } from '../roster.ts';
import { invalidateVocabulary, productToolOwner, productVocabulary, TOOL_NAME } from './capabilities.ts';
import type { CustomCapabilityStore } from './custom-capability-store.ts';
import type { NoticeStore } from './store.ts';
import { clean } from './text.ts';

/**
 * The company's own capabilities (spec 2026-10-13-capabilities-autonomy §4): an employee proposes, the coordinator
 * decides — the coordinator's own proposal is the owner's —, the owner adds, overrules and retires. The vocabulary is
 * the product's and the active ones (capabilities.ts); every change to an active one rebuilds it.
 */

const ID = /^[a-z]+\.[a-z]+$/;
const MAX_TOOLS = 30;
/** How strict a kind is at the gate: read passes, the policy's kinds may be the system's, pay and delete are always the owner's. */
const STRICTNESS: Record<CapabilityKind, number> = { read: 0, send: 1, calendar: 1, call: 1, publish: 1, pay: 2, delete: 2 };

export interface CustomCapabilitiesDeps {
  store: CustomCapabilityStore;
  roster: Roster;
  events: EventStore;
  notices: NoticeStore;
  coordinator: () => Employee | null;
  now?: () => number;
}

/** A company capability as the vocabulary carries it. */
export function asCapability(c: CustomCapability): Capability {
  return { id: c.id, title: c.title, summary: c.summary, kind: c.kind, outward: c.kind !== 'read', builtin: [], tools: c.tools, company: true };
}

/**
 * The coordinator keeps a proposal's kind or makes it stricter: read → any outward kind, any kind → pay or delete. Pay
 * and delete never move; loosening (an outward kind → read, or sideways among the policy's kinds) is the owner's.
 */
export function coordinatorMayChange(from: CapabilityKind, to: CapabilityKind): boolean {
  if (from === to) return true;
  if (STRICTNESS[from] === 2) return false;
  return STRICTNESS[to] === 2 || from === 'read';
}

function kindOf(value: unknown): CapabilityKind {
  if (typeof value !== 'string' || !(CAPABILITY_KINDS as readonly string[]).includes(value)) {
    throw new ValidationError(`Tür (kind) şunlardan biri olmalı: ${CAPABILITY_KINDS.join(', ')}.`);
  }
  return value as CapabilityKind;
}

const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export class CustomCapabilities {
  readonly #d: CustomCapabilitiesDeps;
  readonly #now: () => number;

  constructor(d: CustomCapabilitiesDeps) {
    this.#d = d;
    this.#now = d.now ?? Date.now;
  }

  list(): CustomCapability[] {
    return this.#d.store.list();
  }

  active(): CustomCapability[] {
    return this.#d.store.list({ statuses: ['active'] });
  }

  get(id: string): CustomCapability {
    return this.#d.store.get(id);
  }

  /** An employee's proposal: the coordinator hears and decides it — or, the coordinator's own, the owner. */
  propose(by: string, input: Record<string, unknown>): CustomCapability {
    const who = this.#d.roster.get(by);
    const c = this.#d.store.put({ ...this.#checked(input), status: 'proposed', proposedBy: who.id, decidedBy: null, note: null, createdAt: this.#now(), decidedAt: null });
    this.#emit(who.id, 'proposed', c);
    const coordinator = this.#d.coordinator();
    if (coordinator && coordinator.id !== who.id) {
      this.#d.notices.add(
        coordinator.id,
        'capability.proposed',
        `${who.name} sözlüğe yeni bir yetenek önerdi: ${c.id} — ${c.title} (${CAPABILITY_KIND_LABELS[c.kind]}; araçlar: ${c.tools.join(', ')}). Gerekçe: ${c.summary} ` +
          'capabilityDecide ile karara bağla: kabul ederken türü aynı bırakabilir ya da sıkılaştırabilirsin; reddederken note yaz.',
      );
    }
    return c;
  }

  /** The owner adds one from the Yetenekler tab: active at once. */
  ownerAdd(input: Record<string, unknown>): CustomCapability {
    const at = this.#now();
    const c = this.#d.store.put({ ...this.#checked(input), status: 'active', proposedBy: OWNER, decidedBy: OWNER, note: null, createdAt: at, decidedAt: at });
    this.#changed(null, 'activated', c);
    this.#tellCoordinator(`Sahibi sözlüğe ${c.id} yeteneğini ekledi (${CAPABILITY_KIND_LABELS[c.kind]}; araçlar: ${c.tools.join(', ')}). Gereken rollere editRoleCard capabilities ile ekle; araçları o kişilerin bir sonraki oturumunda açılır.`);
    return c;
  }

  /** The coordinator (anyone else's proposal) or the owner (any) accepts — with a kind — or rejects with a note. */
  decide(by: string, id: string, d: { accept: boolean; kind?: unknown; note?: unknown }): CustomCapability {
    const current = this.#d.store.get(id);
    if (current.status !== 'proposed') throw new ConflictError(`${id} karar beklemiyor (${CUSTOM_CAPABILITY_STATUS_LABELS[current.status]}).`);
    const owner = by === OWNER;
    if (!owner) {
      const who = this.#d.roster.get(by);
      if (who.kind !== 'coordinator') throw new ForbiddenError('Yetenek önerilerini koordinatör ya da sahibi karara bağlar.');
      // The doer is not the checker: the coordinator's own proposal waits for the owner.
      if (current.proposedBy === who.id) throw new ForbiddenError('Kendi önerini karara bağlayamazsın; sahibi Yetenekler sekmesinden karar verir.');
    }
    const note = clean(text(d.note), 'Not', 500, !d.accept) || null;
    const kind = d.kind === undefined || d.kind === null || d.kind === '' ? current.kind : kindOf(d.kind);
    if (!owner && !coordinatorMayChange(current.kind, kind)) {
      throw new ForbiddenError(
        STRICTNESS[current.kind] === 2
          ? `${CAPABILITY_KIND_LABELS[current.kind]} türündeki bir yetenek başka bir türe yalnız sahibince çekilir.`
          : `Koordinatör türü yalnız sıkılaştırır (okuma → dışa dönük bir tür; herhangi bir tür → ödeme ya da silme); ${current.kind} → ${kind} sahibinin kararıdır.`,
      );
    }
    // Another may have become active since the proposal: a tool still stands in one capability only.
    if (d.accept) this.#assertFree(current.tools, current.id);
    const decided = this.#d.store.update(id, { status: d.accept ? 'active' : 'rejected', kind, decidedBy: owner ? OWNER : by, note, decidedAt: this.#now() });
    if (d.accept) this.#changed(owner ? null : by, 'activated', decided);
    else this.#emit(owner ? null : by, 'rejected', decided);
    const decider = owner ? 'Sahibi' : 'Koordinatör';
    if (decided.proposedBy !== OWNER) {
      this.#d.notices.add(
        decided.proposedBy,
        'capability.decided',
        d.accept
          ? `${decider} önerdiğin ${decided.id} yeteneğini kabul etti (${CAPABILITY_KIND_LABELS[decided.kind]}). Kullanılması için rollere eklenmesi gerekir (koordinatör: editRoleCard capabilities); araçları o kişilerin bir sonraki oturumunda açılır.`
          : `${decider} önerdiğin ${decided.id} yeteneğini reddetti: ${note}`,
      );
    }
    if (owner && d.accept) {
      this.#tellCoordinator(`Sahibi ${decided.id} yeteneğini etkinleştirdi (${CAPABILITY_KIND_LABELS[decided.kind]}; araçlar: ${decided.tools.join(', ')}). Gereken rollere editRoleCard capabilities ile ekle.`, decided.proposedBy);
    }
    return decided;
  }

  /** The owner takes an active one back: its tools are unclassified again (the gate holds them, sessions close them). */
  retire(id: string, note?: unknown): CustomCapability {
    const current = this.#d.store.get(id);
    if (current.status !== 'active') throw new ConflictError(`${id} etkin değil (${CUSTOM_CAPABILITY_STATUS_LABELS[current.status]}).`);
    const why = clean(text(note), 'Not', 500, false);
    const retired = this.#d.store.update(id, { status: 'retired', decidedBy: OWNER, note: why || current.note, decidedAt: this.#now() });
    this.#changed(null, 'retired', retired);
    this.#tellCoordinator(`Sahibi ${id} yeteneğini geri aldı${why ? ` (${why})` : ''}: araçları yeniden sınıflandırılmamış sayılır — kapı tutar, oturumlar kapatır; rollerdeki ${id} artık hiçbir aracı açmaz.`);
    return retired;
  }

  /** The owner changes a proposed or active one's kind, any way (the coordinator gives a kind with decide). */
  setKind(id: string, kind: unknown): CustomCapability {
    const current = this.#d.store.get(id);
    if (current.status !== 'proposed' && current.status !== 'active') throw new ConflictError(`${id} ${CUSTOM_CAPABILITY_STATUS_LABELS[current.status]}; türü değiştirilemez.`);
    const next = kindOf(kind);
    if (next === current.kind) return current;
    if (current.status === 'proposed') {
      const changed = this.#d.store.update(id, { kind: next });
      this.#emit(null, 'kind', changed);
      return changed;
    }
    const changed = this.#d.store.update(id, { kind: next, decidedBy: OWNER, decidedAt: this.#now() });
    this.#changed(null, 'kind', changed);
    return changed;
  }

  #checked(input: Record<string, unknown>): Pick<CustomCapability, 'id' | 'title' | 'summary' | 'kind' | 'tools'> {
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!ID.test(id)) throw new ValidationError(`Kimlik alan.eylem biçiminde olmalı (küçük harf, ör. sms.send): “${id}”.`);
    if (productVocabulary().capabilities.some((c) => c.id === id)) throw new ValidationError(`${id} ürünle gelen bir yetenek; başka bir kimlik seç.`);
    const existing = this.#d.store.find(id);
    if (existing && (existing.status === 'proposed' || existing.status === 'active')) throw new ConflictError(`${id} zaten ${CUSTOM_CAPABILITY_STATUS_LABELS[existing.status]}.`);
    const title = clean(text(input.title), 'Başlık (title)', 80, true);
    const summary = clean(text(input.summary), 'Açıklama (summary)', 300, true);
    const kind = kindOf(input.kind);
    if (!Array.isArray(input.tools) || input.tools.length === 0 || input.tools.some((t) => typeof t !== 'string')) {
      throw new ValidationError('Araçlar (tools) en az bir bağlayıcı aracının tam adından oluşan bir liste olmalı (mcp__sunucu__araç).');
    }
    const tools = [...new Set((input.tools as string[]).map((t) => t.trim()))];
    if (tools.length > MAX_TOOLS) throw new ValidationError(`Bir yetenekte en çok ${MAX_TOOLS} araç olur.`);
    for (const tool of tools) {
      if (!TOOL_NAME.test(tool)) throw new ValidationError(`“${tool}” bir bağlayıcı aracı değil (mcp__sunucu__araç).`);
      if (tool.startsWith(mcpToolPrefix('office'))) throw new ValidationError(`“${tool}” ofisin kendi aracı; yetenek sözlüğüne girmez.`);
    }
    this.#assertFree(tools, id);
    return { id, title, summary, kind, tools };
  }

  /** A tool stands in one capability only: not in the product's (whatever kind is proposed), not in another active company one. */
  #assertFree(tools: string[], id: string): void {
    for (const tool of tools) {
      const product = productToolOwner(tool);
      if (product) throw new ValidationError(`“${tool}” ürünle gelen ${product} yeteneğinde; bir araç yalnız bir yetenekte durur.`);
      const other = this.active().find((c) => c.id !== id && c.tools.includes(tool));
      if (other) throw new ConflictError(`“${tool}” şirketin ${other.id} yeteneğinde; bir araç yalnız bir yetenekte durur.`);
    }
  }

  #tellCoordinator(line: string, except?: string): void {
    const coordinator = this.#d.coordinator();
    if (coordinator && coordinator.id !== except) this.#d.notices.add(coordinator.id, 'capability.decided', line);
  }

  /** An active capability changed: the vocabulary is built again on its next read. */
  #changed(by: string | null, change: CapabilityChange, c: CustomCapability): void {
    invalidateVocabulary();
    this.#emit(by, change, c);
  }

  #emit(by: string | null, change: CapabilityChange, c: CustomCapability): void {
    this.#d.events.append(by, { type: 'capability.changed', change, capability: c });
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/custom-capabilities.test.ts test/company-vocabulary.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, whole server suite, commit**

Run: `cd ~/Projects/control-center-departments && pnpm -r typecheck && cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run` — Expected: PASS.

```bash
cd ~/Projects/control-center-departments
git add apps/office-server/src/company/custom-capabilities.ts apps/office-server/src/company/notices.ts apps/office-server/test/custom-capabilities.test.ts
git commit -m "feat(capabilities): company capabilities — an employee proposes, the coordinator decides (kinds only tightened, pay and delete never moved), the owner adds, overrules and retires"
```

---

### Task 5: The capability tools and the owner's capability API

**Files:**
- Modify: `apps/office-server/src/mcp/tools.ts`, `apps/office-server/src/company/capabilities.ts`, `apps/office-server/src/company/custom-capabilities.ts`, `apps/office-server/src/api.ts`
- Test: `apps/office-server/test/custom-capabilities.test.ts`, `apps/office-server/test/custom-capabilities-api.test.ts`

**Interfaces:**
- Consumes: `CustomCapabilities` (Task 4).
- Produces: `officeTools({ …, capabilities?: CustomCapabilities })`; tools `capabilityPropose` (everyone), `capabilityDecide` (coordinator); `capabilitiesRead` lists the company's own; `customCapabilityLines(list: CustomCapability[], nameOf: (id: string) => string): string[]`; `coverageLines` marks a company capability "(şirketin)"; `ApiDeps.company.capabilities?: CustomCapabilities`; routes `GET /api/custom-capabilities`, `POST /api/custom-capabilities`, `POST /api/custom-capabilities/:id/(accept|reject|retire|kind)`.

- [ ] **Step 1: Write the failing tool test** — append to `test/custom-capabilities.test.ts` (add the imports `import { officeTools } from '../src/mcp/tools.ts';` and `import { IntegrationRegistry } from '../src/company/integrations.ts';`):

```ts
describe('company capabilities — the tools (spec capabilities §4.2)', () => {
  it('capabilityPropose (everyone), capabilityDecide (the coordinator), capabilitiesRead shows the company’s own; a role card takes the new one', async () => {
    const t = make();
    const integrations = new IntegrationRegistry({ db: t.db, roster: t.roster, events: t.events });
    const tools = officeTools({
      company: t.company, roster: t.roster, tasks: t.tasks, characters: () => ['coder'], memory: t.memory, budget: t.budget,
      engine: { sleep: async () => undefined, wake: () => undefined, sideQuestion: async () => ({ ok: true, answer: '' }) },
      plans: () => t.plans.list(), agenda: { text: () => '' }, integrations, capabilities: t.caps,
    });
    const call = async (who: Employee, name: string, args: Record<string, unknown> = {}) => {
      const tool = tools.find((x) => x.name === name)!;
      if (!tool.kinds.includes(t.roster.get(who.id).kind)) throw new Error(`${name} not offered to ${who.kind}`);
      return String(await tool.run({ employee: t.roster.get(who.id) } as never, args));
    };
    expect(await call(t.ada, 'capabilityPropose', proposal())).toBe('Yetenek önerildi: sms.send (gönderim). Koordinatör karara bağlayacak.');
    await expect(call(t.ada, 'capabilityDecide', { id: 'sms.send', decision: 'accept' })).rejects.toThrow(/not offered/);
    const before = await call(t.coordinator, 'capabilitiesRead');
    expect(before).toContain('## Şirketin eklediği yetenekler');
    expect(before).toContain('• sms.send — SMS gönderme [karar bekliyor] tür: gönderim; araçlar: mcp__netgsm__send_sms; öneren Ada');
    expect(await call(t.coordinator, 'capabilityDecide', { id: 'sms.send', decision: 'accept', kind: 'pay' })).toBe(
      'sms.send etkin (ödeme/harcama); sahibi Yetenekler sekmesinde görür. Gereken rollere editRoleCard capabilities ile ekle.',
    );
    const after = await call(t.ada, 'capabilitiesRead');
    expect(after).toContain('# Yetenek sözlüğü (25 yetenek, sürüm 3; 1 şirketin) — ofisteki karşılığı; salt okunur, hiçbir bağlayıcı çağrılmadı.');
    expect(after).toContain('• sms.send — SMS gönderme (şirketin) (dışa dönük) [yok] sağlayan bağlantı yok');
    expect(after).toContain('• sms.send — SMS gönderme [etkin] tür: ödeme/harcama; araçlar: mcp__netgsm__send_sms; öneren Ada, karar Koordinatör');
    expect(await call(t.coordinator, 'capabilityPropose', proposal({ id: 'wa.send', tools: ['mcp__wa__send'] }))).toBe('Yetenek önerildi: wa.send (gönderim). Kendi önerin sahibine gider; Yetenekler sekmesinden karar verecek.');
    await expect(call(t.coordinator, 'capabilityDecide', { id: 'wa.send', decision: 'maybe' })).rejects.toThrow(/accept ya da reject/);
    await expect(call(t.coordinator, 'capabilityDecide', { id: 'wa.send', decision: 'accept' })).rejects.toThrow(/Kendi önerini karara bağlayamazsın/);
    expect(await call(t.coordinator, 'editRoleCard', { employee: 'Ada', capabilities: ['sms.send'] })).toMatch(/Yetenekler: sms\.send \[yok\]/);
  });
});
```

- [ ] **Step 2: Write the failing API test** — `test/custom-capabilities-api.test.ts`:

```ts
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER } from '@cc/shared';
import { createApi } from '../src/api.ts';
import { useCompanyCapabilities } from '../src/company/capabilities.ts';
import { asCapability, CustomCapabilities } from '../src/company/custom-capabilities.ts';
import { CustomCapabilityStore } from '../src/company/custom-capability-store.ts';
import { IntegrationRegistry } from '../src/company/integrations.ts';
import { QuotaTracker } from '../src/quota.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { pageHeaders } from './owner-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
  useCompanyCapabilities(null);
});

async function start() {
  const s = setup();
  const f = fakeEngine(s);
  const c = companyFor(s, f, ['coder']);
  const capabilities = new CustomCapabilities({ store: new CustomCapabilityStore(s.db), roster: s.roster, events: s.events, notices: c.notices, coordinator: () => c.company.coordinator() });
  useCompanyCapabilities(() => capabilities.active().map(asCapability));
  const integrations = new IntegrationRegistry({ db: s.db, roster: s.roster, events: s.events });
  const api = createApi(
    {
      engine: f.engine, roster: s.roster, events: s.events, quota: new QuotaTracker(s.db, s.events),
      company: { service: c.company, tasks: c.tasks, plans: c.plans, memory: c.memory, budget: c.budget, proposals: c.proposals, integrations, capabilities },
    },
    { allowedOrigins: [] },
  );
  await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', resolve));
  const port = (api.server.address() as AddressInfo).port;
  cleanups.push(() => api.close(), f.cleanup, s.cleanup);
  return { port, ...c, capabilities };
}

/** As the office page sends it (pageHeaders), unless `page: false` (a request from outside the page). */
async function call(port: number, method: string, path: string, body?: unknown, o: { page?: boolean } = {}): Promise<{ status: number; body: any }> {
  const page = method === 'GET' || o.page === false ? {} : await pageHeaders(port);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...page } }, (res) => {
      let data = '';
      res.on('data', (x) => (data += x));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    if (method === 'POST') req.write(JSON.stringify(body ?? {}));
    req.end();
  });
}

describe('the owner’s capability API (spec capabilities §4.2, §9)', () => {
  it('adds one (active at once), lists them, accepts a proposal with a kind, rejects with a note, changes a kind, retires; without the page’s nonce it is refused', async () => {
    const t = await start();
    t.company.hireCoordinator();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const added = await call(t.port, 'POST', '/api/custom-capabilities', { id: 'sms.send', title: 'SMS gönderme', summary: 'Netgsm ile SMS.', kind: 'send', tools: ['mcp__netgsm__send_sms'] });
    expect(added).toMatchObject({ status: 201, body: { id: 'sms.send', status: 'active', proposedBy: OWNER, decidedBy: OWNER } });
    expect((await call(t.port, 'GET', '/api/capabilities')).body.capabilities.at(-1)).toMatchObject({ id: 'sms.send', kind: 'send', outward: true, company: true });
    t.capabilities.propose(ada.id, { id: 'sms.read', title: 'SMS okuma', summary: 'Gelen SMS.', kind: 'read', tools: ['mcp__netgsm__inbox'] });
    t.capabilities.propose(ada.id, { id: 'sms.credits', title: 'SMS kredisi', summary: 'Kredi alır.', kind: 'pay', tools: ['mcp__netgsm__buy_credits'] });
    expect((await call(t.port, 'GET', '/api/custom-capabilities')).body.map((x: { id: string; status: string }) => `${x.id}:${x.status}`)).toEqual(['sms.send:active', 'sms.read:proposed', 'sms.credits:proposed']);
    expect((await call(t.port, 'POST', '/api/custom-capabilities/sms.read/accept', { kind: 'send' })).body).toMatchObject({ status: 'active', kind: 'send', decidedBy: OWNER });
    expect((await call(t.port, 'POST', '/api/custom-capabilities/sms.credits/reject', {})).status).toBe(400);
    expect((await call(t.port, 'POST', '/api/custom-capabilities/sms.credits/reject', { note: 'Kredi elle alınır.' })).body).toMatchObject({ status: 'rejected', note: 'Kredi elle alınır.' });
    expect((await call(t.port, 'POST', '/api/custom-capabilities/sms.read/kind', { kind: 'read' })).body).toMatchObject({ kind: 'read' });
    expect((await call(t.port, 'POST', '/api/custom-capabilities/sms.send/retire', {})).body).toMatchObject({ status: 'retired' });
    expect((await call(t.port, 'POST', '/api/custom-capabilities/sms.send/retire', {})).status).toBe(409);
    expect((await call(t.port, 'POST', '/api/custom-capabilities', { id: 'email.send', title: 'X', summary: 's', kind: 'send', tools: ['mcp__x__y'] })).body.error).toMatch(/ürünle gelen/);
    expect((await call(t.port, 'POST', '/api/custom-capabilities', { id: 'x.y', title: 'X', summary: 's', kind: 'read', tools: ['mcp__x__y'] }, { page: false })).status).toBe(403);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/custom-capabilities.test.ts test/custom-capabilities-api.test.ts`
Expected: FAIL — no tool `capabilityPropose`; the routes answer 404.

- [ ] **Step 4: `coverageLines` marks the company's own** — in `src/company/capabilities.ts`, `coverageLines`:

```ts
    const what = def ? `${def.title}${def.company ? ' (şirketin)' : ''}${def.outward ? ' (dışa dönük)' : ''}` : 'sözlükte yok';
```

- [ ] **Step 5: `customCapabilityLines`** — append to `src/company/custom-capabilities.ts`:

```ts
/** capabilitiesRead's section on the company's own: those waiting for a decision and those active (spec §4.2). */
export function customCapabilityLines(list: CustomCapability[], nameOf: (id: string) => string): string[] {
  const shown = list.filter((c) => c.status === 'proposed' || c.status === 'active');
  if (shown.length === 0) return [];
  return [
    '',
    '## Şirketin eklediği yetenekler — öneren çalışan; karar koordinatörün (kendi önerisi sahibinin); para ve silme türünü yalnız sahibi değiştirir',
    ...shown.map(
      (c) => `• ${c.id} — ${c.title} [${CUSTOM_CAPABILITY_STATUS_LABELS[c.status]}] tür: ${CAPABILITY_KIND_LABELS[c.kind]}; araçlar: ${c.tools.join(', ')}; öneren ${nameOf(c.proposedBy)}${c.decidedBy ? `, karar ${nameOf(c.decidedBy)}` : ''}`,
    ),
  ];
}
```

- [ ] **Step 6: The tools** — in `src/mcp/tools.ts`:

Add `CAPABILITY_KINDS, CAPABILITY_KIND_LABELS` to the `@cc/shared` import; `import { customCapabilityLines, type CustomCapabilities } from '../company/custom-capabilities.ts';` (a value and a type import from the same module). In the `officeTools` parameter type, after `departments?: …`:

```ts
  /** The company's own capabilities (spec capabilities §4: capabilityPropose, capabilityDecide); absent: neither, and capabilitiesRead shows none. */
  capabilities?: CustomCapabilities;
```

In `capabilitiesRead`'s vocabulary branch (no `employee`, no `task`) replace the returned array with:

```ts
        const v = capabilityVocabulary();
        const own = v.capabilities.filter((c) => c.company).length;
        return [
          `# Yetenek sözlüğü (${v.capabilities.length} yetenek, sürüm ${v.version}${own ? `; ${own} şirketin` : ''}) — ofisteki karşılığı; salt okunur, hiçbir bağlayıcı çağrılmadı.`,
          ...coverageLines(coverage(registry, v.capabilities.map((c) => c.id)), false),
          ...customCapabilityLines(o.capabilities?.list() ?? [], (id) => company.nameOf(id)),
          ...knownConnectorLines(),
          ...unclassifiedLines(registry),
        ].join('\n');
```

After the `capabilitiesRead` tool, add:

```ts
    {
      name: 'capabilityPropose',
      description: `Propose a capability for the company's vocabulary. A connector tool no capability names is unclassified: outward, held by the gate, closed in every session — capabilitiesRead lists them. Give an id (area.action, lowercase, e.g. sms.send), a Turkish title and summary (what it does and why the company needs it), its kind (${CAPABILITY_KINDS.join(', ')}: read only reads, every other kind goes outward) and the connector tools it is made of, by full name (mcp__server__tool). The coordinator decides it; the coordinator's own proposal goes to the owner. Once active, a role needs it on its card (editRoleCard) for its tools to open in that person's next session.`,
      inputSchema: object(
        { id: s('area.action, lowercase, e.g. sms.send.'), title: s('Short Turkish title.'), summary: s('What it does and why, in Turkish.'), kind: { type: 'string', enum: [...CAPABILITY_KINDS] }, tools: strings('Connector tools by full name (mcp__server__tool).') },
        ['id', 'title', 'summary', 'kind', 'tools'],
      ),
      kinds: EVERYONE,
      run: ({ employee }, args) => {
        if (!o.capabilities) throw new ConflictError('Bu ofiste şirket yetenekleri yok.');
        const c = o.capabilities.propose(employee.id, { id: args.id, title: args.title, summary: args.summary, kind: args.kind, tools: args.tools });
        const next = employee.kind === 'coordinator' ? 'Kendi önerin sahibine gider; Yetenekler sekmesinden karar verecek.' : 'Koordinatör karara bağlayacak.';
        return `Yetenek önerildi: ${c.id} (${CAPABILITY_KIND_LABELS[c.kind]}). ${next}`;
      },
    },
    {
      name: 'capabilityDecide',
      description: 'Decide a capability someone proposed (coordinator; your own proposal is the owner’s). accept keeps its kind or makes it stricter — read → an outward kind, any kind → pay or delete; pay and delete never move, and loosening is the owner’s — and it is in the vocabulary at once; then put it on the roles that need it with editRoleCard. reject needs a note.',
      inputSchema: object(
        {
          id: s('The proposed capability’s id.'),
          decision: { type: 'string', enum: ['accept', 'reject'] },
          kind: { type: 'string', enum: [...CAPABILITY_KINDS], description: 'The kind to activate it with (default: as proposed).' },
          note: s('Why (required to reject).'),
        },
        ['id', 'decision'],
      ),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        if (!o.capabilities) throw new ConflictError('Bu ofiste şirket yetenekleri yok.');
        const decision = str(args, 'decision');
        if (decision !== 'accept' && decision !== 'reject') throw new ValidationError('decision accept ya da reject olmalı.');
        const c = o.capabilities.decide(employee.id, str(args, 'id').trim(), { accept: decision === 'accept', kind: optStr(args, 'kind'), note: optStr(args, 'note') });
        return c.status === 'active'
          ? `${c.id} etkin (${CAPABILITY_KIND_LABELS[c.kind]}); sahibi Yetenekler sekmesinde görür. Gereken rollere editRoleCard capabilities ile ekle.`
          : `${c.id} reddedildi.`;
      },
    },
```

- [ ] **Step 7: The API** — in `src/api.ts`:

`import type { CustomCapabilities } from './company/custom-capabilities.ts';`; in `ApiDeps.company`, after `approvals?: Approvals;`:

```ts
    /** The company's own capabilities (spec capabilities §4): the owner adds, decides, re-kinds and retires them. */
    capabilities?: CustomCapabilities;
```

Next to the other route constants:

```ts
const CUSTOM_CAPABILITY_ROUTE = /^\/api\/custom-capabilities\/([a-z]+\.[a-z]+)\/(accept|reject|retire|kind)$/;
```

Inside `if (d.company) { … }`, right after the `/api/capabilities` route:

```ts
    // The company's own capabilities (spec capabilities §4.2): reading is free; every change has passed the owner guard.
    const custom = d.company.capabilities;
    if (custom) {
      if (method === 'GET' && url.pathname === '/api/custom-capabilities') return sendJson(res, 200, custom.list());
      if (method === 'POST' && url.pathname === '/api/custom-capabilities') {
        const body = await readJson(req);
        if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ValidationError('Geçersiz istek gövdesi.');
        return sendJson(res, 201, custom.ownerAdd(body as Record<string, unknown>));
      }
      const route = CUSTOM_CAPABILITY_ROUTE.exec(url.pathname);
      if (method === 'POST' && route) {
        const id = route[1] ?? '';
        const body = ((await readJson(req)) ?? {}) as { kind?: unknown; note?: unknown };
        if (route[2] === 'retire') return sendJson(res, 200, custom.retire(id, body.note));
        if (route[2] === 'kind') return sendJson(res, 200, custom.setKind(id, body.kind));
        // A rejection needs a note (decide refuses one without): the page sends "Sahibi reddetti." when the owner writes none.
        return sendJson(res, 200, custom.decide(OWNER, id, { accept: route[2] === 'accept', kind: body.kind, note: body.note }));
      }
    }
```

- [ ] **Step 8: Run the tests**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/custom-capabilities.test.ts test/custom-capabilities-api.test.ts test/capabilities.test.ts test/company-api.test.ts test/owner-guard.test.ts`
Expected: PASS.

- [ ] **Step 9: Typecheck, whole server suite, commit**

Run: `cd ~/Projects/control-center-departments && pnpm -r typecheck && cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run` — Expected: PASS.

```bash
cd ~/Projects/control-center-departments
git add apps/office-server/src/mcp/tools.ts apps/office-server/src/company/capabilities.ts apps/office-server/src/company/custom-capabilities.ts apps/office-server/src/api.ts apps/office-server/test/custom-capabilities.test.ts apps/office-server/test/custom-capabilities-api.test.ts
git commit -m "feat(capabilities): capabilityPropose, capabilityDecide and the company's own in capabilitiesRead; the owner's capability API"
```

---

### Task 6: The constitution — the outward policy and its five rules

**Files:**
- Modify: `packages/shared/src/budget.ts`, `apps/office-server/src/company/budget.ts`, `apps/office-web/src/ui/BudgetTabs.test.tsx`, `apps/office-web/src/ui/PlanCard.test.tsx`, `apps/office-web/src/store/reducers.test.ts`
- Test: `apps/office-server/test/budget.test.ts`

**Interfaces:**
- Consumes: `OutwardPolicy`, `OUTWARD_POLICY_KINDS`, `OUTWARD_DECIDERS` (Task 2).
- Produces: `Constitution.outwardPolicy: OutwardPolicy`, `.specialContacts: string[]`, `.sendsPerHour: number`, `.bulkRecipients: number`, `.callHours: [number, number]`, `.callsPerDay: number` with their defaults; `normalizeConstitution` reads them; `Budget.setConstitution` validates them; `constitutionChanges` names them.

- [ ] **Step 1: Write the failing tests** — in `test/budget.test.ts`, inside `describe('Budget — constitution', …)`:

```ts
  it('spec capabilities §5–§6: the outward policy and its rules — the owner’s defaults, also in a database before them; the gate stays as it was', () => {
    const t = make();
    expect(DEFAULT_CONSTITUTION).toMatchObject({
      gateEnabled: false, outwardPolicy: { send: 'system', publish: 'system', call: 'system', calendar: 'owner' },
      specialContacts: [], sendsPerHour: 30, bulkRecipients: 5, callHours: [9, 19], callsPerDay: 20,
    });
    expect(t.budget.constitution()).toMatchObject({ gateEnabled: false, outwardPolicy: DEFAULT_CONSTITUTION.outwardPolicy, sendsPerHour: 30, callHours: [9, 19] });
    const next = t.budget.setConstitution({
      outwardPolicy: { calendar: 'system', send: 'owner' }, specialContacts: [' ali@firma.com ', '', 'ALI@firma.com', '+90 532 111 22 33'],
      sendsPerHour: 10, bulkRecipients: 3, callHours: [10, 18], callsPerDay: 0,
    });
    expect(next).toMatchObject({
      outwardPolicy: { send: 'owner', publish: 'system', call: 'system', calendar: 'system' }, specialContacts: ['ali@firma.com', '+90 532 111 22 33'],
      sendsPerHour: 10, bulkRecipients: 3, callHours: [10, 18], callsPerDay: 0, gateEnabled: false,
    });
    expect(Object.keys(next.outwardPolicy)).toEqual(['send', 'publish', 'call', 'calendar']);
  });

  it('review focus: refuses a wrong policy, contact list, call hours or rule, changing nothing', () => {
    const t = make();
    for (const bad of [
      { outwardPolicy: { pay: 'system' } }, { outwardPolicy: { send: 'auto' } }, { outwardPolicy: 'system' },
      { specialContacts: 'ali@firma.com' }, { specialContacts: [3] }, { specialContacts: Array.from({ length: 201 }, (_, i) => `k${i}`) }, { specialContacts: ['x'.repeat(201)] },
      { callHours: [19, 9] }, { callHours: [9] }, { callHours: [9, 25] }, { callHours: [9.5, 19] }, { callHours: '9, 19' },
      { sendsPerHour: -1 }, { sendsPerHour: 1.5 }, { bulkRecipients: 0 }, { callsPerDay: 1001 }, { callsPerDay: '20' },
    ]) {
      expect(() => t.budget.setConstitution(bad), JSON.stringify(bad)).toThrow(/Anayasa/);
    }
    expect(t.budget.constitution()).toMatchObject({ outwardPolicy: DEFAULT_CONSTITUTION.outwardPolicy, specialContacts: [], callHours: [9, 19], sendsPerHour: 30, bulkRecipients: 5, callsPerDay: 20 });
  });

  it('normalizeConstitution: a partial or broken policy keeps what is valid in its order; broken contacts and hours are the defaults', () => {
    expect(normalizeConstitution({ outwardPolicy: { calendar: 'system', send: 'nobody', pay: 'system' }, specialContacts: 'x', callHours: [9] })).toMatchObject({
      outwardPolicy: { send: 'system', publish: 'system', call: 'system', calendar: 'system' }, specialContacts: [], callHours: [9, 19],
    });
    expect(Object.keys(normalizeConstitution({ outwardPolicy: { calendar: 'owner', send: 'owner' } }).outwardPolicy)).toEqual(['send', 'publish', 'call', 'calendar']);
    expect(Object.keys(normalizeConstitution({})).slice(-6)).toEqual(['outwardPolicy', 'specialContacts', 'sendsPerHour', 'bulkRecipients', 'callHours', 'callsPerDay']);
  });
```

and inside `describe('Budget — the owner’s constitution change reaches the coordinator', …)`:

```ts
  it('constitutionChanges names the policy, the contacts, the rules and the call hours in the constitution’s order', () => {
    const after = { ...DEFAULT_CONSTITUTION, outwardPolicy: { ...DEFAULT_CONSTITUTION.outwardPolicy, calendar: 'system' as const }, specialContacts: ['ali@firma.com'], sendsPerHour: 10, callHours: [10, 18] as [number, number] };
    expect(constitutionChanges(DEFAULT_CONSTITUTION, after)).toEqual([
      'Otonomi politikası gönderim sistem, yayın sistem, arama sistem, takvim sahibine → gönderim sistem, yayın sistem, arama sistem, takvim sistem',
      'Özel kişiler yok → ali@firma.com',
      'Saatlik gönderim sınırı 30 → 10',
      'Arama saatleri 9–19 → 10–18',
    ]);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/budget.test.ts`
Expected: FAIL — `DEFAULT_CONSTITUTION` has no `outwardPolicy`; `setConstitution` refuses "Bilinmeyen anayasa maddesi: outwardPolicy".

- [ ] **Step 3: Shared** — in `packages/shared/src/budget.ts`:

Add `import { OUTWARD_DECIDERS, OUTWARD_POLICY_KINDS, type OutwardPolicy } from './autonomy.ts';`. In `interface Constitution`, after `maxSchedules: number;`:

```ts
  /**
   * Spec capabilities §5: for each outward kind of a connector's call, whether the owner is asked or the system lets it
   * out on the rules below — only while the gate is on. Pay, delete, the browser, the office itself and unclassified
   * tools are always the owner's; so are the sends and publishes of the shell and the built-in tools.
   */
  outwardPolicy: OutwardPolicy;
  /** People whose every call goes to the owner: e-mails, phone numbers, user names (compared folded, a phone by its digits). */
  specialContacts: string[];
  /** System sends + publishes per department (someone without one: per person) in the last hour, at most. */
  sendsPerHour: number;
  /** A call to more recipients than this goes to the owner. */
  bulkRecipients: number;
  /** Local hours [from, to) the system may call in. */
  callHours: [number, number];
  /** System calls per department (someone without one: per person) today, at most. */
  callsPerDay: number;
```

In `DEFAULT_CONSTITUTION`, after `maxSchedules: 20,`:

```ts
  outwardPolicy: { send: 'system', publish: 'system', call: 'system', calendar: 'owner' },
  specialContacts: [],
  sendsPerHour: 30,
  bulkRecipients: 5,
  callHours: [9, 19],
  callsPerDay: 20,
```

After `modelMapOf`:

```ts
/** The outward policy with every kind, in its order: the given decider where it is one, else the default. */
function policyOf(value: unknown): OutwardPolicy {
  const given = isRecord(value) ? value : {};
  const valid = (v: unknown) => (OUTWARD_DECIDERS as readonly unknown[]).includes(v);
  return Object.fromEntries(OUTWARD_POLICY_KINDS.map((k) => [k, Object.hasOwn(given, k) && valid(given[k]) ? given[k] : DEFAULT_CONSTITUTION.outwardPolicy[k]])) as OutwardPolicy;
}
```

In `normalizeConstitution`'s loop, replace the `if … else …` with:

```ts
    if (key === 'coordinatorModels' || key === 'difficultyModels') out[key] = modelMapOf(value, DEFAULT_CONSTITUTION[key]);
    else if (key === 'outwardPolicy') out[key] = policyOf(value);
    else if (key === 'specialContacts') out[key] = Array.isArray(value) && value.every((x) => typeof x === 'string') ? value : [];
    else if (key === 'callHours') out[key] = Array.isArray(value) && value.length === 2 && value.every((h) => Number.isInteger(h)) ? value : [...DEFAULT_CONSTITUTION.callHours];
    else out[key] = value === undefined ? DEFAULT_CONSTITUTION[key] : value;
```

- [ ] **Step 4: The server's rules** — in `apps/office-server/src/company/budget.ts`:

Add `OUTWARD_DECIDERS, OUTWARD_POLICY_KINDS, fold, type OutwardPolicy, type OutwardPolicyKind` to the `@cc/shared` import. Change `NumberKey`:

```ts
type NumberKey = Exclude<keyof Constitution, 'digestHours' | 'coordinatorModels' | 'difficultyModels' | 'autonomy' | 'outwardPolicy' | 'specialContacts' | 'callHours' | SwitchKey>;
```

Add to `RULES`, after `maxSchedules`:

```ts
  sendsPerHour: { label: 'Saatlik gönderim sınırı', min: 0, max: () => 1000, integer: true },
  bulkRecipients: { label: 'Toplu gönderim eşiği (alıcı)', min: 1, max: () => 1000, integer: true },
  callsPerDay: { label: 'Günlük arama sınırı', min: 0, max: () => 1000, integer: true },
```

After `digestHours(…)`:

```ts
const POLICY_LABELS: Record<OutwardPolicyKind, string> = { send: 'gönderim', publish: 'yayın', call: 'arama', calendar: 'takvim' };

/** A change to the outward policy: known kinds, owner or system; the kinds not given stay as they are. */
function outwardPolicy(value: unknown, current: OutwardPolicy): OutwardPolicy {
  const ok =
    typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.entries(value).every(([k, v]) => (OUTWARD_POLICY_KINDS as readonly string[]).includes(k) && (OUTWARD_DECIDERS as readonly unknown[]).includes(v));
  if (!ok) throw new ValidationError(`Anayasa: Otonomi politikası ${OUTWARD_POLICY_KINDS.join(', ')} için owner (sahibine sor) ya da system (sistem halletsin) olmalı.`);
  return { ...current, ...(value as Partial<OutwardPolicy>) };
}

/** Up to 200 people, each an e-mail, a phone or a user name; trimmed, empty ones dropped, each once (folded). */
function specialContacts(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 200 || value.some((x) => typeof x !== 'string' || x.trim().length > 200)) {
    throw new ValidationError('Anayasa: Özel kişiler en çok 200 metinden oluşan bir liste olmalı (e-posta, telefon ya da kullanıcı adı; her biri en çok 200 karakter).');
  }
  const out: string[] = [];
  for (const raw of value as string[]) {
    const x = raw.trim();
    if (x && !out.some((y) => fold(y) === fold(x))) out.push(x);
  }
  return out;
}

/** Two whole local hours, the first before the second (24: midnight). */
function callHours(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length !== 2 || value.some((h) => typeof h !== 'number' || !Number.isInteger(h) || h < 0 || h > 24) || value[0] >= value[1]) {
    throw new ValidationError('Anayasa: Arama saatleri 0 ile 24 arasında iki tam saat olmalı, başlangıç bitişten önce (ör. 9, 19).');
  }
  return [value[0] as number, value[1] as number];
}
```

In `described()`, before `if (Object.hasOwn(SWITCHES, key))`:

```ts
  if (key === 'outwardPolicy') return ['Otonomi politikası', OUTWARD_POLICY_KINDS.map((k) => `${POLICY_LABELS[k]} ${c.outwardPolicy[k] === 'system' ? 'sistem' : 'sahibine'}`).join(', ')];
  if (key === 'specialContacts') return ['Özel kişiler', c.specialContacts.length ? c.specialContacts.join(', ') : 'yok'];
  if (key === 'callHours') return ['Arama saatleri', `${c.callHours[0]}–${c.callHours[1]}`];
```

In `setConstitution`'s loop, after the `autonomy` block:

```ts
      if (key === 'outwardPolicy') {
        checked.outwardPolicy = outwardPolicy(value, this.constitution().outwardPolicy);
        continue;
      }
      if (key === 'specialContacts') {
        checked.specialContacts = specialContacts(value);
        continue;
      }
      if (key === 'callHours') {
        checked.callHours = callHours(value);
        continue;
      }
```

- [ ] **Step 5: The web's full constitution literals** — in `apps/office-web/src/ui/BudgetTabs.test.tsx`, `apps/office-web/src/ui/PlanCard.test.tsx` and `apps/office-web/src/store/reducers.test.ts`, in each `constitution: { … }` literal, after `maxSchedules: 20`, add:

```ts
, outwardPolicy: { send: 'system', publish: 'system', call: 'system', calendar: 'owner' }, specialContacts: [], sendsPerHour: 30, bulkRecipients: 5, callHours: [9, 19], callsPerDay: 20
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/budget.test.ts test/approvals.test.ts && cd ~/Projects/control-center-departments && pnpm -r typecheck && pnpm --filter @cc/office-web test`
Expected: PASS.

- [ ] **Step 7: Whole server suite, commit**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run` — Expected: PASS.

```bash
cd ~/Projects/control-center-departments
git add packages/shared/src/budget.ts apps/office-server/src/company/budget.ts apps/office-server/test/budget.test.ts apps/office-web/src/ui/BudgetTabs.test.tsx apps/office-web/src/ui/PlanCard.test.tsx apps/office-web/src/store/reducers.test.ts
git commit -m "feat(constitution): the outward policy (send, publish, call: system; calendar: owner) and its rules — special contacts, sends per hour, bulk recipients, call hours, calls per day"
```

---

### Task 7: Recipients, special contacts and the rules — read from a call's input

**Files:**
- Create: `apps/office-server/src/company/recipients.ts`, `apps/office-server/src/company/outward-rules.ts`
- Test: `apps/office-server/test/outward-rules.test.ts`

**Interfaces:**
- Consumes: the constitution's rule keys (Task 6), `OutwardPolicyKind`, `OUTBOX_SUMMARY_CHARS` (Task 2), `fold` (`@cc/shared`).
- Produces: `recipientsOf(input: unknown): string[]`; `type ContactKey = { kind: 'email' | 'phone' | 'handle'; value: string }`; `contactKey(raw: string): ContactKey | null`; `specialContact(input: unknown, contacts: readonly string[]): string | null`; `callSummary(input: unknown, max?: number): string`; `interface OutwardCall { input: unknown; kinds: readonly OutwardPolicyKind[]; rules: Pick<Constitution, 'specialContacts' | 'bulkRecipients' | 'callHours' | 'sendsPerHour' | 'callsPerDay'>; now: number; count: (kinds: readonly OutwardPolicyKind[], since: number) => number }`; `outwardRule(c: OutwardCall): string | null`.

- [ ] **Step 1: Write the failing tests** — `test/outward-rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONSTITUTION, type OutwardPolicyKind } from '@cc/shared';
import { outwardRule } from '../src/company/outward-rules.ts';
import { callSummary, contactKey, recipientsOf, specialContact } from '../src/company/recipients.ts';

describe('a call’s recipients and special contacts (spec capabilities §6)', () => {
  it('reads the recipient fields at any depth: lists, comma-separated text, objects of a list; each once', () => {
    expect(recipientsOf({ to: 'a@x.co, b@x.co; c@x.co', cc: ['d@x.co'], bcc: 'A@X.co', body: 'e@x.co' })).toEqual(['a@x.co', 'b@x.co', 'c@x.co', 'd@x.co']);
    expect(recipientsOf({ event: { attendees: [{ email: 'a@x.co' }, { email: 'b@x.co', displayName: 'B' }] } })).toEqual(['a@x.co', 'b@x.co']);
    expect(recipientsOf({ phone_numbers: [905321112233, '+90 533 000 00 00'], 'lead-ids': ['l1'] })).toEqual(['905321112233', '+90 533 000 00 00', 'l1']);
    expect(recipientsOf({ text: 'merhaba' })).toEqual([]);
    expect(recipientsOf('to=a@x.co')).toEqual([]);
  });

  it('a special contact’s key: an e-mail folded, a phone by its digits, else a user name without its @', () => {
    expect(contactKey(' Ali@Firma.com ')).toEqual({ kind: 'email', value: 'ali@firma.com' });
    expect(contactKey('+90 (532) 111 22 33')).toEqual({ kind: 'phone', value: '905321112233' });
    expect(contactKey('@AliVeli')).toEqual({ kind: 'handle', value: 'aliveli' });
    expect(contactKey('  ')).toBeNull();
  });

  it('review focus 2: a special contact written in another case or format is found anywhere in the input; a near one is not', () => {
    const contacts = ['Ali@Firma.com', '+90 (532) 111 22 33', '@AliVeli', 'İpek'];
    expect(specialContact({ to: 'ALI@firma.COM' }, contacts)).toBe('Ali@Firma.com');
    expect(specialContact({ message: { body: 'Sayın yetkili <ali@firma.com>,' } }, contacts)).toBe('Ali@Firma.com');
    expect(specialContact({ phone: '0532 111 22 33' }, contacts)).toBe('+90 (532) 111 22 33');
    expect(specialContact({ phone: 905321112233 }, contacts)).toBe('+90 (532) 111 22 33');
    expect(specialContact({ text: 'Merhaba @aliveli!' }, contacts)).toBe('@AliVeli');
    expect(specialContact({ to: 'IPEK' }, contacts)).toBe('İpek');
    expect(specialContact({ to: 'vali@firma.com', phone: '0532 111 22 34', text: 'aliveli2 ipekyolu' }, contacts)).toBeNull();
    expect(specialContact({ to: 'ali@firma.com' }, [])).toBeNull();
  });

  it('the summary the outbox keeps: the input without secret-looking fields, its first 300 characters', () => {
    expect(callSummary({ to: 'a@x.co', api_key: 'k', auth: { password: 'p', user: 'u' }, text: 'x' })).toBe('{"to":"a@x.co","auth":{"user":"u"},"text":"x"}');
    expect(callSummary({ text: 'y'.repeat(500) })).toHaveLength(300);
  });
});

describe('the rules the system keeps (spec capabilities §6)', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 13, h, m).getTime();
  const check = (input: unknown, kinds: OutwardPolicyKind[], o: { now?: number; counts?: Record<string, number>; rules?: Partial<typeof DEFAULT_CONSTITUTION> } = {}) => {
    const asked: Array<[string, number]> = [];
    const rule = outwardRule({
      input, kinds, rules: { ...DEFAULT_CONSTITUTION, ...o.rules }, now: o.now ?? at(11),
      count: (k, since) => {
        asked.push([k.join('+'), since]);
        return o.counts?.[k.join('+')] ?? 0;
      },
    });
    return { rule, asked };
  };

  it('review focus 1: a mail to six people (to, cc and bcc together) is a bulk send above 5; to five it passes', () => {
    const six = Array.from({ length: 6 }, (_, i) => `k${i}@x.co`);
    expect(check({ to: six }, ['send']).rule).toBe('toplu gönderim: 6 alıcı > 5');
    expect(check({ to: six.slice(0, 3), bcc: six.slice(3) }, ['send']).rule).toBe('toplu gönderim: 6 alıcı > 5');
    expect(check({ to: six.slice(0, 2).join(','), cc: six.slice(2, 5) }, ['send']).rule).toBeNull();
  });

  it('a special contact comes first', () => {
    expect(check({ to: ['ALI@firma.com', 'b@x.co'] }, ['send'], { rules: { specialContacts: ['ali@firma.com'] }, counts: { 'send+publish': 99 } }).rule).toBe('özel kişi: ali@firma.com');
  });

  it('calls: only in the call hours (local), at most callsPerDay a day counted from midnight', () => {
    expect(check({ phone: '0532' }, ['call'], { now: at(21, 40) }).rule).toBe('mesai dışı arama (21:40)');
    expect(check({ phone: '0532' }, ['call'], { now: at(8, 59) }).rule).toBe('mesai dışı arama (08:59)');
    expect(check({ phone: '0532' }, ['call'], { now: at(19, 0) }).rule).toBe('mesai dışı arama (19:00)');
    const ok = check({ phone: '0532' }, ['call'], { now: at(9, 0) });
    expect(ok).toEqual({ rule: null, asked: [['call', at(0)]] });
    expect(check({ phone: '0532' }, ['call'], { counts: { call: 20 } }).rule).toBe('günlük arama sınırı (20) doldu');
  });

  it('sends and publishes together: at most sendsPerHour in the last hour; an invitation counts against neither counter', () => {
    const r = check({ to: 'a@x.co' }, ['send'], { counts: { 'send+publish': 29 } });
    expect(r).toEqual({ rule: null, asked: [['send+publish', at(11) - 3_600_000]] });
    expect(check({ post_id: 'p' }, ['publish'], { counts: { 'send+publish': 30 } }).rule).toBe('saatlik gönderim sınırı (30) doldu');
    expect(check({ to: 'a@x.co' }, ['send'], { rules: { sendsPerHour: 0 } }).rule).toBe('saatlik gönderim sınırı (0) doldu');
    expect(check({ attendees: ['a@x.co'] }, ['calendar'], { counts: { 'send+publish': 99, call: 99 } })).toEqual({ rule: null, asked: [] });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/outward-rules.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/company/recipients.ts`**

```ts
import { fold, OUTBOX_SUMMARY_CHARS } from '@cc/shared';

/**
 * Whom a connector call is for and whether one of the owner's special contacts is in it, read from its input without
 * understanding it (spec 2026-10-13-capabilities-autonomy §6): the gate's rules and the outbox use these. Pure.
 */

/** Fields that name recipients, at any depth (compared folded, `_` and `-` ignored). */
const RECIPIENT_FIELDS = new Set(['to', 'cc', 'bcc', 'recipient', 'recipients', 'attendee', 'attendees', 'guests', 'invitees', 'participants', 'emails', 'phone', 'phones', 'phonenumbers', 'numbers', 'contacts', 'contactids', 'leadids', 'audience']);
/** In an object of a recipients list, the field that says who. */
const WHO_FIELDS = ['email', 'address', 'phone', 'number', 'id', 'name'];
const keyOf = (k: string) => fold(k).replace(/[_-]/g, '');

function who(value: unknown): string[] {
  if (typeof value === 'string') return value.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
  if (typeof value === 'number' && Number.isFinite(value)) return [String(value)];
  if (Array.isArray(value)) return value.flatMap(who);
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const field = WHO_FIELDS.find((f) => typeof o[f] === 'string' || typeof o[f] === 'number');
    return field ? who(o[field]) : [];
  }
  return [];
}

/** Each recipient once (folded), in the order met. */
export function recipientsOf(input: unknown): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (!RECIPIENT_FIELDS.has(keyOf(k))) {
        walk(x);
        continue;
      }
      for (const r of who(x)) {
        if (seen.has(fold(r))) continue;
        seen.add(fold(r));
        found.push(r);
      }
    }
  };
  walk(input);
  return found;
}

export type ContactKey = { kind: 'email' | 'phone' | 'handle'; value: string };

/** How a special contact is compared: an e-mail folded, a phone by its digits, anything else as a user name folded without its @. */
export function contactKey(raw: string): ContactKey | null {
  const x = raw.trim();
  if (!x) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)) return { kind: 'email', value: fold(x) };
  const digits = x.replace(/\D/g, '');
  if (/^\+?[\d\s().-]+$/.test(x) && digits.length >= 7) return { kind: 'phone', value: digits };
  const handle = fold(x).replace(/^@+/, '');
  return handle ? { kind: 'handle', value: handle } : null;
}

/** One person's number when the digits agree, or their last ten do (a country code or a leading 0 apart). */
const samePhone = (a: string, b: string) => a === b || (a.length >= 10 && b.length >= 10 && a.slice(-10) === b.slice(-10));
const EMAIL = /[^\s<>()"',;:]+@[^\s<>()"',;:]+\.[^\s<>()"',;:]+/g;
const PHONE = /\+?\d[\d\s().-]{5,}\d/g;

function texts(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (typeof v === 'number' && Number.isFinite(v)) return [String(v)];
  if (Array.isArray(v)) return v.flatMap(texts);
  if (v && typeof v === 'object') return Object.values(v as Record<string, unknown>).flatMap(texts);
  return [];
}

/** The first special contact (as the owner wrote it) found anywhere in the call's input; null when none is. */
export function specialContact(input: unknown, contacts: readonly string[]): string | null {
  if (contacts.length === 0) return null;
  const all = texts(input);
  const emails = all.flatMap((t) => (t.match(EMAIL) ?? []).map((e) => fold(e.replace(/\.+$/, ''))));
  const phones = all.flatMap((t) => (t.match(PHONE) ?? []).map((p) => p.replace(/\D/g, '')));
  // A user name is a whole word: "@aliveli" and "aliveli," are it, "aliveli2" is not.
  const words = all.flatMap((t) => fold(t).split(/[\s,;:<>()"'!?]+/).map((w) => w.replace(/^@+/, '').replace(/\.+$/, '')).filter(Boolean));
  for (const raw of contacts) {
    const key = contactKey(raw);
    if (!key) continue;
    const hit = key.kind === 'email' ? emails.includes(key.value) : key.kind === 'phone' ? phones.some((p) => samePhone(p, key.value)) : words.includes(key.value);
    if (hit) return raw.trim();
  }
  return null;
}

const SECRET = /token|secret|password|passwd|api[_-]?key|authorization|cookie|credential|private[_-]?key/i;

/** The call's input as the outbox keeps it: JSON without secret-looking fields, its first `max` characters. */
export function callSummary(input: unknown, max = OUTBOX_SUMMARY_CHARS): string {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !SECRET.test(k)).map(([k, x]) => [k, strip(x)]));
    return v;
  };
  const text = typeof input === 'string' ? input : (JSON.stringify(strip(input)) ?? '');
  return text.slice(0, max);
}
```

- [ ] **Step 4: Implement `src/company/outward-rules.ts`**

```ts
import type { Constitution, OutwardPolicyKind } from '@cc/shared';
import { recipientsOf, specialContact } from './recipients.ts';

const HOUR = 60 * 60_000;
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export interface OutwardCall {
  input: unknown;
  /** The kinds of the call's parts, each one the owner's policy leaves to the system. */
  kinds: readonly OutwardPolicyKind[];
  rules: Pick<Constitution, 'specialContacts' | 'bulkRecipients' | 'callHours' | 'sendsPerHour' | 'callsPerDay'>;
  now: number;
  /** Calls of these kinds the system let out since `since`, in the caller's department (alone, without one). */
  count: (kinds: readonly OutwardPolicyKind[], since: number) => number;
}

/**
 * The rule a call the system would let out breaks, in Turkish — the held call's reason —, or null (spec capabilities
 * §6). Cheapest first: the counters are read only for a call that could still pass. A limit is reached at `>=`.
 */
export function outwardRule(c: OutwardCall): string | null {
  const special = specialContact(c.input, c.rules.specialContacts);
  if (special) return `özel kişi: ${special}`;
  const recipients = recipientsOf(c.input).length;
  if (recipients > c.rules.bulkRecipients) return `toplu gönderim: ${recipients} alıcı > ${c.rules.bulkRecipients}`;
  if (c.kinds.includes('call')) {
    const at = new Date(c.now);
    const minute = at.getHours() * 60 + at.getMinutes();
    const [from, to] = c.rules.callHours;
    if (minute < from * 60 || minute >= to * 60) return `mesai dışı arama (${hhmm(at)})`;
    const midnight = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
    if (c.count(['call'], midnight) >= c.rules.callsPerDay) return `günlük arama sınırı (${c.rules.callsPerDay}) doldu`;
  }
  if (c.kinds.some((k) => k === 'send' || k === 'publish') && c.count(['send', 'publish'], c.now - HOUR) >= c.rules.sendsPerHour) {
    return `saatlik gönderim sınırı (${c.rules.sendsPerHour}) doldu`;
  }
  return null;
}
```

- [ ] **Step 5: Run the tests**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/outward-rules.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, commit**

Run: `cd ~/Projects/control-center-departments && pnpm -r typecheck` — Expected: PASS.

```bash
cd ~/Projects/control-center-departments
git add apps/office-server/src/company/recipients.ts apps/office-server/src/company/outward-rules.ts apps/office-server/test/outward-rules.test.ts
git commit -m "feat(autonomy): recipients, special contacts and the rules the system keeps, read from a call's input"
```

---

### Task 8: The gate lets the system send, and writes the outbox

**Files:**
- Modify: `apps/office-server/src/company/gate.ts`
- Test: `apps/office-server/test/gate-autonomy.test.ts`

**Interfaces:**
- Consumes: `GatePart.capability` (Task 1), `OutboxStore` (Task 2), the constitution's policy and rules (Task 6), `outwardRule`, `recipientsOf`, `callSummary` (Task 7), `Employee.departmentId` (departments).
- Produces: `GateDeps.autonomy?: { constitution: () => Constitution; outbox: OutboxStore; now?: () => number }`; `Gate.check` lets a system call out (`reason: 'sistemce (otonomi politikası)'`), holds one a rule stops with the rule as its reason, and writes every let-out outward call to the outbox with an `outbox.sent` event.

- [ ] **Step 1: Write the failing tests** — `test/gate-autonomy.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER, type Employee, type OutboxEntry } from '@cc/shared';
import { ApprovalStore } from '../src/company/approval-store.ts';
import { Approvals } from '../src/company/approvals.ts';
import { Gate } from '../src/company/gate.ts';
import { OutboxStore } from '../src/company/outbox-store.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { DATA, testContext } from './gate-helpers.ts';
import { setup } from './helpers.ts';

/** Spec capabilities §5–§7: the gate's system path, its rules and the outbox. */

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const HOUR = 3_600_000;
const GMAIL = 'mcp__claude_ai_Gmail__send_message';

function make() {
  // Tuesday 13 October 2026, 11:00 local: inside the call hours.
  let now = new Date(2026, 9, 13, 11, 0).getTime();
  const clock = () => now;
  const s = setup(8, clock);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, ['coder'], clock, undefined, { departments: true });
  c.budget.setConstitution({ gateEnabled: true });
  const approvals = new Approvals({ store: new ApprovalStore(s.db, clock), events: s.events, notices: c.notices, roster: s.roster, tasks: c.tasks, coordinator: () => c.company.coordinator(), memory: c.memory, now: clock, defer: (fn) => fn() });
  const outbox = new OutboxStore(s.db, clock);
  const gate = new Gate({
    approvals, events: s.events, roster: s.roster, enabled: () => c.budget.constitution().gateEnabled,
    context: (e) => testContext({ deskDir: `${DATA}/desks/${e.slug}` }),
    autonomy: { constitution: () => c.budget.constitution(), outbox, now: clock },
  });
  const coordinator = c.company.hireCoordinator();
  const sales = c.departments!.create(OWNER, { name: 'Satış', mission: 'm' });
  const marketing = c.departments!.create(OWNER, { name: 'Pazarlama', mission: 'm' });
  const hire = (name: string, departmentId?: string) => c.company.hire(OWNER, { name, role: 'r', ...(departmentId ? { departmentId } : {}) });
  const ask = (who: Employee, tool_name: string, tool_input: unknown) => gate.check(who.id, { tool_name, tool_input, cwd: `${DATA}/desks/${who.slug}` });
  const mail = (who: Employee, to: string | string[] = 'musteri@x.co') => ask(who, GMAIL, { to, subject: 'Siparişiniz', body: 'Kargoya verildi.' });
  const ev = (type: string) => s.events.list({ limit: 5000 }).filter((e) => e.event.type === type);
  return { ...s, ...c, approvals, outbox, gate, coordinator, sales, marketing, hire, ask, mail, ev, advance: (ms: number) => void (now += ms) };
}

describe('the gate lets the system send (spec capabilities §5–§7)', () => {
  it('the owner’s default policy: a connector’s send passes without the owner, written as the system’s with outbox.sent — no approval, no gate.checked; a publish and a call too; a read is written nowhere', async () => {
    const t = make();
    const selin = t.hire('Selin', t.sales.id);
    expect(await t.mail(selin, ['a@x.co', 'b@x.co'])).toMatchObject({ decision: 'allow', reason: 'sistemce (otonomi politikası)', kind: 'send', target: 'send_message to=a@x.co,b@x.co' });
    const [entry] = t.outbox.list() as [OutboxEntry];
    expect(entry).toMatchObject({ employeeId: selin.id, departmentId: t.sales.id, tool: GMAIL, kind: 'send', target: 'send_message to=a@x.co,b@x.co', recipients: ['a@x.co', 'b@x.co'], via: 'system', approvalId: null });
    expect(entry.summary).toContain('Kargoya verildi.');
    expect(t.ev('outbox.sent')).toEqual([expect.objectContaining({ employeeId: selin.id, event: { type: 'outbox.sent', entry } })]);
    expect([t.ev('gate.checked'), t.ev('approval.changed')]).toEqual([[], []]);
    expect((await t.ask(selin, 'mcp__claude_ai_jeeta__jeeta_publish_social_post', { post_id: 'p1' })).decision).toBe('allow');
    expect((await t.ask(selin, 'mcp__claude_ai_jeeta__jeeta_click_to_dial', { phone: '+905321112233' })).decision).toBe('allow');
    expect((await t.ask(selin, 'mcp__claude_ai_Gmail__get_message', { id: 'm1' })).decision).toBe('allow');
    expect(t.outbox.list().map((e) => e.kind)).toEqual(['call', 'publish', 'send']);
  });

  it('a calendar invitation waits for the owner by default; left to the system, it passes', async () => {
    const t = make();
    const ada = t.hire('Ada');
    const invite = () => t.ask(ada, 'mcp__claude_ai_Google_Calendar__create_event', { summary: 'Tanışma', attendees: ['a@x.co'] });
    const held = await invite();
    expect(held).toMatchObject({ decision: 'deny', kind: 'calendar' });
    expect(held.reason).toMatch(/OFİS KAPISI: takvim — “create_event summary=Tanışma” onaysız yapılamaz \(takvime yazar, katılımcılara davet gider \(calendar\.write\)\)/);
    t.budget.setConstitution({ outwardPolicy: { calendar: 'system' } });
    expect(await invite()).toMatchObject({ decision: 'allow', kind: 'calendar' });
    expect(t.outbox.list()).toEqual([expect.objectContaining({ kind: 'calendar', via: 'system', departmentId: null })]);
  });

  it('review focus 4: a Bash curl POST, a mail command, a git push or a SendMessage is never the system’s, whatever the policy', async () => {
    const t = make();
    const ada = t.hire('Ada');
    const curl = await t.ask(ada, 'Bash', { command: 'curl -X POST https://api.mail.io/send -d to=a@x.co' });
    expect(curl).toMatchObject({ decision: 'deny', kind: 'send' });
    expect(curl.reason).toMatch(/^OFİS KAPISI: gönderim/);
    expect((await t.ask(ada, 'Bash', { command: 'mail a@x.co' })).decision).toBe('deny');
    expect((await t.ask(ada, 'Bash', { command: 'git push origin main' })).decision).toBe('deny');
    expect((await t.ask(ada, 'SendMessage', { to: 'x', message: 'y' })).decision).toBe('deny');
    expect([t.outbox.list(), t.ev('outbox.sent')]).toEqual([[], []]);
  });

  it('pay, delete, the browser and unclassified tools are always the owner’s; a send the owner kept for themselves too', async () => {
    const t = make();
    const ada = t.hire('Ada');
    for (const [tool, kind] of [['mcp__claude_ai_jeeta__jeeta_reallocate_budget', 'pay'], ['mcp__claude_ai_Gmail__trash_message', 'delete'], ['mcp__plugin_playwright_playwright__browser_click', 'browser'], ['mcp__netgsm__send_sms', 'other']] as const) {
      expect(await t.ask(ada, tool, { id: 'x' }), tool).toMatchObject({ decision: 'deny', kind });
    }
    t.budget.setConstitution({ outwardPolicy: { send: 'owner' } });
    expect(await t.mail(ada)).toMatchObject({ decision: 'deny', kind: 'send' });
    expect(t.outbox.list()).toEqual([]);
  });

  it('review focus 1 at the gate: a mail to six is held with the rule; the owner approves it: it passes, written as the owner’s and counted nowhere', async () => {
    const t = make();
    t.budget.setConstitution({ sendsPerHour: 1 });
    const selin = t.hire('Selin', t.sales.id);
    const six = Array.from({ length: 6 }, (_, i) => `k${i}@x.co`);
    const held = await t.mail(selin, six);
    expect(held).toMatchObject({ decision: 'deny', kind: 'send' });
    expect(held.reason).toMatch(/onaysız yapılamaz \(toplu gönderim: 6 alıcı > 5\)\. Sistem bu çağrıyı kuralı yüzünden kendi geçirmedi\./);
    expect(t.ev('gate.checked')).toHaveLength(1);
    const a = t.approvals.request(selin.id, { kind: 'send', tool: GMAIL, target: held.target, summary: 'Kampanya duyurusu' });
    t.approvals.decide(a.id, true, { via: 'page' });
    expect(await t.mail(selin, six)).toMatchObject({ decision: 'allow', approvalId: a.id });
    expect(t.outbox.list()).toEqual([expect.objectContaining({ via: 'owner', approvalId: a.id, recipients: six })]);
    // Not counted: the hour's one system send is still free.
    expect((await t.mail(selin)).decision).toBe('allow');
    expect((await t.mail(selin)).reason).toMatch(/saatlik gönderim sınırı \(1\) doldu/);
  });

  it('review focus 5: the hourly cap is each department’s own; someone without a department counts alone; the hour moves on', async () => {
    const t = make();
    t.budget.setConstitution({ sendsPerHour: 2 });
    const [selin, sena, pelin, ada, can] = [t.hire('Selin', t.sales.id), t.hire('Sena', t.sales.id), t.hire('Pelin', t.marketing.id), t.hire('Ada'), t.hire('Can')];
    expect((await t.mail(selin)).decision).toBe('allow');
    expect((await t.mail(sena)).decision).toBe('allow');
    const third = await t.mail(selin);
    expect(third).toMatchObject({ decision: 'deny', kind: 'send' });
    expect(third.reason).toMatch(/saatlik gönderim sınırı \(2\) doldu/);
    // Satış's cap is not Pazarlama's, nor the centre's.
    expect((await t.mail(pelin)).decision).toBe('allow');
    expect((await t.mail(ada)).decision).toBe('allow');
    expect((await t.mail(ada)).decision).toBe('allow');
    expect((await t.mail(ada)).decision).toBe('deny');
    expect((await t.mail(can)).decision).toBe('allow');
    t.advance(HOUR + 1);
    expect((await t.mail(sena)).decision).toBe('allow');
  });

  it('calls: the day’s cap per department; outside the call hours held with the time', async () => {
    const t = make();
    t.budget.setConstitution({ callsPerDay: 1 });
    const selin = t.hire('Selin', t.sales.id);
    const dial = () => t.ask(selin, 'mcp__claude_ai_jeeta__jeeta_click_to_dial', { phone: '+905321112233' });
    expect((await dial()).decision).toBe('allow');
    expect((await dial()).reason).toMatch(/günlük arama sınırı \(1\) doldu/);
    t.advance(10 * HOUR + 40 * 60_000);
    expect((await dial()).reason).toMatch(/mesai dışı arama \(21:40\)/);
  });

  it('review focus 2 at the gate: a special contact goes to the owner, however it is written', async () => {
    const t = make();
    t.budget.setConstitution({ specialContacts: ['Ali@Firma.com', '+90 (532) 111 22 33'] });
    const ada = t.hire('Ada');
    expect((await t.mail(ada, 'ALI@firma.com')).reason).toMatch(/özel kişi: Ali@Firma\.com/);
    expect((await t.ask(ada, 'mcp__claude_ai_jeeta__jeeta_click_to_dial', { phone: '0532 111 22 33' })).reason).toMatch(/özel kişi: \+90 \(532\) 111 22 33/);
    expect(t.outbox.list()).toEqual([]);
  });

  it('an outward call the owner approved is an outbox line whatever its tool (a git push is a publish); a payment is not', async () => {
    const t = make();
    const ada = t.hire('Ada');
    const push = { command: 'git push origin main' };
    const held = await t.ask(ada, 'Bash', push);
    const a = t.approvals.request(ada.id, { kind: 'publish', tool: 'Bash', target: held.target, summary: 'Sürüm' });
    t.approvals.decide(a.id, true, { via: 'page' });
    expect((await t.ask(ada, 'Bash', push)).decision).toBe('allow');
    const budget = { campaign_id: 'c1' };
    const heldPay = await t.ask(ada, 'mcp__claude_ai_jeeta__jeeta_reallocate_budget', budget);
    const b = t.approvals.request(ada.id, { kind: 'pay', tool: 'mcp__claude_ai_jeeta__jeeta_reallocate_budget', target: heldPay.target, summary: 'Bütçe' });
    t.approvals.decide(b.id, true, { via: 'page' });
    expect((await t.ask(ada, 'mcp__claude_ai_jeeta__jeeta_reallocate_budget', budget)).decision).toBe('allow');
    expect(t.outbox.list()).toEqual([expect.objectContaining({ tool: 'Bash', kind: 'publish', target: 'git push origin', via: 'owner', approvalId: a.id, recipients: [] })]);
  });

  it('the gate off: everything passes and nothing is written — the policy needs the gate on', async () => {
    const t = make();
    t.budget.setConstitution({ gateEnabled: false });
    const ada = t.hire('Ada');
    expect((await t.mail(ada)).decision).toBe('allow');
    expect((await t.ask(ada, 'Bash', { command: 'curl -X POST https://api.mail.io/send' })).decision).toBe('allow');
    expect([t.outbox.list(), t.ev('outbox.sent'), t.ev('gate.checked')]).toEqual([[], [], []]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/gate-autonomy.test.ts`
Expected: FAIL — the connector send is denied (no system path yet); TypeScript accepts the `autonomy` dep only after Step 3 (vitest runs without typecheck, the object is ignored).

- [ ] **Step 3: Implement in `src/company/gate.ts`**

Imports: change the shared import to `import { APPROVAL_KIND_LABELS, isOutwardPolicyKind, type ApprovalKind, type ApprovalScope, type Constitution, type Employee, type GateDecision, type OutboxVia, type OutwardPolicyKind } from '@cc/shared';`, change the gate-policy import to `import { classifyCall, type GateContext, type GatePart } from './gate-policy.ts';`, and add:

```ts
import type { OutboxStore } from './outbox-store.ts';
import { outwardRule } from './outward-rules.ts';
import { callSummary, recipientsOf } from './recipients.ts';
```

In `interface GateDeps`, after `git?: …`:

```ts
  /**
   * Spec capabilities §5–§7: the constitution's outward policy and its rules, and the outbox every outward call the gate
   * lets out is written to. Absent (an office before them, the approvals' own tests): every held call waits for the
   * owner and nothing is written, as before.
   */
  autonomy?: { constitution: () => Constitution; outbox: OutboxStore; now?: () => number };
```

Update the class comment: "… and lets a held call through on the owner's approval — or, for a connector's outward call the owner's policy leaves to the system, on the policy's rules (spec capabilities §5). A held call, let through or not, leaves a gate.checked event; every outward call let out goes to the outbox."

In `check()`, replace everything from `if (!verdict.gated) return …` to the end of the method with:

```ts
    if (!verdict.gated) return { decision: 'allow', reason: 'serbest' };
    const passed = this.#d.approvals.pass(employeeId, tool, verdict.parts);
    const first = verdict.parts[0]!;
    if (passed.ok) {
      this.#d.events.append(employeeId, { type: 'gate.checked', tool, kind: first.kind, target: first.target, decision: 'allow', approvalId: passed.ids[0] ?? null });
      this.#record(employee, tool, hook.tool_input, verdict.parts, 'owner', passed.ids[0] ?? null);
      return { decision: 'allow', reason: 'sahibinin onayıyla', kind: first.kind, target: first.target, approvalId: passed.ids[0] };
    }
    const system = this.#system(employee, hook.tool_input, verdict.parts);
    if (system === true) {
      this.#record(employee, tool, hook.tool_input, verdict.parts, 'system', null);
      return { decision: 'allow', reason: 'sistemce (otonomi politikası)', kind: first.kind, target: first.target };
    }
    const part = passed.missing;
    this.#held.set(employeeId, { tool, kind: part.kind, target: part.target, scope: verdict.scope });
    this.#d.events.append(employeeId, { type: 'gate.checked', tool, kind: part.kind, target: part.target, decision: 'deny', approvalId: null });
    const rule = system === null ? '' : ' Sistem bu çağrıyı kuralı yüzünden kendi geçirmedi.';
    const more = verdict.parts.length > 1 ? ` Bu çağrıda onay isteyen ${verdict.parts.length} parça var; her biri için ayrı onay gerekir.` : '';
    const scope = verdict.scope === 'task' ? ' Görev boyunca bu tür tarayıcı işleri için scope: task iste.' : '';
    return {
      decision: 'deny',
      kind: part.kind,
      target: part.target,
      reason:
        `OFİS KAPISI: ${APPROVAL_KIND_LABELS[part.kind]} — “${part.target}” onaysız yapılamaz (${system ?? part.why}).${rule}${more} ` +
        `approvalRequest aracıyla sahibinden onay iste: summary'ye neden gerektiğini yaz (tool, kind ve target boş kalırsa bu çağrı alınır).${scope} ` +
        'Sahibi onaylayınca aynı çağrıyı tekrarla; beklerken görevi taskPark ile park et.',
    };
  }

  /**
   * Spec capabilities §5: a call is the system's when every part comes from a connector's classified tool, of a kind
   * the owner's policy leaves to the system — the shell's and the built-in tools' sends and publishes never are. Then
   * true (it passes), or the rule of §6 that holds it. null: the owner's, as before.
   */
  #system(employee: Employee, input: unknown, parts: GatePart[]): true | string | null {
    const a = this.#d.autonomy;
    if (!a) return null;
    const c = a.constitution();
    const kinds: OutwardPolicyKind[] = [];
    for (const p of parts) {
      if (p.capability === undefined || !isOutwardPolicyKind(p.kind) || c.outwardPolicy[p.kind] !== 'system') return null;
      kinds.push(p.kind);
    }
    const departmentId = employee.departmentId ?? null;
    const rule = outwardRule({
      input, kinds, rules: c, now: (a.now ?? Date.now)(),
      count: (k, since) => a.outbox.countSystem({ departmentId, employeeId: employee.id, kinds: k, since }),
    });
    return rule ?? true;
  }

  /** The outbox's line for a call let out (spec §7): its first part of an outward kind; other calls write nothing. */
  #record(employee: Employee, tool: string, input: unknown, parts: GatePart[], via: OutboxVia, approvalId: string | null): void {
    const outbox = this.#d.autonomy?.outbox;
    const part = parts.find((p) => isOutwardPolicyKind(p.kind));
    if (!outbox || !part) return;
    const entry = outbox.add({
      employeeId: employee.id, departmentId: employee.departmentId ?? null, tool, kind: part.kind as OutwardPolicyKind, target: part.target,
      recipients: recipientsOf(input), summary: callSummary(input), via, approvalId,
    });
    this.#d.events.append(employee.id, { type: 'outbox.sent', entry });
  }
```

- [ ] **Step 4: Run the tests, with the gate's older ones**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/gate-autonomy.test.ts test/approvals.test.ts test/gate-api.test.ts test/gate-hook.test.ts test/engine-gate.test.ts`
Expected: PASS (the older tests build the Gate without `autonomy`: every held call still waits for the owner).

- [ ] **Step 5: Typecheck, whole server suite, commit**

Run: `cd ~/Projects/control-center-departments && pnpm -r typecheck && cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run` — Expected: PASS.

```bash
cd ~/Projects/control-center-departments
git add apps/office-server/src/company/gate.ts apps/office-server/test/gate-autonomy.test.ts
git commit -m "feat(gate): the system lets a connector's send, publish, call or invitation out on the owner's policy and its rules; every outward call let out goes to the outbox"
```

---

### Task 9: `outboxRead`, asking before a call, the owner's outbox API, and the office's wiring

**Files:**
- Modify: `apps/office-server/src/company/gate.ts`, `apps/office-server/src/mcp/tools.ts`, `apps/office-server/src/api.ts`, `apps/office-server/src/main.ts`
- Test: `apps/office-server/test/gate-autonomy.test.ts`, `apps/office-server/test/outbox-api.test.ts`, `apps/office-server/test/main.test.ts`

**Interfaces:**
- Consumes: Tasks 2–8; `Departments.headOf`, `Departments.find` (departments).
- Produces: `Gate.preview(employeeId: string, tool: string, input: unknown): HeldCall | null`; `officeTools({ …, outbox?: OutboxStore, gate?: { lastHeld(…); preview?(employeeId: string, tool: string, input: unknown): HeldCall | null } })`; tool `outboxRead` (leads: the coordinator all, a head their department's); `approvalRequest` takes `input` (with `tool`); `ApiDeps.company.outbox?: OutboxStore`; route `GET /api/outbox?department=<id|none>&kind=<k>&limit=<1–200>`; main.ts wires `CustomCapabilities`, `useCompanyCapabilities`, `OutboxStore` and the Gate's `autonomy`.

- [ ] **Step 1: Write the failing tool tests** — append to `test/gate-autonomy.test.ts` (imports: `import { officeTools } from '../src/mcp/tools.ts';` and add `type Approval` to the `@cc/shared` import):

```ts
/** The office tools over make()'s office, as main.ts builds them (the gate, the approvals, the outbox, the departments). */
function withTools(t: ReturnType<typeof make>) {
  const tools = officeTools({
    company: t.company, roster: t.roster, tasks: t.tasks, characters: () => ['coder'], memory: t.memory, budget: t.budget,
    engine: { sleep: async () => undefined, wake: () => undefined, sideQuestion: async () => ({ ok: true, answer: '' }) },
    plans: () => t.plans.list(), agenda: { text: () => '' }, approvals: t.approvals, gate: t.gate, outbox: t.outbox, departments: t.departments,
  });
  return async (who: Employee, name: string, args: Record<string, unknown> = {}) => {
    const tool = tools.find((x) => x.name === name)!;
    if (!tool.kinds.includes(t.roster.get(who.id).kind)) throw new Error(`${name} not offered to ${who.kind}`);
    return String(await tool.run({ employee: t.roster.get(who.id) } as never, args));
  };
}

describe('outboxRead and asking before a call (spec capabilities §7, §8)', () => {
  it('the coordinator reads everyone’s (a department or the centre narrows it); a head reads their own department’s only; a member is not offered it', async () => {
    const t = make();
    const call = withTools(t);
    const head = t.company.hire(OWNER, { name: 'Selin', role: 'r', departmentId: t.sales.id, head: true });
    const sena = t.hire('Sena', t.sales.id);
    const pelin = t.hire('Pelin', t.marketing.id);
    const ada = t.hire('Ada');
    await t.mail(sena, 'a@x.co');
    await t.mail(pelin, 'b@x.co');
    await t.mail(ada, 'c@x.co');
    const all = await call(t.coordinator, 'outboxRead');
    expect(all).toMatch(/^Giden kutusu \(herkes\) — son 3, yeniden eskiye/);
    expect(all).toMatch(/Sena — gönderim “send_message to=a@x\.co” \(sistem\) → a@x\.co/);
    expect(await call(t.coordinator, 'outboxRead', { department: 'pazarlama' })).not.toMatch(/Sena|Ada/);
    expect(await call(t.coordinator, 'outboxRead', { department: 'merkez' })).toMatch(/^Giden kutusu \(merkez \(departmansız\)\) — son 1[\s\S]*Ada/);
    const own = await call(head, 'outboxRead', { limit: 10 });
    expect(own).toMatch(/^Giden kutusu \(Satış\) — son 1/);
    expect(own).not.toMatch(/Pelin/);
    await expect(call(head, 'outboxRead', { department: 'Pazarlama' })).rejects.toThrow(/yalnız kendi departmanının giden kutusunu okur \(Satış\)/);
    await expect(call(t.coordinator, 'outboxRead', { limit: 0 })).rejects.toThrow(/limit 1 ile 200/);
    await expect(call(sena, 'outboxRead')).rejects.toThrow(/not offered/);
  });

  it('asking before a call the system would let out: approvalRequest with the call’s input takes the gate’s own target; the call then passes as the owner’s', async () => {
    const t = make();
    const call = withTools(t);
    const ada = t.hire('Ada');
    const args = { to: 'musteri@x.co', subject: 'İade', body: 'İadenizi yapacağız.' };
    expect(await call(ada, 'approvalRequest', { tool: GMAIL, input: args, summary: 'Müşteriye iade sözü veriyorum.' })).toMatch(/^Onay istendi \(no \S+\): gönderim — “send_message to=musteri@x\.co”/);
    const [a] = t.approvals.list(ada.id) as [Approval];
    t.approvals.decide(a.id, true, { via: 'page' });
    expect(await t.ask(ada, GMAIL, args)).toMatchObject({ decision: 'allow', approvalId: a.id });
    expect(t.outbox.list()).toEqual([expect.objectContaining({ via: 'owner', approvalId: a.id })]);
    await expect(call(ada, 'approvalRequest', { tool: 'mcp__claude_ai_Gmail__get_message', input: { id: 'm' }, summary: 's' })).rejects.toThrow(/kapıya takılmaz/);
    await expect(call(ada, 'approvalRequest', { input: args, summary: 's' })).rejects.toThrow(/input ile birlikte tool/);
    await expect(call(ada, 'approvalRequest', { tool: GMAIL, input: 'to=a', summary: 's' })).rejects.toThrow(/bir nesne/);
  });
});
```

- [ ] **Step 2: Write the failing API test** — `test/outbox-api.test.ts`:

```ts
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/api.ts';
import { OutboxStore, type NewOutboxEntry } from '../src/company/outbox-store.ts';
import { QuotaTracker } from '../src/quota.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function start() {
  const s = setup();
  const f = fakeEngine(s);
  const c = companyFor(s, f, ['coder']);
  const outbox = new OutboxStore(s.db);
  const api = createApi(
    { engine: f.engine, roster: s.roster, events: s.events, quota: new QuotaTracker(s.db, s.events), company: { service: c.company, tasks: c.tasks, plans: c.plans, memory: c.memory, budget: c.budget, proposals: c.proposals, outbox } },
    { allowedOrigins: [] },
  );
  await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', resolve));
  const port = (api.server.address() as AddressInfo).port;
  cleanups.push(() => api.close(), f.cleanup, s.cleanup);
  return { port, outbox };
}

function get(port: number, path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    httpRequest({ host: '127.0.0.1', port, method: 'GET', path }, (res) => {
      let data = '';
      res.on('data', (x) => (data += x));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null }));
    }).on('error', reject).end();
  });
}

describe('the owner’s outbox (spec capabilities §7)', () => {
  it('newest first; by department (none: the centre) or kind; 1–200 of them', async () => {
    const t = await start();
    const line = (over: Partial<NewOutboxEntry>) =>
      t.outbox.add({ employeeId: 'e1', departmentId: null, tool: 'mcp__claude_ai_Gmail__send_message', kind: 'send', target: 'send_message to=a@x.co', recipients: ['a@x.co'], summary: '{}', via: 'system', approvalId: null, ...over });
    const a = line({});
    const b = line({ departmentId: 'd1', kind: 'call', target: 'jeeta_click_to_dial' });
    const c = line({ departmentId: 'd1', via: 'owner', approvalId: 'ap1' });
    const ids = async (q = '') => (await get(t.port, `/api/outbox${q}`)).body.map((e: { id: number }) => e.id);
    expect(await ids()).toEqual([c.id, b.id, a.id]);
    expect(await ids('?department=d1')).toEqual([c.id, b.id]);
    expect(await ids('?department=none')).toEqual([a.id]);
    expect(await ids('?kind=call')).toEqual([b.id]);
    expect(await ids('?limit=1')).toEqual([c.id]);
    expect((await get(t.port, '/api/outbox?limit=0')).status).toBe(400);
    expect((await get(t.port, '/api/outbox?kind=pay')).status).toBe(400);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/gate-autonomy.test.ts test/outbox-api.test.ts`
Expected: FAIL — no `outboxRead` tool; `/api/outbox` answers 404.

- [ ] **Step 4: `Gate.preview`** — in `src/company/gate.ts`, after `lastHeld()`:

```ts
  /**
   * What the gate makes of a call before it is made (approvalRequest with the call's own input, spec capabilities §8):
   * its first held part, so the approval's print is that very call's; null when the gate would not hold it at all.
   */
  preview(employeeId: string, tool: string, input: unknown): HeldCall | null {
    const verdict = classifyCall(tool, input, undefined, this.#d.context(this.#d.roster.get(employeeId)));
    const first = verdict.parts[0];
    return first ? { tool, kind: first.kind, target: first.target, scope: verdict.scope } : null;
  }
```

- [ ] **Step 5: The tools** — in `src/mcp/tools.ts`:

Add `APPROVAL_KIND_LABELS` (already imported), `OUTBOX_VIA_LABELS, fold, type OutboxEntry` to the `@cc/shared` import; `import type { OutboxStore } from '../company/outbox-store.ts';`. In the `officeTools` parameter type replace the `gate?` member and add `outbox?`:

```ts
  /** The gate: the last call it held for each employee, and what it would make of a call (approvalRequest). */
  gate?: { lastHeld(employeeId: string): HeldCall | null; preview?(employeeId: string, tool: string, input: unknown): HeldCall | null };
  /** What the gate let out (spec capabilities §7: outboxRead); absent in tests that do not care. */
  outbox?: OutboxStore;
```

In `approvalRequest`: its description (a template literal) ends with `… park the task with taskPark. ${GATE_LIMIT_TEXT}`; make that end:

```ts
…park the task with taskPark. Before a call you must not make without the owner (money, legal, a crisis, an answer you do not know, a first message without consent), give tool and input — the call’s arguments as you will make it: the gate’s kind and target are taken from them, so the approval is that very call’s. ${GATE_LIMIT_TEXT}`,
```

add to its `inputSchema` properties:

```ts
          input: { type: 'object', description: 'The call’s arguments as you will make it (with tool): the gate takes the kind and the target from them.' },
```

and replace its `run`'s `if (!tool || !target) { … }` block with:

```ts
        const call = args.input;
        if (call !== undefined && call !== null) {
          // Spec capabilities §8: asked before the call, from its own arguments — the approval's print is that call's.
          if (!tool) throw new ValidationError('input ile birlikte tool (aracın tam adı) ver.');
          if (typeof call !== 'object' || Array.isArray(call)) throw new ValidationError('input aracın argümanları olmalı (bir nesne).');
          if (!o.gate?.preview) throw new ConflictError('Bu ofiste kapı yok: tool, kind ve target ver.');
          const seen = o.gate.preview(employee.id, tool, call);
          if (!seen) throw new ValidationError(`Bu çağrı kapıya takılmaz (${tool}); onay gerekmez.`);
          input = { kind: seen.kind, tool, target: seen.target, scope: input.scope ?? seen.scope };
        } else if (!tool || !target) {
          const held = o.gate?.lastHeld(employee.id);
          if (!held) throw new ValidationError('Kapıya takılmış bir çağrın yok: tool, kind ve target ver (kapının mesajındaki gibi) ya da önce çağrıyı yap.');
          input = { kind: input.kind ?? held.kind, tool: held.tool, target: held.target, scope: input.scope ?? held.scope };
        }
```

After `approvalsRead`, add:

```ts
    {
      name: 'outboxRead',
      description:
        'Read the outbox: every outward call the gate let out — sent, published, called, invited — by the system on the owner’s policy or with the owner’s approval (an "allowed" record, not a "delivered" one), newest first. The coordinator reads everyone’s (department narrows it; "merkez": people without one); a department’s head reads their own department’s. For the daily sample: read the recent ones, look for tone and rule breaks, write what you find into the playbook.',
      inputSchema: object({
        since: s('How far back: days (1d, 7d) or a local date (2026-10-13); none: all.'),
        department: s('Department name or id, or "merkez" (the coordinator only).'),
        limit: integer('How many, newest first (default 30).', 1, 200),
      }),
      kinds: LEADS,
      run: ({ employee }, args) => {
        if (!o.outbox) throw new ConflictError('Bu ofiste giden kutusu yok.');
        const sinceText = optStr(args, 'since');
        const since = sinceText ? parseSince(sinceText, Date.now()) : undefined;
        const limit = num(args, 'limit') ?? 30;
        if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new ValidationError('limit 1 ile 200 arasında bir tam sayı olmalı.');
        const asked = optStr(args, 'department')?.trim();
        // undefined: everyone's; null: the centre's (people without a department).
        let departmentId: string | null | undefined;
        let label: string;
        if (employee.kind === 'coordinator') {
          const centre = asked !== undefined && asked !== '' && fold(asked) === 'merkez';
          const d = !asked || centre ? null : findDepartment(asked);
          departmentId = d ? d.id : centre ? null : undefined;
          label = d ? d.name : centre ? 'merkez (departmansız)' : 'herkes';
        } else {
          const own = deps?.headOf(employee.id) ?? null;
          if (!own) throw new ForbiddenError('Giden kutusunu koordinatör ve departman başkanları okur; başkanı olduğun bir departman yok.');
          if (asked && findDepartment(asked).id !== own.id) throw new ForbiddenError(`Başkan yalnız kendi departmanının giden kutusunu okur (${own.name}).`);
          departmentId = own.id;
          label = own.name;
        }
        const list = o.outbox.list({ departmentId, since, limit });
        if (list.length === 0) return `Giden kutusu (${label}): kayıt yok.`;
        const line = (e: OutboxEntry) =>
          `• ${formatWhen(e.at, Date.now())} ${company.nameOf(e.employeeId)} — ${APPROVAL_KIND_LABELS[e.kind]} “${e.target}” (${OUTBOX_VIA_LABELS[e.via]})${e.recipients.length ? ` → ${e.recipients.join(', ')}` : ''}\n  ${e.summary}`;
        return [`Giden kutusu (${label}) — son ${list.length}, yeniden eskiye; "izin verildi" kaydıdır, teslim değil:`, ...list.map(line)].join('\n');
      },
    },
```

- [ ] **Step 6: The API** — in `src/api.ts`:

`import type { OutboxStore } from './company/outbox-store.ts';`; add `isOutwardPolicyKind, OUTWARD_POLICY_KINDS, type OutwardPolicyKind` to the `@cc/shared` import. In `ApiDeps.company`, after `capabilities?: …`:

```ts
    /** What the gate let out (spec capabilities §7): the owner's Giden kutusu tab. */
    outbox?: OutboxStore;
```

Inside `if (d.company) { … }`, after the approvals routes:

```ts
    // The outbox (spec capabilities §7): reading only, the newest 200 at most; the page filters what it shows.
    if (method === 'GET' && url.pathname === '/api/outbox' && d.company.outbox) {
      const p = url.searchParams;
      const raw = p.get('limit');
      const limit = raw === null ? 200 : Number(raw);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new ValidationError('limit 1 ile 200 arasında bir tam sayı olmalı.');
      const kind = p.get('kind');
      if (kind !== null && !isOutwardPolicyKind(kind)) throw new ValidationError(`kind ${OUTWARD_POLICY_KINDS.join(', ')} olmalı.`);
      const department = p.get('department');
      return sendJson(res, 200, d.company.outbox.list({ departmentId: department === null ? undefined : department === 'none' ? null : department, kind: kind === null ? undefined : (kind as OutwardPolicyKind), limit }));
    }
```

- [ ] **Step 7: Run the tool and API tests**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/gate-autonomy.test.ts test/outbox-api.test.ts test/approvals.test.ts test/mcp-tools.test.ts`
Expected: PASS.

- [ ] **Step 8: Write the failing process test** — in `test/main.test.ts`, inside `describe('office-server process', …)`, after the B9a test:

```ts
  it('spec capabilities §5–§7: with the gate on, a connector send passes on the owner’s default policy and is in the outbox; a shell send waits; a capability the owner adds on the page classifies its tool (`autonomy` and the company capabilities wired)', async () => {
    const { dir, db, ada } = prepared();
    new ConstitutionStore(db).set({ gateEnabled: true });
    db.close();
    const log = join(tempDir(), 'argv.jsonl');
    const office = startOffice(dir, { FAKE_CLAUDE_ARGV_LOG: log });
    const port = await portOf(office);
    await call(port, 'POST', `/api/employees/${ada.id}/messages`, { text: 'merhaba' });
    await until(() => existsSync(log) && readFileSync(log, 'utf8').trim() !== '', 15_000);
    const start = JSON.parse(readFileSync(log, 'utf8').trim().split('\n')[0]!) as { args: string[]; cwd: string; gate: { url: string | null; token: string | null } };
    const settings = JSON.parse(start.args[start.args.indexOf('--settings') + 1]!) as { hooks?: { PreToolUse?: Array<{ hooks: Array<{ command: string }> }> } };
    const hook = settings.hooks?.PreToolUse?.[0]?.hooks[0]?.command ?? '';
    /** The hook as Claude Code runs it, for any tool; its exit code (0: the call runs, 2: the gate holds it). */
    const ask = (tool_name: string, tool_input: unknown) =>
      new Promise<number | null>((resolve) => {
        const child = spawn(hook, { shell: true, cwd: start.cwd, env: { ...process.env, OFFICE_GATE_URL: start.gate.url ?? '', OFFICE_GATE_TOKEN: start.gate.token ?? '' } });
        child.on('exit', (code) => resolve(code));
        child.stdin.end(JSON.stringify({ hook_event_name: 'PreToolUse', cwd: start.cwd, tool_name, tool_input }));
      });
    expect(await ask('mcp__claude_ai_Gmail__send_message', { to: 'musteri@x.co', body: 'Siparişiniz yolda.' })).toBe(0);
    expect(await ask('Bash', { command: 'curl -X POST https://api.mail.io/send -d to=a@x.co' })).toBe(2);
    expect(await call(port, 'GET', '/api/outbox')).toEqual([expect.objectContaining({ employeeId: ada.id, kind: 'send', via: 'system', recipients: ['musteri@x.co'] })]);
    expect(await ask('mcp__netgsm__send_sms', { to: '05321112233', text: 'x' })).toBe(2);
    await call(port, 'POST', '/api/custom-capabilities', { id: 'sms.send', title: 'SMS gönderme', summary: 'Netgsm ile SMS.', kind: 'send', tools: ['mcp__netgsm__send_sms'] });
    expect(await ask('mcp__netgsm__send_sms', { to: '05321112233', text: 'x' })).toBe(0);
    expect((await call(port, 'GET', '/api/capabilities')).capabilities.at(-1)).toMatchObject({ id: 'sms.send', company: true });
    await stop(office);
  }, 30_000);
```

- [ ] **Step 9: Run it to see it fail**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/main.test.ts -t "spec capabilities"`
Expected: FAIL — the hook exits 2 for the Gmail send (main.ts gives the Gate no `autonomy`).

- [ ] **Step 10: Wire it in `src/main.ts`**

Imports:

```ts
import { useCompanyCapabilities } from './company/capabilities.ts';
import { asCapability, CustomCapabilities } from './company/custom-capabilities.ts';
import { CustomCapabilityStore } from './company/custom-capability-store.ts';
import { OutboxStore } from './company/outbox-store.ts';
```

After `const integrations = new IntegrationRegistry({ db, roster, events });`:

```ts
// The company's own capabilities (spec capabilities §4): the vocabulary is the product's and the active ones — every
// classification (sessions, the gate, coverage) reads it, so it is wired before the first session starts.
const customCapabilities = new CustomCapabilities({ store: new CustomCapabilityStore(db), roster, events, notices, coordinator: () => company.coordinator() });
useCompanyCapabilities(() => customCapabilities.active().map(asCapability));
// What the gate let out (spec capabilities §7): the system's on the owner's policy, and the owner's approvals.
const outbox = new OutboxStore(db);
```

Change the Gate's construction to:

```ts
const gate = new Gate({
  approvals, events, roster, enabled: () => budget.constitution().gateEnabled, context: gateContext, git: gateContext.git,
  // Spec capabilities §5: the policy acts only while the owner keeps the gate on; this never turns it on.
  autonomy: { constitution: () => budget.constitution(), outbox },
});
```

Add `capabilities: customCapabilities, outbox` to the `officeTools({ … })` object and to the API's `company: { … }` object.

- [ ] **Step 11: Run the process tests, typecheck, whole server suite**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/main.test.ts && cd ~/Projects/control-center-departments && pnpm -r typecheck && cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
cd ~/Projects/control-center-departments
git add apps/office-server/src/company/gate.ts apps/office-server/src/mcp/tools.ts apps/office-server/src/api.ts apps/office-server/src/main.ts apps/office-server/test/gate-autonomy.test.ts apps/office-server/test/outbox-api.test.ts apps/office-server/test/main.test.ts
git commit -m "feat(autonomy): outboxRead for the coordinator and the heads, approvalRequest from the call's own input, the owner's outbox API, and the office's wiring"
```

---

### Task 10: The judgment layer and the new template versions

**Files:**
- Modify: `apps/office-server/src/company/craft/working.md`, `apps/office-server/src/company/craft/roles/{iletisim-yoneticisi,musteri-temsilcisi,sosyal-medya,satis-muduru,aday-arastirmaci,pazarlama-muduru}.md`, `apps/office-server/src/company/craft/departments/{ic-dis-iletisim,pazarlama,satis}.md`
- Test: `apps/office-server/test/craft.test.ts`, `apps/office-server/test/role-templates.test.ts`, `apps/office-server/test/department-templates.test.ts`, `apps/office-server/test/capabilities.test.ts`

**Interfaces:**
- Produces: `workingText()` holds `## Sistemin senin adına gönderdiği`; role templates `iletisim-yoneticisi` v2, `musteri-temsilcisi` v3, `sosyal-medya` v3, `satis-muduru` v2, `aday-arastirmaci` v2, `pazarlama-muduru` v2; department templates `ic-dis-iletisim`, `pazarlama`, `satis` v2.

- [ ] **Step 1: Write the failing tests**

`test/craft.test.ts` — in `'keeps the always-loaded parts short, and the core says its version'` change the working rules' limit and say why:

```ts
    // The judgment layer (spec capabilities §8) is everyone's, so the always-loaded rules grew by it.
    expect(workingText().length).toBeLessThan(3600);
```

and add:

```ts
  it('spec capabilities §8: everyone’s guide says what the system sends for them, and what they bring to the owner first, from the call’s own input', () => {
    const w = flat(workingText());
    expect(w).toContain('## Sistemin senin adına gönderdiği');
    for (const part of ['para sözü (fiyat, indirim, iade, ödeme tarihi)', 'hukuki konu (avukat, tüketici hakem heyeti, KVKK talebi, sözleşme)', 'kriz (basın, olumsuz yayılan paylaşım, tehdit, ağır şikâyet)', 'bilgi tabanında cevabı olmayan soru', 'ticari ileti izni (İYS)', '`approvalRequest`', '`input`', 'giden kutusuna yazılır']) {
      expect(w).toContain(part);
    }
  });
```

`test/role-templates.test.ts` — after `const OUTWARD = […]`:

```ts
// Spec capabilities §9: the roles that talk to customers and the public — the critical to the owner, the rest the system's.
const AUTONOMOUS = ['iletisim-yoneticisi', 'musteri-temsilcisi', 'sosyal-medya', 'satis-muduru', 'aday-arastirmaci', 'pazarlama-muduru'];
```

replace `for (const id of OUTWARD) expect(howTo(id), id).toMatch(/sahibinin onayı/);` with:

```ts
    for (const id of OUTWARD) expect(howTo(id), id).toMatch(AUTONOMOUS.includes(id) ? /Kritik olan sahibine, geri kalanı sistemce/ : /sahibinin onayı/);
```

in `'the department heads and their suggested roles …'` change `sosyal-medya`'s and `musteri-temsilcisi`'s `version: 2` to `version: 3`, and add:

```ts
  it('spec capabilities §9: the new versions — messages read and sent, consent (İYS) for a first message, the heads’ outbox sample, ad money the owner’s', () => {
    expect(roleTemplate('iletisim-yoneticisi')).toMatchObject({ version: 2 });
    expect(roleTemplate('iletisim-yoneticisi').capabilities).toEqual(expect.arrayContaining(['messages.read', 'messages.send']));
    expect(roleTemplate('musteri-temsilcisi')).toMatchObject({ version: 3, capabilities: ['email.read', 'email.send', 'crm.read', 'messages.read', 'messages.send'] });
    expect(roleTemplate('sosyal-medya').version).toBe(3);
    for (const id of ['satis-muduru', 'aday-arastirmaci', 'pazarlama-muduru']) expect(roleTemplate(id).version, id).toBe(2);
    for (const id of ['satis-muduru', 'aday-arastirmaci', 'iletisim-yoneticisi']) expect(roleTemplate(id).body, id).toMatch(/İYS/);
    for (const id of ['iletisim-yoneticisi', 'satis-muduru', 'pazarlama-muduru']) expect(roleTemplate(id).body, id).toMatch(/`outboxRead`/);
    expect(roleTemplate('sosyal-medya').body).toMatch(/Reklam harcaması .*her zaman sahibinin onayından geçer/);
  });
```

`test/department-templates.test.ts` — inside `describe('Department templates — the catalog', …)`:

```ts
  it('spec capabilities §9: İç-Dış İletişim, Pazarlama and Satış v2 — only the critical goes to the owner, the rest is in the outbox; a daily outbox sample is suggested', () => {
    for (const id of ['ic-dis-iletisim', 'pazarlama', 'satis']) {
      const t = departmentTemplate(id);
      expect(t.version, id).toBe(2);
      const owner = scopeSection(templateScope(t), 'Sana gelir');
      expect(owner, id).not.toMatch(/^- Her (gönderim|yayın)/m);
      expect(owner, id).toMatch(/giden kutusuna yazılır/);
      expect(t.routines.some((r) => r.startsWith('Giden kutusundan örnek okuma')), id).toBe(true);
    }
    expect(scopeSection(templateScope(departmentTemplate('satis')), 'Sana gelir')).toMatch(/İYS/);
    expect(departmentTemplate('yazilim-otomasyon').version).toBe(1);
  });
```

`test/capabilities.test.ts` — the template's capabilities in `'from a template: the template’s, unless given; …'`:

```ts
    expect(ece.capabilities).toEqual(['email.read', 'email.send', 'crm.read', 'messages.read', 'messages.send']);
    expect(t.roster.get(ece.id).capabilities).toEqual(['email.read', 'email.send', 'crm.read', 'messages.read', 'messages.send']);
```

and in `'hire, editRoleCard, taskCreate, …'`:

```ts
    expect(hired).toMatch(/^İşe alındı: Nil \(.+\), masa \d+, model sonnet, şablon musteri-temsilcisi \(sürüm \d+\)\.\nYetenekler: email\.read \[bu masada görülmedi\], email\.send \[bu masada görülmedi\], crm\.read \[bu masada görülmedi\], messages\.read \[bu masada görülmedi\], messages\.send \[bu masada görülmedi\]\. Ayrıntı: capabilitiesRead\.$/);
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/craft.test.ts test/role-templates.test.ts test/department-templates.test.ts test/capabilities.test.ts`
Expected: FAIL — no judgment section, the old versions.

- [ ] **Step 3: The judgment layer** — in `src/company/craft/working.md`, replace the first two lines of the `**Kapıya takılırsan**` bullet:

```markdown
- **Kapıya takılırsan** ("OFİS KAPISI: …"): yayın, gönderim, ödeme, silme, tarayıcı işi ya da ofisin kendisine dokunan
  bir çağrı sahibinin onayını bekler. `approvalRequest` ile iste (summary: neden gerektiği); onay gelince aynı çağrıyı
```

with these three (the bullet's next line, `  tekrarla; beklerken …`, stays):

```markdown
- **Kapıya takılırsan** ("OFİS KAPISI: …"): sistemin kendi geçirmediği yayın, gönderim, arama, takvim daveti, ödeme,
  silme, tarayıcı işi ya da ofisin kendisine dokunan bir çağrı sahibinin onayını bekler. `approvalRequest` ile iste
  (summary: neden gerektiği); onay gelince aynı çağrıyı
```

and append at the end of the file:

```markdown

## Sistemin senin adına gönderdiği

- Kapı açıkken bağlayıcıdan yapılan olağan gönderim, yayın ve arama sahibine sorulmadan geçebilir (Anayasa'nın
  otonomi politikası ve kuralları: saatlik sınır, toplu gönderim, özel kişiler, arama saatleri). Geçen her çağrı giden
  kutusuna yazılır; başkanın onu her gün okur.
- Şunlarda göndermeden önce `approvalRequest` ile sahibine sor (`tool` ve göndereceğin `input`): para sözü (fiyat,
  indirim, iade, ödeme tarihi); hukuki konu (avukat, tüketici hakem heyeti, KVKK talebi, sözleşme); kriz (basın,
  olumsuz yayılan paylaşım, tehdit, ağır şikâyet); bilgi tabanında cevabı olmayan soru; ticari ileti izni (İYS)
  olmayan kişiye ilk tanıtım mesajı ya da araması. Kapı içeriği okumaz; bunları sen ayırırsın.
```

- [ ] **Step 4: The six role templates.** Each file below is complete; copy it verbatim.

`craft/roles/iletisim-yoneticisi.md`:

```markdown
---
id: iletisim-yoneticisi
version: 2
title: İletişim Yöneticisi
team: İç-Dış İletişim
model: sonnet
summary: İç-Dış İletişim departmanını yönetirsin; gelen her mesajın bir sahibi olur, olağan cevaplar sistemce gider, ton kurallarını koyar, kritik olanı sahibine taşırsın.
capabilities:
- docs.read
- docs.write
- email.read
- email.draft
- social.read
- crm.read
- calendar.read
- messages.read
- messages.send
methods:
- customer
- content
checks:
- Gelen her mesaj bir kategoriye ayrıldı (acil, karar bekliyor, bilgi, gereksiz); sahipsiz mesaj yok.
- Cevaplar el kitabındaki ton kurallarına uygun.
- Şirket adına söz, indirim ya da iade verilmedi; kritik olan sahibine gitti.
- Sahibinin gelen kutusundaki kişisel içerik şirket hafızasına yazılmadı.
kpis:
- İlk cevabın süresi.
- Cevapsız kalan mesaj sayısı.
- Sahibine giden kritik konuların zamanında kapanma oranı.
---
### Sorumlulukların

- Dışarıdan gelen her şey sende: e-posta, mesaj, sosyal medya DM'leri, gönderi yorumları, etiketlenmeler ve WhatsApp. Olağan olanı cevaplar, satış sinyalini Satış'a, şikâyeti takip listesine taşırsın.
- Sahibinin iletişim yükünü taşırsın: gelen kutusunu ayıklar, cevap taslakları ve toplantı önerileri hazırlar, takip listesini tutarsın.
- SSS ve hazır cevapları, duyuruları ve basın bültenlerini yazarsın; değerlendirmeleri ve şikâyetleri izlersin.
- Haftalık olarak "insanlar ne soruyor, neden şikâyet ediyor" özetini Pazarlama'ya verirsin.

### Nasıl çalışırsın

- Kritik olan sahibine, geri kalanı sistemce: mesajlara olağan cevabı (bilgi, randevu, sipariş durumu, SSS) kendin gönderirsin; kapı Anayasa'nın otonomi politikası ve kurallarıyla geçirir ve giden kutusuna yazar, tutarsa `approvalRequest` ile istersin.
- Para sözü (fiyat, indirim, iade, ödeme tarihi), hukuki konu, kriz, bilgi tabanında cevabı olmayan soru ve ticari ileti izni (İYS) olmayan kişiye ilk tanıtım mesajı göndermeden önce `approvalRequest` ile sahibine gider.
- E-posta gönderimi, takvim daveti ve e-posta silme sahibinin onayından geçer; sen taslağı ve gerekçesini hazırlarsın.
- Her gün odanın giden kutusundan (`outboxRead`) örnek okur, ton ve kural ihlali ararsın; bulduğunu el kitabına kural olarak yazarsın.
- Sahibinin gelen kutusundaki içerik şirket hafızasına ve notlara kopyalanmaz; oraya yalnız özet ve kararlar yazılır.
- Müşteri mesajları sırayı tıkayınca Müşteri Destek Temsilcisi (`musteri-temsilcisi`), sahibinin gelen kutusu ve takvimi ayrı bir sıra gerektirecek kadar yoğunsa Yönetici Asistanı (`yonetici-asistani`) alırsın.

### Bitti ne demek

Her mesajın sahibi ve durumu belli, olağan cevaplar gitmiş, kritik olanlar sahibine sunulmuş, günün özeti yazılı.
```

`craft/roles/musteri-temsilcisi.md`:

```markdown
---
id: musteri-temsilcisi
version: 3
title: Müşteri Temsilcisi
team: İç-Dış İletişim
model: sonnet
summary: Müşteri sorularını yanıtlar, sorunları takip eder ve müşteri kayıtlarını düzenli tutarsın.
capabilities:
- email.read
- email.send
- crm.read
- messages.read
- messages.send
methods:
- customer
checks:
- Yanıt sorulan soruyu cevaplıyor ve şirketin yazılı kurallarına (fiyat, iade, teslim) dayanıyor.
- Sipariş ve müşteri bilgisi kayıttan doğrulandı.
- Ton nazik, kısa ve markaya uygun.
- İade, indirim ve şikâyet yükseltmeleri göndermeden önce sahibine gitti.
kpis:
- İlk yanıt süresi.
- Tek yanıtta çözülen soru oranı.
- Yükseltilen konuların zamanında kapanma oranı.
---
### Sorumlulukların

- Gelen müşteri sorularını sınıflar, yanıtlar, takip edersin.
- Müşteri kayıtlarını ve konuşma geçmişini düzenli tutarsın.
- Tekrarlayan soruları el kitabındaki "müşteri yanıt kuralları"na eklenmesi için önerirsin.
- Sosyal medya DM'lerine ve yorumlara, WhatsApp mesajlarına da cevap verirsin; satış sinyalini Satış'a taşırsın.

### Nasıl çalışırsın

- Kritik olan sahibine, geri kalanı sistemce: olağan soruya (bilgi, sipariş durumu, randevu, SSS) yanıtı kendin gönderirsin; kapı Anayasa'nın kurallarıyla (saatlik sınır, toplu gönderim, özel kişiler) geçirir ve giden kutusuna yazar, tutarsa `approvalRequest` ile istersin.
- Para sözü (fiyat, indirim, iade, ödeme tarihi), hukuki konu, büyüyen şikâyet ya da bilmediğin bir soru: göndermeden önce `approvalRequest` ile sahibine sor; müşteriye "bakıp dönüyorum" de.
- Bilmediğin bir şeyi uydurma: kurala bak (`playbookRead`), yoksa sor.
- Müşteri bilgisini yalnız işin için kullan; masanda gereksiz kişisel veri tutma.

### Bitti ne demek

Soru yanıtlandı ya da doğru kişiye yükseltildi; kritik olan sahibinin onayıyla gitti; kayıt güncel; gerekiyorsa takip
tarihi var.
```

`craft/roles/sosyal-medya.md`:

```markdown
---
id: sosyal-medya
version: 3
title: Sosyal Medya ve Reklam Uzmanı
team: Pazarlama
model: sonnet
summary: Yayın takvimini kurar, gönderileri hazırlayıp yayınlar ve hesapların performansını izlersin.
capabilities:
- social.read
- social.publish
- calendar.read
- ads.manage
methods:
- content
- operations
checks:
- Takvim brief'teki kanal, sıklık ve tarihlerle tutarlı.
- Her gönderi incelemeden geçmiş; görsel, metin ve etiketler birlikte kontrol edildi.
- Her yayın giden kutusunda; kritik gönderinin sahibinin onay kaydı var.
- Yorum ve mesajlarda şirket adına söz verilmedi.
- Reklam bütçesi ve hedeflemesi sahibinin onayladığıyla aynı.
kpis:
- Takvimin zamanında hazır olma oranı.
- Takvimdeki yayınların zamanında çıkma oranı.
- Etkileşim oranı (yayından sonra ölçülür).
---
### Sorumlulukların

- Haftalık ya da aylık yayın takvimini kurarsın: kanal, tarih, konu, biçim.
- Gönderileri yazara ve tasarımcıya brief'ler ya da kendin hazırlarsın; inceleyiciye gönderirsin.
- Yayından sonra sonuçları okursun ve dersleri el kitabına yazarsın.
- Reklam kampanyalarını kurar, performansını izlersin; bütçe ve her harcama sahibinin onayından geçer.

### Nasıl çalışırsın

- Kritik olan sahibine, geri kalanı sistemce: incelemeden geçmiş gönderiyi takvimdeki zamanında kendin yayınlar ya da zamanlarsın; kapı Anayasa'nın kurallarıyla geçirir ve giden kutusuna yazar. Kriz ya da hukuki konuya değen, kampanya vaadi (fiyat, indirim, çekiliş) içeren gönderi ve bir yayını silmek önce `approvalRequest` ile sahibine gider.
- Reklam harcaması (kampanya açmak, durdurmak, bütçe değiştirmek) her zaman sahibinin onayından geçer: bütçeyi ve hedeflemeyi hazırlar, onaya sunarsın.
- Hesaplardan yalnız okuma işlemleriyle veri topla (istatistik, yorum listesi).
- Yorumlara ve mesajlara cevap İç-Dış İletişim'in işidir; şirket adına yanıt yazacaksan önce taslak olarak sun.
- Takvimi ve sonuçları dosya olarak teslim et; sayıların yanına kaynağını ve tarihini yaz.

### Bitti ne demek

Takvim ve gönderiler hazır, incelemeden geçmiş, zamanında yayınlanmış ya da zamanlanmış (kritik olanlar sahibinin
onayıyla); reklam harcaması sahibinin onayıyla; ölçüm sonuçları kaynaklarıyla yazılı.
```

`craft/roles/satis-muduru.md`:

```markdown
---
id: satis-muduru
version: 2
title: Satış Müdürü
team: Satış
model: sonnet
summary: Satış departmanını yönetirsin; huniyi yönetir, adayları önceliğe göre sıralar, teklifleri incelersin.
capabilities:
- docs.read
- docs.write
- web.fetch
- crm.read
- crm.write
- email.read
- email.draft
methods:
- customer
- research
checks:
- Her adayın kaynağı ve nitelendirme gerekçesi CRM'de.
- Teklifin hesabı doğru ve el kitabındaki fiyat kurallarına uygun.
- Şirket adına söz verilmedi; teklif, indirim ve sözleşme sahibinden geçti.
- Ticari ileti izni (İYS) olmayan kişiye ilk tanıtım mesajı ya da araması sahibine sorulmadan gitmedi.
- Aday verisi el kitabındaki kişisel veri kuralına (KVKK) uygun toplandı.
kpis:
- Nitelikli aday sayısı.
- Tekliften kazanma oranı.
- Satış döngüsü süresi.
- Takibi kaçırılan fırsat sayısı.
---
### Sorumlulukların

- İdeal müşteri profilini yazar, huniyi yönetirsin; Pazarlama'dan gelen adayları nitelendirir, önceliğe göre sıralarsın.
- Teklifleri inceler, fiyat ve söz kontrolünü yaparsın.
- Sahibi bir görüşmeye girmeden hazırlık notu yazarsın: müşteri kim, ne istiyor, ne teklif edilmeli.
- Haftalık huni raporunu çıkarır, kaybedilen fırsatların nedenlerini Pazarlama'ya verirsin.

### Nasıl çalışırsın

- Kritik olan sahibine, geri kalanı sistemce: izni olan adaya takip mesajı ve toplantı hatırlatması gibi olağan temaslar sistemce geçer (Anayasa'nın kuralları, giden kutusu). Teklif, fiyat ve indirim, sözleşme ve şirket adına her söz önce `approvalRequest` ile sahibine gider; toplantı daveti sahibinin onayından geçer.
- Ticari ileti izni (İYS) olmayan kişiye ilk tanıtım mesajı ya da araması göndermezsin; önce sahibine sorarsın. İzin bilinmiyorsa yok say.
- Her gün odanın giden kutusundan (`outboxRead`) örnek okur, ton ve İYS kuralına uyulmuş mu bakarsın.
- Toplu pazarlama gönderimi Pazarlama'nın, mevcut müşterinin destek talebi İletişim'in, fatura Operasyon ve Finans'ın işi; "kazanıldı" deyince faturayı onlara paslarsın.
- Aday araştırması büyüyünce Aday Araştırmacı (`aday-arastirmaci`), açık fırsatlar takip edemeyeceğin kadar artınca Satış Asistanı (`satis-asistani`) alırsın.

### Bitti ne demek

Huni güncel, teklifler incelenmiş ve sahibine sunulmuş, her temas CRM'de ve giden kutusunda kayıtlı.
```

`craft/roles/aday-arastirmaci.md`:

```markdown
---
id: aday-arastirmaci
version: 2
title: Aday Araştırmacı
team: Satış
model: sonnet
summary: İdeal müşteri profiline uyan adayları kaynağıyla bulur, nitelendirir ve ilk temas taslağını yazarsın.
capabilities:
- docs.read
- docs.write
- web.fetch
- crm.read
- crm.write
methods:
- research
- customer
checks:
- Her adayın kaynağı (bağlantı ve tarih) yazılı.
- Nitelendirme profilin ölçütlerine göre yapıldı ve gerekçesi yazılı.
- Yalnız el kitabının izin verdiği kişisel veri toplandı.
- Ticari ileti izni (İYS) olmayan kişiye ilk temas gönderilmedi; sahibine sunuldu.
kpis:
- Haftalık nitelikli aday sayısı.
- Nitelikli adaydan görüşmeye dönüşme oranı.
- Kaynağı eksik kayıt sayısı (sıfır olmalı).
---
### Sorumlulukların

- Profile uyan şirket ve kişileri araştırır, CRM'e kaynağıyla kaydedersin.
- Adayları profilin ölçütlerine göre nitelendirirsin.
- İlk temas ve takip mesajlarının taslaklarını yazarsın.

### Nasıl çalışırsın

- İkincil kaynağı birincil sanmazsın; emin olmadığın bilgiyi "doğrulanmadı" diye işaretlersin.
- Kritik olan sahibine, geri kalanı sistemce: ticari ileti izni olan adaya takip mesajı sistemce geçebilir (Anayasa'nın kuralları, giden kutusu). İzni (İYS) olmayan ya da izni bilinmeyen kişiye ilk tanıtım mesajı ya da araması önce `approvalRequest` ile sahibine gider; taslağı hazırlar, izin gelmeden göndermezsin.
- Liste işlerinde (toplu kayıt, temizleme) daha hafif bir modelle çalışabilirsin.

### Bitti ne demek

Adaylar kaynaklı ve nitelendirilmiş olarak CRM'de; izinsiz ilk temas taslakları sahibine sunulmuş.
```

`craft/roles/pazarlama-muduru.md`:

```markdown
---
id: pazarlama-muduru
version: 2
title: Pazarlama Müdürü
team: Pazarlama
model: sonnet
summary: Pazarlama departmanını yönetirsin; strateji, içerik takvimi ve kanal seçimi sende, yayından önce son kontrolü yapar ve sonuçları ölçersin.
capabilities:
- docs.read
- docs.write
- web.fetch
- social.read
methods:
- content
- research
- customer
checks:
- Plan hedef kitleyi, kanalları, takvimi ve ölçüyü yazıyor.
- Yayına giden her içerik marka diline uygun ve iddiaları kaynaklı.
- Her yayın giden kutusunda; kritik olanın sahibinin onay kaydı var.
- Sonuç raporundaki her sayının kaynağı ve tarihi yazılı.
kpis:
- Takvime uyum (zamanında hazır içerik oranı).
- Etkileşim oranı.
- Satış'a giden nitelikli aday sayısı.
- Aday başına maliyet (reklam varsa).
---
### Sorumlulukların

- Pazarlama planını ve içerik takvimini kurarsın; kanalları seçersin.
- Pazar ve rakip araştırmasını kaynaklı yaparsın.
- Yayından önceki son kontrol sende: marka dili, iddialar, görsellerin lisansı.
- Haftalık performans özetini ve aylık raporu çıkarırsın; akışını `streamPlan` ile planlar, `streamReport` ile raporlarsın.

### Nasıl çalışırsın

- Tek başınayken içerik de üretirsin. Takvim yetişemeyeceğin hacme gelince İçerik Üreticisi (`icerik-yazari`), ikinci bir kanal ya da ücretli reklam başlayınca Sosyal Medya ve Reklam Uzmanı (`sosyal-medya`) alırsın.
- Gelen yorum ve mesajlar İç-Dış İletişim'in, birebir satış ve teklif Satış'ın, basın bülteni İletişim'in, sitenin kodu Yazılım'ın işi; onlara `taskPass` ile departman adını vererek paslarsın.
- Kritik olan sahibine, geri kalanı sistemce: incelenmiş içeriğin yayını sistemce çıkar (Anayasa'nın kuralları, giden kutusu). Reklam harcaması, ücretli görsel üretimi ve kampanya vaadi (fiyat, indirim, çekiliş) içeren yayın sahibinin onayından geçer; toplu e-posta ve bülten, toplu gönderim eşiğini aşınca zaten sahibine gider.
- Her gün odanın giden kutusundan (`outboxRead`) örnek okur, ton, iddia ve kural ihlali ararsın.

### Bitti ne demek

Takvim ve içerikler incelenmiş, yayınlar çıkmış (kritik olanlar sahibinin onayıyla), sonuçlar kaynaklı bir raporda.
```

- [ ] **Step 5: The three department templates.**

`craft/departments/ic-dis-iletisim.md` — in the front matter: `version: 2`; add the routine `- Giden kutusundan örnek okuma: ton ve kural ihlali (hafta içi 16:00)` as the last item of `routines`; change the check `- Taslak ton kurallarına uygun.` to `- Cevaplar ton kurallarına uygun.` and the kpi `- Sahibinin değiştirmeden onayladığı taslak oranı.` to `- Sahibine giden kritik konuların zamanında kapanma oranı.`. In `### Yapar` change `- Müşteri desteği: gelen kutusu ve mesajlar için cevap taslakları.` to `- Müşteri desteği: gelen kutusu ve mesajlara cevap (olağan olan sistemce gider).`. Replace everything from `### Sana gelir` to the end of the file with:

```markdown
### Sana gelir

- Para sözü: fiyat, indirim, iade, ödeme tarihi.
- Hukuki konu: avukat, tüketici hakem heyeti, KVKK talebi, sözleşme.
- Kriz: basın, olumsuz yayılan paylaşım, tehdit, ağır şikâyet.
- Bilgi tabanında cevabı olmayan soru.
- Takvim daveti gönderme ve kabul etme; e-posta silme.
- Kapının kuralına takılan gönderim (saatlik sınır, toplu gönderim, özel kişi).

Olağan cevaplar (bilgi, randevu, sipariş durumu, SSS) sistemce gider ve giden kutusuna yazılır; başkan her gün örnek okur.

Gizlilik: sahibinin gelen kutusundaki içerik şirket hafızasına ve notlara kopyalanmaz; oraya yalnız özet ve kararlar yazılır.
```

`craft/departments/pazarlama.md` — `version: 2`; last routine `- Giden kutusundan örnek okuma: yayınların tonu ve iddiaları (hafta içi 16:00)`; the check `- Yayın onayının kaydı var.` becomes `- Her yayın giden kutusunda; kritik olanın onay kaydı var.`. Replace everything from `### Sana gelir` to the end of the file with:

```markdown
### Sana gelir

- Reklam harcaması.
- Ücretli görsel üretimi.
- Kampanya vaadi (fiyat, indirim, çekiliş) içeren yayın.
- Kriz ya da hukuki konuya değen yayın.
- Kapının kuralına takılan gönderim (toplu e-posta ve bülten, toplu gönderim eşiğini aşınca).

Olağan yayınlar sistemce çıkar ve giden kutusuna yazılır; başkan her gün örnek okur.
```

`craft/departments/satis.md` — `version: 2`; last routine `- Giden kutusundan örnek okuma: temasların tonu ve İYS kuralı (hafta içi 17:00)`; add the check `- Ticari ileti izni (İYS) olmayan kişiye sahibine sorulmadan ilk temas gitmedi.` after `- Şirket adına söz verilmedi.`. Replace everything from `### Sana gelir` to the end of the file with:

```markdown
### Sana gelir

- Her teklif, fiyat ve indirim.
- Sözleşme.
- Toplantı daveti.
- Ticari ileti izni (İYS) olmayan kişiye ilk tanıtım mesajı ya da araması.
- Kapının kuralına takılan gönderim.

Olağan temaslar (izni olan adaya takip, toplantı hatırlatması) sistemce gider ve giden kutusuna yazılır; başkan her gün örnek okur.

Kişisel veri: aday verisi KVKK kapsamında; ne toplanabileceği el kitabında kural olarak yazılır.
```

- [ ] **Step 6: Run the tests**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/craft.test.ts test/role-templates.test.ts test/department-templates.test.ts test/capabilities.test.ts`
Expected: PASS.

- [ ] **Step 7: Expectations that read these templates' versions or texts**

Run: `cd ~/Projects/control-center-departments && grep -rn "pazarlama (sürüm 1)\|satis (sürüm 1)\|ic-dis-iletisim (sürüm 1)\|musteri-temsilcisi (sürüm 2)\|sosyal-medya (sürüm 2)\|id: 'pazarlama', version: 1 }\|id: 'satis', version: 1 }\|id: 'ic-dis-iletisim', version: 1 }" apps/office-server/test apps/office-web/src`
For each hit that comes from the template (a department opened or a person hired from it — not a store test that writes its own `{ id, version }` literal, such as `department-store.test.ts`), raise the version to the new one. Then run the whole server suite: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run` — Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd ~/Projects/control-center-departments
git add apps/office-server/src/company/craft apps/office-server/test
git commit -m "feat(craft): the judgment layer in everyone's guide; customer-facing role and department templates move to the outward policy (new versions)"
```

---

### Task 11: Web — the Anayasa's policy and rules, approval labels, outbox lines, revisions

**Files:**
- Modify: `apps/office-web/src/net/api.ts`, `apps/office-web/src/store/reducers.ts`, `apps/office-web/src/ui/BudgetTabs.tsx`, `apps/office-web/src/ui/EventItem.tsx`
- Test: `apps/office-web/src/store/reducers.test.ts`, `apps/office-web/src/ui/BudgetTabs.test.tsx`, `apps/office-web/src/ui/ApprovalCard.test.tsx`, `apps/office-web/src/ui/EventItem.test.tsx`

**Interfaces:**
- Consumes: the API of Tasks 5 and 9, the shared types.
- Produces: `api.capabilities()`, `api.customCapabilities()`, `api.addCapability(input: NewCustomCapability)`, `api.decideCapability(id: string, accept: boolean, o?: { kind?: CapabilityKind; note?: string })`, `api.retireCapability(id: string, note?: string)`, `api.setCapabilityKind(id: string, kind: CapabilityKind)`, `api.outbox()`; `OfficeData.capabilitiesRev: number`, `OfficeData.outboxRev: number`; `Field.options`, `Field.list`, `Field.span` in the Anayasa form; an `outbox.sent` line in the feed.

- [ ] **Step 1: Write the failing tests**

`store/reducers.test.ts`:

```ts
  it('spec capabilities §4, §7: a capability change and an outbox line move their revisions (the open tabs read again); a live snapshot too, an HTTP one not', () => {
    let d = applySnapshot(EMPTY_DATA, snapshot(), 'live');
    const [caps, out] = [d.capabilitiesRev, d.outboxRev];
    d = applyEvent(d, stored({ type: 'capability.changed', change: 'activated', capability: { id: 'sms.send' } } as never, null));
    expect([d.capabilitiesRev, d.outboxRev]).toEqual([caps + 1, out]);
    d = applyEvent(d, stored({ type: 'outbox.sent', entry: { id: 1 } } as never));
    expect([d.capabilitiesRev, d.outboxRev]).toEqual([caps + 1, out + 1]);
    d = applySnapshot(d, snapshot({ lastSeq: d.lastSeq + 1 }), 'http');
    expect([d.capabilitiesRev, d.outboxRev]).toEqual([caps + 1, out + 1]);
    d = applySnapshot(d, snapshot({ lastSeq: d.lastSeq + 2 }), 'live');
    expect([d.capabilitiesRev, d.outboxRev]).toEqual([caps + 2, out + 2]);
  });
```

`ui/BudgetTabs.test.tsx`, inside `describe('ConstitutionTab', …)`:

```ts
  it('spec capabilities §5–§6: the outward policy (four choices), the special contacts (one per line) and the rules', async () => {
    render(<ConstitutionTab />);
    const group = screen.getByRole('group', { name: 'Otonomi politikası' });
    expect(within(group).getAllByRole('combobox').map((s) => s.getAttribute('aria-label'))).toEqual(['Gönderim', 'Yayın', 'Arama', 'Takvim']);
    expect(['Gönderim', 'Yayın', 'Arama', 'Takvim'].map((l) => (screen.getByLabelText(l) as HTMLSelectElement).value)).toEqual(['system', 'system', 'system', 'owner']);
    expect([...(screen.getByLabelText('Takvim') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['Sahibine sor', 'Sistem halletsin']);
    expect(group.textContent).toMatch(/Ödeme, silme, tarayıcı, ofisin kendisi, sınıflandırılmamış araçlar ve komut satırından gönderim her zaman sana gelir/);
    fireEvent.change(screen.getByLabelText('Gönderim'), { target: { value: 'owner' } });
    fireEvent.change(screen.getByLabelText('Özel kişiler'), { target: { value: 'ali@firma.com\n\n +90 532 111 22 33 ' } });
    fireEvent.change(screen.getByLabelText('Arama saatleri'), { target: { value: '10, 18' } });
    fireEvent.change(screen.getByLabelText('Toplu gönderim eşiği (alıcı)'), { target: { value: '3' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Kaydet' })));
    expect(api.setConstitution).toHaveBeenCalledWith(expect.objectContaining({
      outwardPolicy: { send: 'owner', publish: 'system', call: 'system', calendar: 'owner' }, specialContacts: ['ali@firma.com', '+90 532 111 22 33'],
      callHours: [10, 18], bulkRecipients: 3, sendsPerHour: 30, callsPerDay: 20,
    }));
  });

  it('refuses call hours that are not two whole hours, sending nothing', async () => {
    render(<ConstitutionTab />);
    fireEvent.change(screen.getByLabelText('Arama saatleri'), { target: { value: '9' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Kaydet' })));
    expect(screen.getByRole('alert').textContent).toMatch(/Arama saatleri: iki tam saat girin/);
    expect(api.setConstitution).not.toHaveBeenCalled();
  });
```

`ui/ApprovalCard.test.tsx`, inside `describe('ApprovalCard (B9a)', …)`:

```ts
  it('spec capabilities §2: a calendar invitation and a call have labels of their own', () => {
    const { unmount } = render(<ApprovalCard approval={approval({ kind: 'calendar', target: 'create_event summary=Tanışma' })} />);
    expect(screen.getByRole('region', { name: 'Onay: takvim create_event summary=Tanışma' })).toBeTruthy();
    unmount();
    render(<ApprovalCard approval={approval({ kind: 'call', target: 'jeeta_click_to_dial phone=+905321112233' })} />);
    expect(screen.getByText('arama')).toBeTruthy();
  });
```

`ui/EventItem.test.tsx`, inside `describe('EventItem', …)`:

```ts
  it('spec capabilities §7: an outward call let out reads as its outbox line, saying who let it out', () => {
    const entry = { id: 1, employeeId: 'e1', departmentId: null, tool: 'mcp__claude_ai_Gmail__send_message', kind: 'send' as const, target: 'send_message to=a@x.co', recipients: ['a@x.co'], summary: '{}', via: 'system' as const, approvalId: null, at: 0 };
    render(<EventItem stored={{ seq: 1, employeeId: 'e1', ts: 0, event: { type: 'outbox.sent', entry } }} />);
    expect(screen.getByText('Giden: gönderim — send_message to=a@x.co (sistem geçirdi)')).toBeTruthy();
    cleanup();
    render(<EventItem stored={{ seq: 2, employeeId: 'e1', ts: 0, event: { type: 'outbox.sent', entry: { ...entry, kind: 'call', target: 'jeeta_click_to_dial', via: 'owner', approvalId: 'a1' } } }} />);
    expect(screen.getByText('Giden: arama — jeeta_click_to_dial (sahibinin onayıyla)')).toBeTruthy();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd ~/Projects/control-center-departments/apps/office-web && pnpm vitest run src/store/reducers.test.ts src/ui/BudgetTabs.test.tsx src/ui/ApprovalCard.test.tsx src/ui/EventItem.test.tsx`
Expected: FAIL — `capabilitiesRev` undefined, no "Otonomi politikası" group, no outbox line. (The ApprovalCard test may pass already: the labels come from `@cc/shared` since Task 1 — it pins them on the page.)

- [ ] **Step 3: The API client** — in `net/api.ts`, add to the type import `CapabilityCoverage, CapabilityKind, CapabilityVocabulary, CustomCapability, NewCustomCapability, OutboxEntry, UnclassifiedTools`, and to `api`:

```ts
  /** Spec capabilities §4: the vocabulary (the product's and the company's active ones) and how the office has each. */
  capabilities: () => request<CapabilityVocabulary & { coverage: CapabilityCoverage[]; unclassified: UnclassifiedTools[] }>('GET', '/api/capabilities'),
  customCapabilities: () => request<CustomCapability[]>('GET', '/api/custom-capabilities'),
  addCapability: (input: NewCustomCapability) => request<CustomCapability>('POST', '/api/custom-capabilities', input),
  decideCapability: (id: string, accept: boolean, o: { kind?: CapabilityKind; note?: string } = {}) =>
    request<CustomCapability>('POST', `/api/custom-capabilities/${encodeURIComponent(id)}/${accept ? 'accept' : 'reject'}`, o),
  retireCapability: (id: string, note?: string) => request<CustomCapability>('POST', `/api/custom-capabilities/${encodeURIComponent(id)}/retire`, note ? { note } : {}),
  setCapabilityKind: (id: string, kind: CapabilityKind) => request<CustomCapability>('POST', `/api/custom-capabilities/${encodeURIComponent(id)}/kind`, { kind }),
  /** Spec capabilities §7: what the gate let out, the newest 200 (the tab filters them). */
  outbox: () => request<OutboxEntry[]>('GET', '/api/outbox'),
```

- [ ] **Step 4: The store** — in `store/reducers.ts`: in `OfficeData`, after `managementRev: number;`:

```ts
  /** Bumped by every company capability change (and a live snapshot), so an open Yetenekler tab reads again. */
  capabilitiesRev: number;
  /** Bumped by every outbox line (and a live snapshot), so an open Giden kutusu tab reads again. */
  outboxRev: number;
```

add `capabilitiesRev: 0, outboxRev: 0` to `EMPTY_DATA`; in `applySnapshot`'s returned object, after `managementRev: …`:

```ts
    capabilitiesRev: current.capabilitiesRev + (source === 'live' ? 1 : 0),
    outboxRev: current.outboxRev + (source === 'live' ? 1 : 0),
```

and in `applyEvent`, after the `schedule.changed` line:

```ts
  if (ev.type === 'capability.changed') next.capabilitiesRev = d.capabilitiesRev + 1;
  if (ev.type === 'outbox.sent') next.outboxRev = d.outboxRev + 1;
```

- [ ] **Step 5: The Anayasa form** — in `ui/BudgetTabs.tsx`:

Import `type AgentProvider` from `@cc/shared`. In `interface Field`, after `selects?: …`:

```ts
  /** The options of each `selects` select, [value, label]; none: the models. */
  options?: ReadonlyArray<readonly [string, string]>;
  /** A list of text, one entry per line. */
  list?: boolean;
  /** Two whole hours: from, to. */
  span?: boolean;
```

In `FIELDS`, right after the `gateEnabled` entry:

```ts
  {
    key: 'outwardPolicy', label: 'Otonomi politikası',
    hint: 'Kapı açıkken bağlayıcıdan yapılan dışa dönük çağrıyı kim geçirir: Sahibine sor (Onaylar sekmesi) ya da Sistem halletsin (aşağıdaki kurallarla; geçen her çağrı Giden kutusuna yazılır). Ödeme, silme, tarayıcı, ofisin kendisi, sınıflandırılmamış araçlar ve komut satırından gönderim her zaman sana gelir.',
    selects: [['send', 'Gönderim'], ['publish', 'Yayın'], ['call', 'Arama'], ['calendar', 'Takvim']],
    options: [['owner', 'Sahibine sor'], ['system', 'Sistem halletsin']],
  },
  { key: 'specialContacts', label: 'Özel kişiler', hint: 'Satır başına bir e-posta, telefon ya da kullanıcı adı: girdisinde bunlardan biri geçen çağrı her zaman sana gelir (büyük-küçük harf ve telefonun yazılışı fark etmez).', list: true },
  { key: 'sendsPerHour', label: 'Saatlik gönderim sınırı', hint: 'Bir departmanın (departmansız çalışanın kendi) son bir saatte sistemce geçen gönderim + yayın sayısı buna gelince sıradaki sana gelir; 0 = sistem hiç göndermez.' },
  { key: 'bulkRecipients', label: 'Toplu gönderim eşiği (alıcı)', hint: 'Bundan çok alıcılı (to, cc, bcc…) çağrı sana gelir.' },
  { key: 'callHours', label: 'Arama saatleri', hint: 'Sistem yalnız bu yerel saatler arasında arar (ör. 9, 19 = 09:00–19:00).', span: true },
  { key: 'callsPerDay', label: 'Günlük arama sınırı', hint: 'Bir departmanın (departmansız çalışanın kendi) bugünkü sistem araması buna gelince sıradaki sana gelir.' },
```

After `shown`:

```ts
/** A select's options: the field's own, else the models (by Codex's names under Codex). */
const optionsOf = (f: Field, provider: AgentProvider | undefined): ReadonlyArray<readonly [string, string]> =>
  f.options ?? MODEL_ALIASES.map((m) => [m, provider === 'codex' ? modelLabels(provider)[m] : m] as const);
```

In `draftOf`, before the final `return`:

```ts
  if (f.list) return [[f.key, (c[f.key] as string[]).join('\n')]];
```

In `save`, after the `if (f.hours) { … }` block:

```ts
      if (f.list) {
        patch[f.key] = (draft[f.key] ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
        continue;
      }
      if (f.span) {
        const hours = (draft[f.key] ?? '').split(/[\s,;–-]+/).filter(Boolean).map(Number);
        if (hours.length !== 2 || hours.some((h) => !Number.isInteger(h))) {
          setError(`${f.label}: iki tam saat girin (ör. 9, 19).`);
          setBusy(false);
          return;
        }
        patch[f.key] = hours;
        continue;
      }
```

In the render, the selects' options become:

```tsx
                  {optionsOf(f, provider).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
```

and the non-select field's input becomes a textarea for a list:

```tsx
            {f.toggle ? (
              <input type="checkbox" aria-label={f.label} checked={draft[f.key] === 'true'} onChange={(e) => {
                  dirty.current = true;
                  setDraft({ ...draft, [f.key]: String(e.target.checked) });
                }} />
            ) : f.list ? (
              <textarea aria-label={f.label} rows={3} value={draft[f.key] ?? ''} onChange={(e) => {
                  dirty.current = true;
                  setDraft({ ...draft, [f.key]: e.target.value });
                }} />
            ) : (
              <input aria-label={f.label} inputMode="decimal" value={draft[f.key] ?? ''} onChange={(e) => {
                  dirty.current = true;
                  setDraft({ ...draft, [f.key]: e.target.value });
                }} />
            )}
```

- [ ] **Step 6: The feed's outbox line** — in `ui/EventItem.tsx`, add `OUTBOX_VIA_LABELS` to the `@cc/shared` import and, after the `gate.checked` case:

```tsx
    case 'outbox.sent':
      return <div className="note">{`Giden: ${APPROVAL_KIND_LABELS[e.entry.kind]} — ${e.entry.target} (${e.entry.via === 'system' ? 'sistem geçirdi' : OUTBOX_VIA_LABELS.owner})`}</div>;
```

- [ ] **Step 7: Run the web tests and the typecheck**

Run: `cd ~/Projects/control-center-departments/apps/office-web && pnpm vitest run && cd ~/Projects/control-center-departments && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd ~/Projects/control-center-departments
git add apps/office-web/src
git commit -m "feat(web): the Anayasa's outward policy, special contacts and rules; calendar and call labels; outbox lines in the feed; revisions for capabilities and the outbox"
```

---

### Task 12: Web — the Yetenekler and Giden kutusu tabs

**Files:**
- Create: `apps/office-web/src/ui/CapabilitiesTab.tsx`, `apps/office-web/src/ui/OutboxTab.tsx`
- Modify: `apps/office-web/src/ui/CompanyView.tsx`, `apps/office-web/src/styles.css`
- Test: `apps/office-web/src/ui/CapabilitiesTab.test.tsx`, `apps/office-web/src/ui/OutboxTab.test.tsx`, `apps/office-web/src/ui/CompanyView.test.tsx`

**Interfaces:**
- Consumes: Task 11's API client and revisions; `OfficeData.departments` (departments).
- Produces: `CapabilitiesTab`, `OutboxTab`; CompanyView tabs `capabilities` ('Yetenekler') and `outbox` ('Giden kutusu').

- [ ] **Step 1: Write the failing tests**

`ui/CapabilitiesTab.test.tsx`:

```tsx
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capability, CustomCapability } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { CapabilitiesTab } from './CapabilitiesTab.tsx';

const product: Capability[] = [
  { id: 'email.send', title: 'E-posta gönderme', summary: 'Şirket adına e-posta gönderir.', kind: 'send', outward: true, builtin: [], tools: ['mcp__claude_ai_Gmail__send_message'] },
  { id: 'messages.read', title: 'Gelen mesajları ve yorumları okuma', summary: 'Okur.', kind: 'read', outward: false, builtin: [], tools: [] },
];
const custom = (over: Partial<CustomCapability>): CustomCapability => ({
  id: 'sms.send', title: 'SMS gönderme', summary: 'Netgsm ile SMS.', kind: 'send', tools: ['mcp__netgsm__send_sms'], status: 'active',
  proposedBy: 'ada', decidedBy: 'koord', note: null, createdAt: 1, decidedAt: Date.now() - 60_000, ...over,
});
vi.mock('../net/api.ts', () => ({
  api: {
    capabilities: vi.fn(async () => ({ version: 3, capabilities: [...product, { ...product[0]!, id: 'sms.send', company: true }], knownConnectors: [], coverage: [], unclassified: [] })),
    customCapabilities: vi.fn(async () => [
      custom({}),
      custom({ id: 'sms.credits', title: 'SMS kredisi', kind: 'pay', status: 'proposed', decidedBy: null, decidedAt: null, tools: ['mcp__netgsm__buy_credits'] }),
    ]),
    addCapability: vi.fn(async (x: object) => x),
    decideCapability: vi.fn(async () => ({})),
    retireCapability: vi.fn(async () => ({})),
    setCapabilityKind: vi.fn(async () => ({})),
  },
}));
const { api } = await import('../net/api.ts');

beforeEach(() =>
  useOffice.setState({
    capabilitiesRev: 0,
    views: { ada: { employee: { id: 'ada', name: 'Ada' } } as never, koord: { employee: { id: 'koord', name: 'Koordinatör' } } as never },
  }),
);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CapabilitiesTab (spec capabilities §9)', () => {
  it('the product’s read-only with their kinds; the company’s waiting first, then active (a new one marked); the owner approves with a kind, changes a kind, retires', async () => {
    render(<CapabilitiesTab />);
    expect((await screen.findByRole('row', { name: 'email.send' })).textContent).toMatch(/E-posta gönderme.*gönderim/);
    expect(within(screen.getByRole('region', { name: 'Ürünle gelenler' })).queryByRole('row', { name: 'sms.send' })).toBeNull();
    const credits = await within(screen.getByRole('region', { name: 'Karar bekleyenler' })).findByRole('listitem', { name: 'sms.credits' });
    expect(credits.textContent).toMatch(/karar bekliyor/);
    expect(credits.textContent).toMatch(/öneren Ada/);
    fireEvent.click(within(credits).getByRole('button', { name: 'Onayla' }));
    await waitFor(() => expect(api.decideCapability).toHaveBeenCalledWith('sms.credits', true, { kind: 'pay' }));
    const active = within(screen.getByRole('region', { name: 'Şirketin yetenekleri' })).getByRole('listitem', { name: 'sms.send' });
    expect(active.textContent).toMatch(/yeni · koordinatör onayladı/);
    expect(active.textContent).toMatch(/karar Koordinatör/);
    fireEvent.change(within(active).getByLabelText('sms.send türü'), { target: { value: 'pay' } });
    fireEvent.click(within(active).getByRole('button', { name: 'Türü değiştir' }));
    await waitFor(() => expect(api.setCapabilityKind).toHaveBeenCalledWith('sms.send', 'pay'));
    fireEvent.click(within(active).getByRole('button', { name: 'Geri al' }));
    await waitFor(() => expect(api.retireCapability).toHaveBeenCalledWith('sms.send'));
  });

  it('the owner adds one: id, title, summary, kind and the tools, one per line', async () => {
    render(<CapabilitiesTab />);
    const form = screen.getByRole('form', { name: 'Yetenek ekle' });
    fireEvent.change(within(form).getByLabelText('Kimlik'), { target: { value: 'wa.send' } });
    fireEvent.change(within(form).getByLabelText('Başlık'), { target: { value: 'WhatsApp gönderme' } });
    fireEvent.change(within(form).getByLabelText('Açıklama'), { target: { value: 'WhatsApp Business ile mesaj.' } });
    fireEvent.change(within(form).getByLabelText('Tür'), { target: { value: 'send' } });
    fireEvent.change(within(form).getByLabelText('Araçlar'), { target: { value: 'mcp__wa__send\nmcp__wa__send_template' } });
    await act(async () => fireEvent.click(within(form).getByRole('button', { name: 'Ekle' })));
    expect(api.addCapability).toHaveBeenCalledWith({ id: 'wa.send', title: 'WhatsApp gönderme', summary: 'WhatsApp Business ile mesaj.', kind: 'send', tools: ['mcp__wa__send', 'mcp__wa__send_template'] });
  });

  it('shows the server’s Turkish error', async () => {
    vi.mocked(api.addCapability).mockRejectedValueOnce(new Error('email.send ürünle gelen bir yetenek; başka bir kimlik seç.'));
    render(<CapabilitiesTab />);
    const form = screen.getByRole('form', { name: 'Yetenek ekle' });
    fireEvent.change(within(form).getByLabelText('Kimlik'), { target: { value: 'email.send' } });
    await act(async () => fireEvent.click(within(form).getByRole('button', { name: 'Ekle' })));
    expect(within(form).getByRole('alert').textContent).toMatch(/ürünle gelen/);
  });
});
```

`ui/OutboxTab.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboxEntry } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { OutboxTab } from './OutboxTab.tsx';

const entry = (over: Partial<OutboxEntry>): OutboxEntry => ({
  id: 1, employeeId: 'ada', departmentId: 'd1', tool: 'mcp__claude_ai_Gmail__send_message', kind: 'send', target: 'send_message to=a@x.co', recipients: ['a@x.co'],
  summary: '{"to":"a@x.co"}', via: 'system', approvalId: null, at: Date.now(), ...over,
});
vi.mock('../net/api.ts', () => ({
  api: {
    outbox: vi.fn(async () => [
      entry({ id: 3, employeeId: 'can', departmentId: null, kind: 'call', target: 'jeeta_click_to_dial phone=+905321112233', recipients: ['+905321112233'], via: 'owner', approvalId: 'ap1' }),
      entry({ id: 2, departmentId: 'd2', kind: 'publish', target: 'jeeta_publish_social_post post_id=p1', recipients: [] }),
      entry({ id: 1 }),
    ]),
  },
}));

beforeEach(() =>
  useOffice.setState({
    outboxRev: 0,
    departments: { d1: { id: 'd1', name: 'Satış', status: 'open' }, d2: { id: 'd2', name: 'Pazarlama', status: 'open' } } as never,
    views: { ada: { employee: { id: 'ada', name: 'Ada' } } as never, can: { employee: { id: 'can', name: 'Can' } } as never },
  }),
);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('OutboxTab (spec capabilities §7)', () => {
  it('lists what went out, newest first, and who let it out; filters by department (none: the centre) and kind', async () => {
    render(<OutboxTab />);
    await screen.findByRole('row', { name: 'Ada send_message to=a@x.co' });
    const rows = () => screen.getAllByRole('row').map((r) => r.getAttribute('aria-label')).filter(Boolean);
    expect(rows()).toEqual(['Can jeeta_click_to_dial phone=+905321112233', 'Ada jeeta_publish_social_post post_id=p1', 'Ada send_message to=a@x.co']);
    expect(screen.getByRole('row', { name: /^Can/ }).textContent).toMatch(/merkez.*arama.*sahibinin onayıyla/);
    expect(screen.getByRole('row', { name: 'Ada send_message to=a@x.co' }).textContent).toMatch(/Satış.*gönderim.*sistem/);
    fireEvent.change(screen.getByLabelText('Departman'), { target: { value: 'd1' } });
    expect(rows()).toEqual(['Ada send_message to=a@x.co']);
    fireEvent.change(screen.getByLabelText('Departman'), { target: { value: 'none' } });
    expect(rows()).toEqual(['Can jeeta_click_to_dial phone=+905321112233']);
    fireEvent.change(screen.getByLabelText('Departman'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Tür'), { target: { value: 'publish' } });
    expect(rows()).toEqual(['Ada jeeta_publish_social_post post_id=p1']);
    expect(screen.getByText(/"izin verildi" kaydıdır, teslim değil/)).toBeTruthy();
  });
});
```

`ui/CompanyView.test.tsx` — add to the mocked `api` object `capabilities: vi.fn(async () => ({ version: 3, capabilities: [], knownConnectors: [], coverage: [], unclassified: [] })), customCapabilities: vi.fn(async () => []), outbox: vi.fn(async () => [])`, and:

```ts
  it('spec capabilities §9: has a Yetenekler tab and a Giden kutusu tab', async () => {
    render(<CompanyView />);
    fireEvent.click(screen.getByRole('tab', { name: 'Yetenekler' }));
    expect(await screen.findByRole('region', { name: 'Ürünle gelenler' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Giden kutusu' }));
    expect(await screen.findByText(/"izin verildi" kaydıdır/)).toBeTruthy();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd ~/Projects/control-center-departments/apps/office-web && pnpm vitest run src/ui/CapabilitiesTab.test.tsx src/ui/OutboxTab.test.tsx src/ui/CompanyView.test.tsx`
Expected: FAIL — modules not found; no Yetenekler tab.

- [ ] **Step 3: `ui/CapabilitiesTab.tsx`**

```tsx
import { useState, type FormEvent } from 'react';
import { CAPABILITY_KIND_LABELS, CAPABILITY_KINDS, CUSTOM_CAPABILITY_STATUS_LABELS, OWNER, type CapabilityKind, type CustomCapability } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';
import { useLiveRead } from './useLiveRead.ts';

/** A capability the coordinator activated shows as new to the owner this long. */
const NEW_FOR_MS = 7 * 24 * 60 * 60_000;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function useBusy(): [boolean, string | null, (work: () => Promise<unknown>) => Promise<void>] {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };
  return [busy, error, act];
}

/** One company capability: what it is, who proposed and decided it, and what the owner may do with it now. */
function CustomRow({ c, nameOf }: { c: CustomCapability; nameOf: (id: string) => string }) {
  const [busy, error, act] = useBusy();
  const [kind, setKind] = useState<CapabilityKind>(c.kind);
  const fresh = c.status === 'active' && c.decidedBy !== OWNER && c.decidedAt !== null && Date.now() - c.decidedAt < NEW_FOR_MS;
  return (
    <li aria-label={c.id} className={`capability ${c.status}`}>
      <div className="row">
        <code>{c.id}</code> <strong>{c.title}</strong>
        <span className="badge">{CUSTOM_CAPABILITY_STATUS_LABELS[c.status]}</span>
        <span className="badge">{CAPABILITY_KIND_LABELS[c.kind]}</span>
        {fresh && <span className="badge new">yeni · koordinatör onayladı</span>}
      </div>
      <p className="muted">{c.summary}</p>
      <p className="muted">
        araçlar: {c.tools.join(', ')} · öneren {nameOf(c.proposedBy)}
        {c.decidedBy ? ` · karar ${nameOf(c.decidedBy)}` : ''}
        {c.note ? ` · not: ${c.note}` : ''}
      </p>
      {(c.status === 'proposed' || c.status === 'active') && (
        <div className="row end">
          <select aria-label={`${c.id} türü`} value={kind} onChange={(e) => setKind(e.target.value as CapabilityKind)}>
            {CAPABILITY_KINDS.map((k) => (
              <option key={k} value={k}>
                {CAPABILITY_KIND_LABELS[k]}
              </option>
            ))}
          </select>
          {c.status === 'proposed' ? (
            <>
              <button type="button" disabled={busy} onClick={() => void act(() => api.decideCapability(c.id, false, { note: 'Sahibi reddetti.' }))}>
                Reddet
              </button>
              <button type="button" className="primary" disabled={busy} onClick={() => void act(() => api.decideCapability(c.id, true, { kind }))}>
                Onayla
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={busy || kind === c.kind} onClick={() => void act(() => api.setCapabilityKind(c.id, kind))}>
                Türü değiştir
              </button>
              <button type="button" disabled={busy} onClick={() => void act(() => api.retireCapability(c.id))}>
                Geri al
              </button>
            </>
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

const EMPTY = { id: '', title: '', summary: '', kind: 'read' as CapabilityKind, tools: '' };

/** The owner's addition: active at once (the server checks the id, the kind and every tool, and says what is wrong). */
function AddForm() {
  const [draft, setDraft] = useState(EMPTY);
  const [busy, error, act] = useBusy();
  const set = (patch: Partial<typeof EMPTY>) => setDraft({ ...draft, ...patch });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void act(async () => {
      await api.addCapability({ id: draft.id.trim(), title: draft.title.trim(), summary: draft.summary.trim(), kind: draft.kind, tools: draft.tools.split(/[\s,]+/).filter(Boolean) });
      setDraft(EMPTY);
    });
  };
  return (
    <form aria-label="Yetenek ekle" className="capability-add" onSubmit={submit}>
      <h3>Yetenek ekle</h3>
      <label>
        <span>Kimlik</span>
        <input aria-label="Kimlik" placeholder="sms.send" value={draft.id} onChange={(e) => set({ id: e.target.value })} />
      </label>
      <label>
        <span>Başlık</span>
        <input aria-label="Başlık" value={draft.title} onChange={(e) => set({ title: e.target.value })} />
      </label>
      <label>
        <span>Açıklama</span>
        <input aria-label="Açıklama" value={draft.summary} onChange={(e) => set({ summary: e.target.value })} />
      </label>
      <label>
        <span>Tür</span>
        <select aria-label="Tür" value={draft.kind} onChange={(e) => set({ kind: e.target.value as CapabilityKind })}>
          {CAPABILITY_KINDS.map((k) => (
            <option key={k} value={k}>
              {CAPABILITY_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Araçlar</span>
        <textarea aria-label="Araçlar" rows={3} placeholder="mcp__sunucu__araç (satır başına bir)" value={draft.tools} onChange={(e) => set({ tools: e.target.value })} />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row end">
        <button type="submit" className="primary" disabled={busy}>
          Ekle
        </button>
      </div>
    </form>
  );
}

/** Spec capabilities §9: the product's capabilities (read-only) and the company's own — waiting, active, past. */
export function CapabilitiesTab() {
  const rev = useOffice((s) => s.capabilitiesRev);
  const views = useOffice((s) => s.views);
  const nameOf = (id: string) => (id === OWNER ? 'sahibi' : (views[id]?.employee.name ?? id));
  const vocabulary = useLiveRead(rev, () => api.capabilities());
  const custom = useLiveRead(rev, () => api.customCapabilities());
  const product = (vocabulary.data?.capabilities ?? []).filter((c) => !c.company);
  const own = custom.data ?? [];
  const waiting = own.filter((c) => c.status === 'proposed');
  const active = own.filter((c) => c.status === 'active');
  const past = own.filter((c) => c.status === 'rejected' || c.status === 'retired').slice(-10).reverse();
  const list = (items: CustomCapability[], empty: string) =>
    items.length ? (
      <ul>
        {items.map((c) => (
          <CustomRow key={`${c.id}:${c.status}:${c.kind}`} c={c} nameOf={nameOf} />
        ))}
      </ul>
    ) : (
      <p className="muted">{empty}</p>
    );
  const failed = vocabulary.error ?? custom.error;
  return (
    <div className="capabilities">
      <p className="muted">Sözlükte olmayan bir bağlayıcı aracı dışa dönük sayılır, oturumlarda kapanır ve kapıda tutulur. Çalışan yetenek önerir, koordinatör karar verir; koordinatörün kendi önerisi sana gelir. Para ve silme türünü yalnız sen değiştirirsin.</p>
      {failed && (
        <p className="error" role="alert">
          {failed}
        </p>
      )}
      <section aria-label="Karar bekleyenler">
        <h3>Karar bekleyenler</h3>
        {list(waiting, 'Bekleyen öneri yok.')}
      </section>
      <section aria-label="Şirketin yetenekleri">
        <h3>Şirketin yetenekleri</h3>
        {list(active, 'Şirketin eklediği etkin yetenek yok.')}
      </section>
      <AddForm />
      <section aria-label="Ürünle gelenler">
        <h3>Ürünle gelenler (sözlük sürümü {vocabulary.data?.version ?? '—'}, salt okunur)</h3>
        <table>
          <tbody>
            {product.map((c) => (
              <tr key={c.id} aria-label={c.id}>
                <td>
                  <code>{c.id}</code>
                </td>
                <td>{c.title}</td>
                <td>{CAPABILITY_KIND_LABELS[c.kind]}</td>
                <td className="muted">{c.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {past.length > 0 && (
        <section aria-label="Geçmiş">
          <h3>Reddedilen ve geri alınanlar</h3>
          {list(past, '')}
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 4: `ui/OutboxTab.tsx`**

```tsx
import { useState } from 'react';
import { APPROVAL_KIND_LABELS, OUTBOX_VIA_LABELS, OUTWARD_POLICY_KINDS } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';
import { formatWhenTR } from './format.ts';
import { useLiveRead } from './useLiveRead.ts';

/** Spec capabilities §7: what the gate let out, the newest 200, filtered here by department and kind. */
export function OutboxTab() {
  const rev = useOffice((s) => s.outboxRev);
  const departments = useOffice((s) => s.departments);
  const views = useOffice((s) => s.views);
  const [department, setDepartment] = useState('');
  const [kind, setKind] = useState('');
  const { data, error } = useLiveRead(rev, () => api.outbox());
  const all = data ?? [];
  const nameOf = (id: string) => views[id]?.employee.name ?? id;
  const departmentOf = (id: string | null) => (id === null ? 'merkez' : (departments[id]?.name ?? '—'));
  const choices = Object.values(departments).filter((d) => d.status === 'open' || all.some((e) => e.departmentId === d.id));
  const shown = all.filter((e) => (!department || (department === 'none' ? e.departmentId === null : e.departmentId === department)) && (!kind || e.kind === kind));
  const now = Date.now();
  return (
    <div className="outbox">
      <p className="muted">Kapının sistem adına geçirdiği ve senin onayladığın dışa dönük çağrılar (son 200). Bir "izin verildi" kaydıdır, teslim değil; kapı kapalıyken hiçbir şey yazılmaz.</p>
      <div className="row board-filters">
        <label>
          Departman
          <select aria-label="Departman" value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">Hepsi</option>
            <option value="none">Departmansız</option>
            {choices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tür
          <select aria-label="Tür" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Hepsi</option>
            {OUTWARD_POLICY_KINDS.map((k) => (
              <option key={k} value={k}>
                {APPROVAL_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data && shown.length === 0 && <p className="muted">Kayıt yok.</p>}
      <table>
        <tbody>
          {shown.map((e) => (
            <tr key={e.id} aria-label={`${nameOf(e.employeeId)} ${e.target}`}>
              <td>{formatWhenTR(e.at, now)}</td>
              <td>{nameOf(e.employeeId)}</td>
              <td>{departmentOf(e.departmentId)}</td>
              <td>{APPROVAL_KIND_LABELS[e.kind]}</td>
              <td>
                <code>{e.target}</code>
                {e.recipients.length > 0 && <span className="muted">{` → ${e.recipients.join(', ')}`}</span>}
              </td>
              <td>{OUTBOX_VIA_LABELS[e.via]}</td>
              <td className="summary">{e.summary}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 5: The tabs and the styles**

`ui/CompanyView.tsx` — import `CapabilitiesTab` and `OutboxTab`; in `TABS`, right after `['approvals', 'Onaylar'],`:

```ts
  ['capabilities', 'Yetenekler'],
  ['outbox', 'Giden kutusu'],
```

and right after the `tab === 'approvals' ? (<ApprovalsTab />)` branch:

```tsx
        ) : tab === 'capabilities' ? (
          <CapabilitiesTab />
        ) : tab === 'outbox' ? (
          <OutboxTab />
```

`styles.css` — append:

```css
/* Spec capabilities §9: the Yetenekler and Giden kutusu tabs. */
.capabilities ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
.capabilities li.capability { border: 1px solid var(--surface-2); border-radius: 8px; padding: 8px 10px; }
.capabilities li.capability.retired, .capabilities li.capability.rejected { opacity: 0.7; }
.capability-add { display: grid; gap: 6px; margin: 12px 0; }
.badge.new { color: var(--ok); }
.outbox table { width: 100%; }
.outbox td.summary { font-family: monospace; font-size: 12px; word-break: break-all; }
```

- [ ] **Step 6: Run the web suite and the typecheck**

Run: `cd ~/Projects/control-center-departments/apps/office-web && pnpm vitest run && cd ~/Projects/control-center-departments && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd ~/Projects/control-center-departments
git add apps/office-web/src
git commit -m "feat(web): the Yetenekler and Giden kutusu tabs"
```

---

### Task 13: README and final verification

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-10-13-capabilities-autonomy-design.md` (only if the implementation had to differ), `apps/office-server/src/migrations.ts` + `apps/office-server/test/db.test.ts` (renumbering, Step 5)

- [ ] **Step 1: README** — add, right before `## office-server`, in the README's voice:

```markdown
## Yetenekler ve otonomi

- **Yetenek türleri:** sözlükteki her yetenek bir tür taşır — okuma, gönderim, takvim, arama, yayın, ödeme, silme
  (sözlük sürüm 3); kapının onay türü buradan gelir (takvim daveti ve arama artık ayrı türler). `messages.read` gelen
  SMS, WhatsApp ve sosyal medya mesajlarını ve yorumları okur.
- **Şirketin eklediği yetenekler:** sözlükte olmayan bir bağlayıcı aracı dışa dönük sayılır, oturumda kapanır, kapıda
  tutulur. Çalışan `capabilityPropose` ile yetenek önerir; koordinatör `capabilityDecide` ile karar verir — türü yalnız
  sıkılaştırabilir, ödeme ve silme türünü yalnız siz değiştirirsiniz; koordinatörün kendi önerisi size gelir. Şirket
  görünümünün **Yetenekler** sekmesinde ürünle gelenleri görür, yenisini eklersiniz (hemen etkin), bekleyenleri
  onaylar ya da reddeder, etkin olanın türünü değiştirir ya da geri alırsınız (araçları yeniden sınıflandırılmamış
  olur). Yeni bir yetenek, rolüne eklenen kişinin bir sonraki oturumunda açılır.
- **Otonomi politikası (Anayasa):** kapı açıkken bağlayıcıdan yapılan gönderim, yayın, arama ve takvim için "Sahibine
  sor" ya da "Sistem halletsin". Varsayılan: gönderim, yayın, arama sistem; takvim size. Ödeme, silme, tarayıcı,
  ofisin kendisi, sınıflandırılmamış araçlar ve komut satırından (Bash) gönderim her zaman size gelir. **Kapı varsayılan
  kapalı ve bu iş onu açmaz:** politika yalnız kapıyı siz açınca (Anayasa → Geri alınamaz iş kapısı) işler.
- **Kurallar:** departman başına saatlik gönderim + yayın sınırı (`sendsPerHour`, 30; departmansız çalışan kendi
  başına sayılır), toplu gönderim eşiği (`bulkRecipients`, 5 alıcı), özel kişiler (`specialContacts`; e-posta ve
  kullanıcı adında büyük-küçük harf, telefonda yazılış fark etmez), arama saatleri (`callHours`, 9–19) ve departman
  başına günlük arama sınırı (`callsPerDay`, 20). Kuralı aşan çağrı size gelir; gerekçesi kuralı söyler.
- **Giden kutusu:** kapının sistem adına geçirdiği ve sizin onayladığınız her dışa dönük çağrı (gönderim, yayın,
  arama, takvim) kaydedilir — "izin verildi" kaydıdır, teslim değil. **Giden kutusu** sekmesi son 200'ü departmana ve
  türe göre süzer; koordinatör hepsini, başkanlar kendi departmanınınkini `outboxRead` ile okur (her gün örnek okuma
  önerilir).
- **Muhakeme:** herkesin rehberinde "Sistemin senin adına gönderdiği" bölümü var: para sözü, hukuki konu, kriz, bilgi
  tabanında cevabı olmayan soru ve ticari ileti izni (İYS) olmayan kişiye ilk tanıtım çalışan göndermeden önce
  `approvalRequest` (aracın adı ve göndereceği argümanlar) ile size gelir. Kapı içeriği okumaz.
```

- [ ] **Step 2: Nothing turns the gate on**

Run: `cd ~/Projects/control-center-departments && git diff main --stat -- apps/office-server/src packages/shared/src | tail -1 && git grep -n "gateEnabled" -- apps/office-server/src packages/shared/src`
Expected: the `gateEnabled` lines are the ones `main` already has (the shared default `false`, `SWITCHES`, the Gate's `enabled` in `main.ts`) — no new writer of it.

- [ ] **Step 3: Full verification**

Run, from the worktree root:

```bash
cd ~/Projects/control-center-departments
pnpm -r typecheck
pnpm test
```

Expected: typecheck clean; office-server all passing (the baseline at the start of this plan plus the new tests; the real tests skipped), office-web all passing (its baseline plus the new tests). Paste the summary lines into the final report, and say there that the gate is still off: the owner turns it on in Anayasa when they want the policy to act.

- [ ] **Step 4: Commit**

```bash
cd ~/Projects/control-center-departments
git add README.md docs
git commit -m "docs: capabilities and autonomy in the README"
```

- [ ] **Step 5: Renumber when integrating (only when `main`'s last migration is not 24)**

```bash
cd ~/Projects/control-center-departments
git fetch origin && git log --oneline origin/main -5
git rebase main   # resolve migrations.ts: keep main's migrations, ours after them
```

Then in `apps/office-server/src/migrations.ts` set our entry's `version` (and its comment) to main's last + 1, and in `test/db.test.ts` rename `V25_TABLES` and our test's `upTo`/`migrateDown`/`toBe` numbers the same way, building on main's last `V…_TABLES`. Run `pnpm test`; commit `chore(autonomy): migration <n>, after main's <n − 1>`. Never apply a renumbered migration to the live database before the code that has it is the office's code (the migration guard stops the office otherwise).
