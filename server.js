const app = require('./backend/app');

let port = 3000;
const maxAttempts = 10;
let attempts = 0;

const server = app.listen(port, () => {
  console.log('Invoice Intelligence Hub running at http://localhost:' + port);
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
