const http = require('http');
const {createApp} = require('./app');
const {config} = require('./config');
const {connectMongo} = require('./db/connect');
const {ensureDemoAdmin} = require('./bootstrap/ensureDemoAdmin');
const {attachChatSocket} = require('./realtime/socket');

async function start() {
  await connectMongo();
  await ensureDemoAdmin();

  const app = createApp();
  const server = http.createServer(app);
  attachChatSocket(server, app);

  server.listen(config.port, config.host, () => {
    console.log('');
    console.log('Callkaro backend running (MongoDB)');
    console.log(`  Local:   http://localhost:${config.port}/api`);
    console.log(`  Health:  http://localhost:${config.port}/api/health`);
    console.log(`  Socket:  ws://localhost:${config.port}`);
    console.log(`  OTP:     ${config.devOtp}`);
    console.log(
      `  S3:      ${config.s3Bucket ? `${config.s3Bucket} (${config.s3Region})` : 'not configured'}`,
    );
    console.log('');
  });
}

start().catch(error => {
  console.error('Failed to start backend:', error.message);
  process.exit(1);
});
