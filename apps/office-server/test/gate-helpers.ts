import type { GateContext } from '../src/company/gate-policy.ts';

/** The gate's context for tests (B9a): a home, the live checkout, its worktrees and their state, scripts — all fixed. */
export const HOME = '/home/x';
export const REPO = `${HOME}/Projects/control-center`;
export const DATA = `${HOME}/.control-center`;
export const DESK = `${DATA}/desks/mert`;

/** REPO_ROOT's registered worktrees and whether each has uncommitted work (the real one asks git; K2 does that). */
const WORKTREES: Record<string, boolean> = {
  [`${HOME}/Projects/control-center-core3`]: true,
  [`${HOME}/Projects/control-center-x`]: false,
  [`${HOME}/Projects/control-center-b11`]: false,
  '/tmp/m': false,
  '/tmp/wt-x': false,
};
const SCRIPTS: Record<string, string> = {
  [`${DESK}/release.sh`]: 'cd ~/Projects/control-center-x\ngit push origin main\n',
  [`${DESK}/check.sh`]: 'pnpm test\npnpm typecheck\n',
};

export function testContext(over: Partial<GateContext> = {}): GateContext {
  return {
    home: HOME,
    repoRoot: REPO,
    dataDir: DATA,
    deskDir: DESK,
    officePort: 4319,
    officeHosts: [],
    tmpDirs: ['/tmp'],
    toplevel: (p) => {
      if (p === REPO || p.startsWith(`${REPO}/`)) return REPO;
      const project = /^(\/home\/x\/Projects\/[^/]+)/.exec(p);
      if (project) return project[1]!;
      const tmp = /^(\/tmp\/[^/]+)/.exec(p);
      return tmp ? tmp[1]! : null;
    },
    worktrees: () => Object.keys(WORKTREES),
    dirty: (wt) => WORKTREES[wt] ?? false,
    readScript: (p) => SCRIPTS[p] ?? null,
    realpath: (p) => p,
    ...over,
  };
}

