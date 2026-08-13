const http = require('http');
const os = require('os');
const {createApp} = require('./app');
const {config} = require('./config');
const {connectMongo} = require('./db/connect');
const {ensureDemoAdmin} = require('./bootstrap/ensureDemoAdmin');
const {attachChatSocket} = require('./realtime/socket');

function listLanIpv4() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const entries of Object.values(nets)) {
    for (const net of entries || []) {
      const family = net.family === 4 || net.family === 'IPv4';
      if (family && !net.internal && net.address) {
        out.push(net.address);
      }
    }
  }
  return out;
}

async function start() {
  await connectMongo();
  await ensureDemoAdmin();

  const app = createApp();
  const server = http.createServer(app);
  attachChatSocket(server, app);

  // 0.0.0.0 = accept connections from every LAN device (phones, tablets, etc.)
  const host = config.host || '0.0.0.0';
  server.listen(config.port, host, () => {
    const lan = listLanIpv4();
    console.log('');
    console.log('Callkaro backend running (MongoDB)');
    console.log(`  Bind:    ${host}:${config.port} (all interfaces)`);
    console.log(`  Local:   http://localhost:${config.port}/api`);
    for (const ip of lan) {
      console.log(`  LAN:     http://${ip}:${config.port}/api`);
      console.log(`  Health:  http://${ip}:${config.port}/api/health`);
      console.log(`  Socket:  ws://${ip}:${config.port}`);
    }
    if (!lan.length) {
      console.log('  LAN:     (no IPv4 LAN address found)');
    }
    console.log(`  OTP:     ${config.devOtp}`);
    console.log(
      `  S3:      ${config.s3Bucket ? `${config.s3Bucket} (${config.s3Region})` : 'not configured'}`,
    );
    console.log('');
    console.log(
      'If phones get "Request timed out", run scripts/allow-lan-firewall.ps1 as Administrator.',
    );
    console.log('');
  });
}

start().catch(error => {
  console.error('Failed to start backend:', error.message);
  process.exit(1);
});
