const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const AdmZip = require('adm-zip');

const ROOT_DIR = path.resolve(__dirname, '..');
const PORTABLE_DIR = path.join(ROOT_DIR, 'JeopardyPortable');
const MONGODB_SOURCE_DIR = path.join(ROOT_DIR, 'mongodb');
const APP_PORT = 3000;
const DB_PORT = 27017;

function runCommand(command, args, options = {}) {
  const isWindows = process.platform === 'win32';
  const executable = isWindows && command === 'npm' ? 'npm.cmd' : command;
  const result = spawnSync(executable, args, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    shell: false,
    ...options
  });

  if (result.status !== 0) {
    throw new Error(`Befehl fehlgeschlagen: ${command} ${args.join(' ')}`);
  }
}

function runNpm(args) {
  if (process.env.npm_execpath) {
    runCommand(process.execPath, [process.env.npm_execpath, ...args]);
    return;
  }

  runCommand('npm', args);
}

function ensureRootNodeModules() {
  if (fs.existsSync(path.join(ROOT_DIR, 'node_modules'))) {
    return;
  }

  console.log('node_modules fehlen. Fuehre npm install aus...');
  runNpm(['install']);
}

function ensureBuildArtifacts() {
  console.log('Baue Anwendung fuer Portable-Export...');
  runNpm(['run', 'build']);

  const serverBuild = path.join(ROOT_DIR, 'output', 'dist', 'server.js');
  const publicBuild = path.join(ROOT_DIR, 'output', 'public', 'host.html');
  if (!fs.existsSync(serverBuild) || !fs.existsSync(publicBuild)) {
    throw new Error('Build-Artefakte fehlen nach npm run build.');
  }
}

function recreatePortableDir() {
  fs.rmSync(PORTABLE_DIR, { recursive: true, force: true });
  fs.mkdirSync(PORTABLE_DIR, { recursive: true });
}

function copyRecursive(source, target) {
  fs.cpSync(source, target, { recursive: true, dereference: true });
}

function copyPortableAssets() {
  console.log('Kopiere dist/public und node_modules...');
  copyRecursive(path.join(ROOT_DIR, 'output', 'dist'), path.join(PORTABLE_DIR, 'dist'));
  copyRecursive(path.join(ROOT_DIR, 'output', 'public'), path.join(PORTABLE_DIR, 'public'));
  copyRecursive(path.join(ROOT_DIR, 'node_modules'), path.join(PORTABLE_DIR, 'node_modules'));
}

function writePortablePackageFiles() {
  const packageJson = {
    name: 'jeopardy-quiz-ts',
    version: '1.0.0',
    description: 'Interactive Jeopardy Quiz Portable',
    main: 'dist/server.js',
    scripts: {
      start: 'node dist/server.js'
    }
  };

  fs.writeFileSync(path.join(PORTABLE_DIR, 'package.json'), JSON.stringify(packageJson, null, 2));

  const packageLockPath = path.join(ROOT_DIR, 'package-lock.json');
  if (fs.existsSync(packageLockPath)) {
    fs.copyFileSync(packageLockPath, path.join(PORTABLE_DIR, 'package-lock.json'));
  }
}

function copyNodeBinary() {
  if (process.platform !== 'win32') {
    return;
  }

  fs.copyFileSync(process.execPath, path.join(PORTABLE_DIR, 'node.exe'));
}

function resolveMongoArchivePath() {
  if (!fs.existsSync(MONGODB_SOURCE_DIR)) {
    throw new Error('Der Ordner mongodb fehlt.');
  }

  const zipFiles = fs.readdirSync(MONGODB_SOURCE_DIR)
    .filter((fileName) => fileName.toLowerCase().endsWith('.zip'))
    .sort();

  if (zipFiles.length === 0) {
    throw new Error('Im Ordner mongodb wurde keine MongoDB-ZIP gefunden.');
  }

  return path.join(MONGODB_SOURCE_DIR, zipFiles[zipFiles.length - 1]);
}

function copyMongoBinaries() {
  console.log('Extrahiere MongoDB-Dateien aus mongodb/*.zip...');
  const zipPath = resolveMongoArchivePath();
  const archive = new AdmZip(zipPath);
  const entries = archive.getEntries();

  const requiredFiles = ['mongod.exe', 'mongos.exe'];
  for (const fileName of requiredFiles) {
    const entry = entries.find((candidate) => candidate.entryName.toLowerCase().endsWith(`/bin/${fileName}`));
    if (!entry) {
      if (fileName === 'mongos.exe') {
        continue;
      }
      throw new Error(`${fileName} wurde in ${path.basename(zipPath)} nicht gefunden.`);
    }

    archive.extractEntryTo(entry, PORTABLE_DIR, false, true, fileName);
  }
}

function writeBatchFiles() {
  const startBat = `@echo off
TITLE Jeopardy Server (Portable)
CLS

net session >nul 2>&1
if %errorLevel% == 0 (
    goto :gotAdmin
) else (
    echo Fordere Administrator-Rechte an, um Firewall freizuschalten...
    powershell -Command "Start-Process '%~0' -Verb RunAs"
    exit /b
)

:gotAdmin
cd /d "%~dp0"

echo.
echo Konfiguriere Windows Firewall fuer Zugriff von Handys...
netsh advfirewall firewall delete rule name="Jeopardy Quiz Ports" >nul 2>&1
netsh advfirewall firewall add rule name="Jeopardy Quiz Ports" dir=in action=allow protocol=TCP localport=${APP_PORT} profile=any
echo Firewall erfolgreich konfiguriert!
echo.

echo Starte Datenbank...
if not exist "database" mkdir database
powershell -NoProfile -ExecutionPolicy Bypass -Command "$mongo = Start-Process -FilePath '.\\mongod.exe' -ArgumentList '--dbpath', '.\\database', '--port', '${DB_PORT}', '--bind_ip', '127.0.0.1' -WindowStyle Minimized -PassThru; Start-Sleep -Seconds 4; $serverCmd = '/c set PORT=${APP_PORT}&& set DB_URI=mongodb://127.0.0.1:${DB_PORT}/jeopardyquiz&& node.exe dist\\server.js'; $server = Start-Process -FilePath 'cmd.exe' -ArgumentList $serverCmd -WorkingDirectory '.' -WindowStyle Minimized -PassThru; @{ mongoPid = $mongo.Id; serverPid = $server.Id } | ConvertTo-Json | Set-Content '.\\database\\portable-pids.json'"

timeout /t 2 /nobreak >nul

echo Oeffne Browser...
start http://localhost:${APP_PORT}/create.html

echo.
echo ========================================================
echo   SERVER LAEUFT!
echo   Die Firewall fuer Port ${APP_PORT} ist offen.
echo   Andere Geraete koennen sich jetzt verbinden.
echo ========================================================
echo.
echo Zum Beenden nutzen Sie bitte 'stop_quiz.bat'.
pause
`;

  const stopBat = `@echo off
echo Beende Jeopardy Server...

net session >nul 2>&1
if %errorLevel% == 0 (
    goto :gotAdmin
) else (
    echo Keine Admin-Rechte. Fordere sie an...
    powershell -Command "Start-Process '%~0' -Verb RunAs"
    exit /b
)

:gotAdmin
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$pidFile = '.\\database\\portable-pids.json'; if (Test-Path $pidFile) { $data = Get-Content $pidFile | ConvertFrom-Json; if ($data.serverPid) { taskkill /PID $data.serverPid /T /F *> $null }; if ($data.mongoPid) { taskkill /PID $data.mongoPid /T /F *> $null }; Remove-Item $pidFile -Force }"

netsh advfirewall firewall delete rule name="Jeopardy Quiz Ports" >nul 2>&1

echo.
echo Alles beendet.
pause
`;

  fs.writeFileSync(path.join(PORTABLE_DIR, 'start_quiz.bat'), startBat);
  fs.writeFileSync(path.join(PORTABLE_DIR, 'stop_quiz.bat'), stopBat);
}

function ensurePortableFolders() {
  fs.mkdirSync(path.join(PORTABLE_DIR, 'database'), { recursive: true });
}

async function main() {
  console.log('Starte Portable-Generierung...');
  ensureRootNodeModules();
  ensureBuildArtifacts();
  recreatePortableDir();
  copyPortableAssets();
  writePortablePackageFiles();
  copyNodeBinary();
  ensurePortableFolders();
  copyMongoBinaries();
  writeBatchFiles();

  console.log('Portable-Version erstellt.');
  console.log(`Ordner: ${PORTABLE_DIR}`);
  console.log('Startskript: JeopardyPortable/start_quiz.bat');
}

main().catch((err) => {
  const message = err && err.message ? err.message : String(err);
  console.error(`portable fehlgeschlagen: ${message}`);
  process.exit(1);
});
