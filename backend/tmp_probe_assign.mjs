import http from 'http';
const BASE = 'http://localhost:5000/api';

function req(method, path, token, body) {
  const opts = new URL(`${BASE}${path}`);
  return new Promise((resolve, reject) => {
    const r = http.request(
      opts,
      method,
      (res) => {
        let txt = '';
        res.on('data', (c) => (txt += c));
        res.on('end', () => {
          resolve({ status: res.statusCode, body: txt });
        });
      }
    );
    r.on('error', reject);
    r.setHeader('Content-Type', 'application/json');
    if (token) r.setHeader('Authorization', `Bearer ${token}`);
    if (data) r.end(data);
    else r.end();
  });
}

(async () => {
  const login = await req('POST', '/auth/login', null, {
    email: 'admin@example.com',
    password: 'password123',
  });
  const token = JSON.parse(login.body).token;
  console.log('admin login:', login.status);

  const stores = await req('GET', '/stores', token);
  const storeId = JSON.parse(stores.body).stores[0]._id;
  console.log('store id:', storeId);

  const invite = await req(
    'POST',
    `/stores/${storeId}/riders`,
    token,
    { username: 'sam.rider', role: 'rider' }
  );
  console.log('admin invites rider to random store -> status:', invite.status);
  console.log('body:', invite.body);

  // Now the merchant:
  const mlogin = await req('POST', '/auth/login', null, {
    email: 'store@example.com',
    password: 'password123',
  });
  const mtoken = JSON.parse(mlogin.body).token;
  const minvite = await req(
    'POST',
    `/stores/${storeId}/riders`,
    mtoken,
    { username: 'sam.rider', role: 'rider' }
  );
  console.log('merchant invites rider to their own store -> status:', minvite.status);
})();
