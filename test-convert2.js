const http = require('http');
// auth_session_id from the proxy capture (already extracted from WeChat mini program)
const body = JSON.stringify({
  authSessionId: 'KEWaUggBEAEaIAgEEhwxNzgwMjQ0NjU5MzcxODkxNDUyMmhuZE9ERzZnIhgIAxIUCAMSEOWB3vJ8TXNV8mQ-9lhyWC4q1gEAAAAAz6CRdrjp77_LRcvgIf41U4vvJk1qLN5pSYTxri7RfhQuSmb8DTSY7050X8xxO3ZFYMbjELTQmOn5svM3LwYaRaI9dKiGHV1tNPhHw_weWtFt1HcYGQAq91R9joKBBPhEbuzFxxFPc0TRIviugMWGmOicOcMykFMEfEJGGgA4Xkz3NCJBaq1jgWD_-Iz9pzMoES_RES5yQrZy1NliE1Z-wHKZjebed8YYNRux9IZuMMApULdxjnVu2EoBcW48_5I1UBuCu7DUvLwC8giFEeFZNCri',
});
const req = http.request({ hostname: 'localhost', port: 3000, path: '/api/proxy/convert', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': body.length } }, (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => console.log('Response:', data));
});
req.on('error', e => console.error('Error:', e.message));
req.write(body);
req.end();
