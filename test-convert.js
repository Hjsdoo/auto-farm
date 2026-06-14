const http = require('http');
const body = JSON.stringify({
  exportkey: 'n_ChQIAhIQEqQ3WoY9sJ%2FhLYUmxF9zcBLSAQIE97dBBAEAAAAAAMmXNsHa2KoAAAAOpnltbLcz9gKNyK89dVj0oWFH%2BqoalEX2ISmShkJk4Gs2j3t%2BBVVcTZYGjwr8b%2BJAn15H4%2FaCw6Ru7uxxqaGIYyahMvgdk8KrvQAVIEZqqECD9tFs%2FZ3UQU0T7MQPqJdsPgXHzJZq99Nh%2Fei8bag8oTj0V2D1SUT0Uea5j6u3FdRLqf3ZD0bgBpm8gkAQHyfsDmCS9V0VUkNwmUphJ7CVHIL3S7y7bUE61aAPvLkm20GNOfEPvuKoucSkhw%3D%3D'
});
const req = http.request({ hostname: 'localhost', port: 3000, path: '/api/proxy/convert', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': body.length } }, (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => console.log('Response:', data));
});
req.on('error', e => console.error('Error:', e.message));
req.write(body);
req.end();
