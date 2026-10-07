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
- ~~Notices still cost an awake member a turn during the reserve.~~ **Closed (office-economy):** information notices
  wait during the reserve and open no turn; only a decision notice does, by design.
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

## Office economy (fresh review before merge, 2026-10-07)
Important #1 (owner's message moved a member mid-task) and #2 (a turn that worked then failed was re-run as a model
failure) were fixed with tests before the merge. #3 (un-acked messages handled twice on a failed switch) does not
happen: `#onExit` empties `unread` before `close()` resolves, so `#halt` finds nothing; a test pins it.
- `engine.ts:60`, `budget.ts:35`, `BudgetTabs.tsx:124` still call `cacheTtlMinutes` the cache's warm time ("bekleme süresi").
- `economy-results.md` keeps an unmeasured "cold after a 30-min sleep" claim.
- Waking a sleeper and then hinting a task's model spawns `claude` twice (wake on own model, then switch).
- A member's digest-only turn runs on their own model and costs a turn with nothing to do.
- Failed-trial exits count toward the crash window (two in 120 s → `error`).
- `report.reminded` is logged before delivery is proven; a lost reminder is not retried for that slot.
- `#putBack` updates the task without a `task.changed` event (board stale until refresh).
- `budgetStatus` text changed format even with the switches off (not listed among the deliberate differences).
- `economy-live-baseline.md` holds real office data (names, per-employee USD): fine while the repo is private.
- The coordinator's own tasks use `coordinatorModels.decision`, never the task's difficulty.

## Coordinator craft, stage 1 (final review, 2026-10-07)
The one Important finding (a let-go doer's task sent back by the coordinator was orphaned silently) was fixed with
tests before the merge. Deferred minors:
- A second review round on the same day overwrites round 1's archive folder (`<day>-<id>-<title>`); the database and
  the round-1 review brief keep it.
- `review.stuck` never reaches a coordinator who is itself the reviewer; the `reviewDecide` reply does not repeat the
  "change the approach or take it to the owner" guidance at round 3.
- A lead doing their own task can swap its reviewer for one of their reports via `taskAssign`; `Company.assign`
  accepts `reviewer: null` (MCP cannot send it).
- The coordinator as doer whose only reviewer leaves after hand-in resolves it only by assigning the review to someone
  else or hiring.
- The digest-off daily report reminder's open-work check does not count tasks in review.
- The digest still has a "Plan durumu" group for `plan.done`, which nothing emits any more.
- A reviewer whose review the coordinator decides over their head is not told.
- `taskAssign` on a review task ignores an explicit `reviewer` argument silently.

## Coordinator craft, stage 2 (final review, 2026-10-07)
The four Important findings were fixed with tests before the merge: a cancelled task could be revived through
`taskUpdate`; an owner-stopped goal could be reopened and a finished plan of a closed goal reopened by a new task; the
pulse left stale "no plan" notices while the coordinator was mid-turn; an approved plan with no task silenced the pulse.
Deferred minors:
- The owner cannot see that the coordinator is resting or why (`restReason` is not in the snapshot).
- Under `plans`, a running plan with a pending revision is a draft: no Durdur until the revision is declined.
- Pause / resume errors in the top bar are swallowed.
- An owner's stop gives two coordinator turns (`plan.stopped`, then `pulse.goal_idle` for the same goal).
- `goalsRead` lists only the newest 100 plans.
- No test yet for a sleeping coordinator staying asleep through a pause and waking once on resume (the code path is right).
- The `restUntil` reply says the owner's request ends the rest; only a new goal does.
