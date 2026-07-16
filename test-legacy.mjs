const dmdb = require('./out/src/server.js' ? './node_modules/dmdb' : 'dmdb');
// Actually just test if we can detect the flag
console.log('execArgv:', JSON.stringify(process.execArgv));
console.log('NODE_OPTIONS:', process.env.NODE_OPTIONS);
console.log('Has openssl-legacy:', process.execArgv.includes('--openssl-legacy-provider'));