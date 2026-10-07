# Company layer — deferred follow-ups

Minor findings from the four final reviews (phases 1–4) that were recorded but not fixed. None blocks use; each is
small. Grouped by area, roughly most useful first.

## Dispatcher and tasks
- Unblocking a task while another is running yields two `in_progress` tasks (`Company.update`, `TaskStore.inProgressOf`).
- A failed delivery reverts the task with `tasks.update` and no event (the board shows "Sürüyor" until refresh).
- Deferred callbacks and the timer callback (`checkReserve`) are not wrapped in try/catch.
- Chain depth is measured only from the passer's in-progress task.
- The snapshot loads every closed task to keep the last 50 (`ORDER BY finished_at DESC LIMIT 50` would do).
- `applySnapshot` replaces tasks/plans wholesale; events between the HTTP fetch and its apply are lost until refresh.
- A crash between `fire` and `releaseTasksOf` leaves tasks `in_progress` for an archived employee (no startup sweep).

## Memory
- Leaving banner says "Devir yapıyor" for a stopped/limited/error employee; no owner "cancel hand-over".
- The coordinator is not told when someone with no open work leaves.
- Archive `cpSync` is synchronous (≤ 100 MB) and copies `node_modules`/`.git` if listed.
- Playbook mirror files can collide on slug (`a-b-testi`).
- Web: `History` has no error path; the employee file does not refresh while open; the leaving button flashes.
- `employeeNote` read cannot find a fired employee (`findPerson` excludes archived).

## Budget
- "Kota payı devrede" repeats after every office restart (`#wasActive` starts false).
- `wake` tool says "uyandı" for someone not asleep; `setModel` reply says "yeniden açılıyor" even when deferred.
- Notices still cost an awake member a turn during the reserve. *(office-economy: closed for information notices, which
  wait during the reserve; a decision notice still opens a turn, by design.)*
- A sleeper whose hand-over is done is not let go (practically unreachable).
- `chargeTurn` ignores blocked tasks.
- "1,000" parses as 1 in the Anayasa form; no colour for `.badge.sleeping`.

## Proposals, leads, plans
- `decideProposal` writes the store before `recordDecision` can throw (unreachable via MCP).
- Plan version numbers are reused after a kept revision (two "sürüm 2" cards).
- A plan whose last task finishes during the revision window never reaches `done` after a decline.
- The meeting room overrides the "turns to you" cue while the owner types.
- Old proposal cards outside the snapshot window may show Onayla/Reddet (the server answers 409).
- Lead rights key on `team`, routing on `reportsTo`; two leads per team are allowed.
- Daily reminder edges: a fresh coordinator with an old `createdAt`, a stopped coordinator accumulating reminders, the
  in-memory map across restarts. *(office-economy: the reminder is no longer a notice but a line of the last digest hour's
  digest, so nothing accumulates and `createdAt` is not used; the in-memory map remains: after a restart an unanswered
  reminder can come once more.)*
- `askColleague` has no per-day cap and can hold an MCP call up to 120 s.
- `taskCreate`/`taskAssign`/`taskReprioritize` descriptions still say "(coordinator)"; the proposer is not told on a
  lead → coordinator escalation.
- Misc: `officeStatus` prints lifecycles in English; `hire` tool's character enum is computed at startup; `reportsTo`
  is not checked against the roster; the bearer token is visible in `/proc` via `--mcp-config` (accepted in spec §7).
