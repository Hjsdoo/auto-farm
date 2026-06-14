const http = require('http');
http.get('http://localhost:3000/api/proxy/captures?limit=50', (res) => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => {
    const j = JSON.parse(body);
    let found = 0;
    j.data.forEach(c => {
      if (c.url.includes('auth') || c.url.includes('login') || c.url.includes('session') || c.url.includes('export') || c.url.includes('token') || c.url.includes('code=') || c.codes?.length) {
        console.log(c.method, c.host, c.url.slice(0, 120));
        console.log('  codes:', JSON.stringify(c.codes));
        if (c.responseBodyPreview && c.responseBodyPreview.length < 500) console.log('  body:', c.responseBodyPreview);
        found++;
      }
    });
    console.log(`\nTotal: ${j.data.length}, matching: ${found}`);
  });
}).on('error', e => console.error('Error:', e.message));
