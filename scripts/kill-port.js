const { execSync } = require('child_process');

function parsePortArg() {
  const raw = process.argv[2] || '3000';
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Ungueltiger Port: ${raw}`);
  }
  return port;
}

function getPidsByPortWindows(port) {
  const cmd = `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`;
  const output = execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function killPidWindows(pid) {
  execSync(`taskkill /PID ${pid} /F`, { stdio: ['ignore', 'pipe', 'pipe'] });
}

function getPidsByPortUnix(port) {
  const output = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  return output
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function killPidUnix(pid) {
  execSync(`kill -9 ${pid}`, { stdio: ['ignore', 'pipe', 'pipe'] });
}

function unique(values) {
  return Array.from(new Set(values));
}

function main() {
  const port = parsePortArg();
  const isWindows = process.platform === 'win32';

  let pids = [];
  try {
    pids = isWindows ? getPidsByPortWindows(port) : getPidsByPortUnix(port);
  } catch (_err) {
    pids = [];
  }

  pids = unique(pids).filter((pid) => pid !== process.pid);

  if (pids.length === 0) {
    console.log(`Port ${port} ist frei.`);
    return;
  }

  for (const pid of pids) {
    try {
      if (isWindows) killPidWindows(pid);
      else killPidUnix(pid);
      console.log(`Prozess auf Port ${port} beendet (PID ${pid}).`);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      console.warn(`Konnte PID ${pid} nicht beenden: ${message}`);
    }
  }
}

try {
  main();
} catch (err) {
  const message = err && err.message ? err.message : String(err);
  console.error(`kill-port fehlgeschlagen: ${message}`);
  process.exit(1);
}
