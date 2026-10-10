import { spawn } from 'node:child_process';

/** Capture and stop descendants while the parent still exists; otherwise Windows can orphan MCP/tool processes. */
export function stopWindowsDescendants(pid: number | undefined): Promise<void> {
  if (process.platform !== 'win32' || pid === undefined) return Promise.resolve();
  return new Promise(resolve => {
    const helper = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      `$children = Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${pid}'; foreach ($child in $children) { & taskkill.exe /PID $child.ProcessId /T /F | Out-Null }`], { windowsHide: true, stdio: 'ignore' });
    const timeout = setTimeout(() => { helper.kill(); resolve(); }, 5000);
    const done = () => { clearTimeout(timeout); resolve(); };
    helper.on('error', done); helper.on('close', done);
  });
}
