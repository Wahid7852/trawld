const { spawn } = require('child_process');
const path = require('path');

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const localCloudHttp = process.env.CLOUD_HTTP || 'http://127.0.0.1:4000';
const localCloudWs = process.env.CLOUD_WS || 'ws://127.0.0.1:4000/agents';

const commands = [
  { name: 'CLOUD', cwd: 'cloud', cmd: npmCommand, args: ['start'], env: process.env },
  {
    name: 'AGENT',
    cwd: 'agent',
    cmd: npmCommand,
    args: ['start'],
    env: {
      ...process.env,
      CLOUD_HTTP: localCloudHttp,
      CLOUD_WS: localCloudWs,
      SENTRY_DEFAULT_CLOUD_HTTP: localCloudHttp
    }
  }
];

commands.forEach(({ name, cwd, cmd, args, env }) => {
  const child = spawn(cmd, args, {
    cwd: path.join(__dirname, cwd),
    env,
    stdio: 'pipe'
  });

  console.log(`[${name}] Starting...`);

  child.stdout.on('data', (data) => {
    process.stdout.write(`[${name}] ${data}`);
  });

  child.stderr.on('data', (data) => {
    process.stderr.write(`[${name}] ${data}`);
  });

  child.on('close', (code) => {
    console.log(`[${name}] exited with code ${code}`);
  });
});
