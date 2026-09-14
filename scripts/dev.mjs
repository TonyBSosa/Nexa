import { spawn } from 'node:child_process';

const services = [
  {
    name: 'API', args: ['run', 'dev', '-w', '@nexa/api'],
    url: 'http://127.0.0.1:3000/api/health',
    identifies: body => body.includes('"service":"nexa-api"'),
  },
  {
    name: 'Web', args: ['run', 'dev', '-w', '@nexa/web'],
    url: 'http://127.0.0.1:5173',
    identifies: body => body.includes('<title>NEXA</title>'),
  },
];

async function isRunning(service) {
  try {
    const response = await fetch(service.url, { signal: AbortSignal.timeout(2_000) });
    return response.ok && service.identifies(await response.text());
  } catch {
    return false;
  }
}

function startNpm(args) {
  const options = { stdio: 'inherit', env: process.env };
  if (process.platform === 'win32') {
    return spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], options);
  }
  return spawn('npm', args, options);
}

const running = await Promise.all(services.map(isRunning));
const pending = services.filter((_service, index) => !running[index]);
services.filter((_service, index) => running[index])
  .forEach(service => console.log(`${service.name} ya está en ejecución en ${service.url}`));

const children = pending.map(service => {
  const child = startNpm(service.args);
  child.on('error', error => console.error(`${service.name} no pudo iniciar: ${error.message}`));
  return { name: service.name, child };
});

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const { child } of children) {
    if (!child.killed) child.kill();
  }
  process.exitCode = exitCode;
}

for (const { name, child } of children) {
  child.on('exit', code => {
    if (stopping) return;
    if (code !== 0) console.error(`${name} se detuvo con código ${code ?? 1}.`);
    stop(code ?? 1);
  });
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
