// Score Studio desktop: the web studio in a window, with its models running on
// this computer. Two loopback-only children do the work: the audio.cpp engine
// (GPU inference) and the studio's Next.js server (UI + audio preparation).
const {app, BrowserWindow, dialog, shell} = require('electron');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const studioDir = process.env.SCORE_STUDIO_DIR || path.join(repo, 'outputs', 'score-studio');
const engineBinary = process.env.SCORE_ENGINE_BIN ||
  path.join(repo, 'flutter_app', 'native', 'build-server', 'bin',
    process.platform === 'win32' ? 'audiocpp_server.exe' : 'audiocpp_server');
const modelsDir = process.env.SCORE_MODELS_DIR || path.join(__dirname, 'models');
const children = [];

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const {port} = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitFor(url, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {signal: AbortSignal.timeout(2000)});
      if (response.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${label} did not start.`);
}

function launch(label, command, args, options) {
  const child = spawn(command, args, {stdio: ['ignore', 'pipe', 'pipe'], ...options});
  const log = (chunk) => process.stdout.write(`[${label}] ${chunk}`);
  child.stdout.on('data', log);
  child.stderr.on('data', log);
  child.once('exit', (code) => log(`exited (${code})\n`));
  children.push(child);
  return child;
}

// Metadata arenas only; weights and workspaces are allocated separately. The
// upstream defaults reserve several GiB, which an 8 GB machine cannot spare.
function engineConfig(port) {
  const models = [];
  const sheetsage = path.join(modelsDir, 'sheetsage2', 'sheetsage2-orig.gguf');
  if (fs.existsSync(sheetsage)) {
    models.push({
      id: 'sheetsage2', family: 'sheetsage2', path: sheetsage, task: 'midi', mode: 'offline',
      session_options: {weight_context_mb: '16', decoder_graph_arena_mb: '128'},
    });
  }
  const yue = path.join(modelsDir, 'yue2');
  if (fs.existsSync(path.join(yue, 'yue2-3b-q4_0.gguf'))) {
    models.push({
      id: 'yue2', family: 'yue2', path: yue, task: 'gen', mode: 'offline',
      session_options: {
        model_gguf: 'yue2-3b-q4_0.gguf', vae_gguf: 'yue2-vae-f16.gguf',
        model_weight_context_mb: '16', vae_weight_context_mb: '16',
        ar_prefill_graph_arena_mb: '128', ar_decode_graph_arena_mb: '128',
        nar_graph_arena_mb: '128', vae_graph_arena_mb: '128',
      },
    });
  }
  return {
    host: '127.0.0.1', port,
    backend: process.env.SCORE_ENGINE_BACKEND || (process.platform === 'darwin' ? 'metal' : 'cuda'),
    device: 0, threads: 4, lazy_load: true,
    // One model in memory at a time, released when idle: generation and
    // transcription never have to share RAM.
    max_loaded_models: 1, idle_unload_ms: 120000,
    models,
  };
}

async function start() {
  if (!fs.existsSync(engineBinary)) throw new Error(`The music engine is missing: ${engineBinary}`);
  const [enginePort, studioPort] = [await freePort(), await freePort()];
  const config = engineConfig(enginePort);
  if (!config.models.length) throw new Error(`No models were found in ${modelsDir}.`);
  const configPath = path.join(app.getPath('userData'), 'engine.json');
  fs.mkdirSync(path.dirname(configPath), {recursive: true});
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  launch('engine', engineBinary, ['--config', configPath, '--no-ui']);

  const origin = `http://127.0.0.1:${studioPort}`;
  const env = {
    ...process.env,
    SCORE_BACKEND: 'local',
    LOCAL_ENGINE_URL: `http://127.0.0.1:${enginePort}`,
    APP_ORIGIN: origin, HOSTNAME: '127.0.0.1', PORT: String(studioPort),
  };
  const standalone = path.join(studioDir, '.next', 'standalone', 'server.js');
  if (app.isPackaged || process.env.SCORE_STUDIO_BUILT) {
    launch('studio', process.execPath, [standalone],
      {cwd: path.dirname(standalone), env: {...env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production'}});
  } else {
    launch('studio', process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['next', 'dev', '--hostname', '127.0.0.1', '--port', String(studioPort)], {cwd: studioDir, env});
  }
  console.log(`[desktop] engine http://127.0.0.1:${enginePort} · studio ${origin}`);
  await Promise.all([
    waitFor(`http://127.0.0.1:${enginePort}/v1/models`, 'The music engine', 60000),
    waitFor(origin, 'The studio', 120000),
  ]);

  const window = new BrowserWindow({
    width: 1360, height: 900, minWidth: 900, minHeight: 600, backgroundColor: '#111111',
    title: 'Score Studio',
    webPreferences: {contextIsolation: true, nodeIntegration: false, sandbox: true},
  });
  // The window only ever shows the local studio; everything else opens in the browser.
  window.webContents.setWindowOpenHandler(({url}) => { shell.openExternal(url); return {action: 'deny'}; });
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) { event.preventDefault(); shell.openExternal(url); }
  });
  await window.loadURL(origin);
}

function stop() {
  for (const child of children.splice(0)) child.kill();
}

app.whenReady().then(start).catch((error) => {
  stop();
  dialog.showErrorBox('Score Studio could not start', error.message);
  app.exit(1);
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', stop);
process.on('exit', stop);
