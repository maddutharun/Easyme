const app = require('./backend/app');

let port = Number(process.env.PORT || 3000);
const maxAttempts = 10;
let attempts = 0;

const start = () => {
  const ready = app.ready || Promise.resolve();
  ready.then(() => {
    const server = app.listen(port, () => {
      console.log('');
      console.log('EasyMe BUILD=premium-login');
      console.log('Open http://localhost:' + port + '  → you must see a dark Sign in screen (not Ari R.).');
      console.log('Prove this process: http://localhost:' + port + '/__build  → {"build":"premium-login",...}');
      console.log('If the UI still says EasyMe Invoice Intelligence / Ari R. / Finance Ops,');
      console.log('another Node process is bound to that port (usually git branch main). Kill it and start this checkout.');
      console.log('Demo login: finance@easyme.local  /  demo123');
      console.log('');
    }).on('error', (err) => {
      if (err.code === 'EADDRINUSE' && attempts < maxAttempts) {
        attempts++;
        port++;
        console.log('Port ' + (port - 1) + ' is busy. Retrying on ' + port + '.');
        server.listen(port);
      } else {
        console.error('Server error:', err);
        process.exit(1);
      }
    });
  });
};

start();
