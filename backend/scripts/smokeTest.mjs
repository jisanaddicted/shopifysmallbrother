/**
 * End-to-end smoke test for the API.
 *
 *   npm run test:smoke          (the server must already be running)
 *
 * Walks the exact journey the React client takes: log in as each demo user,
 * load the catalogue, place an order, assign a rider, advance the status -
 * and checks the permission boundaries in between.
 *
 * NOTE: it creates a real order in the development database.
 */
const BASE = process.env.API_URL || 'http://localhost:5000/api';

const DEMO = {
  customer: { email: 'customer@example.com', password: 'password123' },
  rider: { email: 'rider@example.com', password: 'password123' },
  admin: { email: 'admin@example.com', password: 'password123' },
};

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` -> ${detail}` : ''}`);
    console.log(`  FAIL ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  return { status: res.status, data };
}

async function main() {
  console.log(`\nSmoke testing ${BASE}\n`);

  // --- Health --------------------------------------------------------------
  const health = await api('GET', '/health');
  check('GET /health returns 200', health.status === 200, `got ${health.status}`);
  check(
    'database is connected',
    health.data?.database === 'connected',
    `got ${health.data?.database}`,
  );

  // --- Login ---------------------------------------------------------------
  const sessions = {};
  for (const [role, creds] of Object.entries(DEMO)) {
    const res = await api('POST', '/auth/login', { body: creds });
    sessions[role] = res.data?.token;

    check(`login as ${role}`, res.status === 200 && Boolean(res.data?.token), `got ${res.status}`);
    check(
      `${role} gets the right role back`,
      res.data?.user?.role === role,
      `got ${res.data?.user?.role}`,
    );
    check(
      `${role} response hides the password hash`,
      res.data?.user && !('passwordHash' in res.data.user),
    );
  }

  const badLogin = await api('POST', '/auth/login', {
    body: { email: DEMO.customer.email, password: 'wrong-password' },
  });
  check('wrong password is rejected with 401', badLogin.status === 401, `got ${badLogin.status}`);

  // --- Token handling ------------------------------------------------------
  const me = await api('GET', '/auth/me', { token: sessions.customer });
  check('GET /auth/me returns the user', me.status === 200 && Boolean(me.data?.user), `got ${me.status}`);

  const noToken = await api('GET', '/orders/mine');
  check('protected route without a token is 401', noToken.status === 401, `got ${noToken.status}`);

  const forged = await api('GET', '/auth/me', { token: 'not.a.real.token' });
  check('forged token is 401', forged.status === 401, `got ${forged.status}`);

  // --- Catalogue -----------------------------------------------------------
  const products = await api('GET', '/products');
  const list = products.data?.products || [];
  check('GET /products returns the catalogue', products.status === 200 && list.length > 0, `${list.length} products`);

  // --- Place an order (customer) ------------------------------------------
  const cheapest = [...list].sort((a, b) => a.price - b.price)[0];
  const quantity = 2;

  const created = await api('POST', '/orders', {
    token: sessions.customer,
    body: {
      items: [
        { productId: cheapest._id, name: cheapest.name, price: cheapest.price, quantity },
      ],
      address: {
        label: 'Home',
        line1: '221B Baker Street',
        city: 'Kathmandu',
        phone: '+1 555 010 2030',
        notes: 'Ring the bell twice',
      },
      location: { lat: 27.7172, lng: 85.324 },
      paymentMethod: 'cod',
    },
  });

  check('POST /orders creates an order', created.status === 201 && Boolean(created.data?.order), `got ${created.status}`);
  const order = created.data?.order;
  const orderId = order?._id || order?.id;

  const expectedSubtotal = Math.round(cheapest.price * quantity * 100) / 100;
  const expectedTotal = expectedSubtotal + (expectedSubtotal >= 50 ? 0 : 2.5);

  check(
    'server prices the order itself',
    order?.subtotal === expectedSubtotal && order?.total === expectedTotal,
    `subtotal ${order?.subtotal} (want ${expectedSubtotal}), total ${order?.total} (want ${expectedTotal})`,
  );
  check('a new order starts as pending', order?.status === 'pending', `got ${order?.status}`);

  const mine = await api('GET', '/orders/mine', { token: sessions.customer });
  check(
    'the order shows up in the customer history',
    (mine.data?.orders || []).some((entry) => (entry._id || entry.id) === orderId),
  );

  // --- Dispatch (admin) ----------------------------------------------------
  const forbidden = await api('GET', '/orders', { token: sessions.customer });
  check('a customer cannot read the dispatch board', forbidden.status === 403, `got ${forbidden.status}`);

  const riders = await api('GET', '/admin/riders', { token: sessions.admin });
  const riderList = riders.data?.riders || [];
  check('GET /admin/riders lists riders', riders.status === 200 && riderList.length > 0, `${riderList.length} riders`);
  const riderId = riderList[0]?._id || riderList[0]?.id;

  const assigned = await api('PATCH', `/orders/${orderId}/assign`, {
    token: sessions.admin,
    body: { riderId },
  });
  check('an admin can assign a rider', assigned.status === 200 && Boolean(assigned.data?.order?.rider), `got ${assigned.status}`);
  check('the assigned rider comes back populated', Boolean(assigned.data?.order?.rider?.name));

  const assignAsCustomer = await api('PATCH', `/orders/${orderId}/assign`, {
    token: sessions.customer,
    body: { riderId },
  });
  check('a customer cannot assign a rider', assignAsCustomer.status === 403, `got ${assignAsCustomer.status}`);

  // --- Rider console -------------------------------------------------------
  const assignedToMe = await api('GET', '/orders/rider/assigned', { token: sessions.rider });
  check(
    'the order appears in the rider console',
    (assignedToMe.data?.orders || []).some((entry) => (entry._id || entry.id) === orderId),
  );

  const advance = await api('PATCH', `/orders/${orderId}/status`, {
    token: sessions.rider,
    body: { status: 'confirmed' },
  });
  check(
    'the rider can advance the status',
    advance.status === 200 && advance.data?.order?.status === 'confirmed',
    `got ${advance.status}/${advance.data?.order?.status}`,
  );

  const backwards = await api('PATCH', `/orders/${orderId}/status`, {
    token: sessions.rider,
    body: { status: 'pending' },
  });
  check('the rider cannot move the status backwards', backwards.status === 400, `got ${backwards.status}`);

  const customerStatus = await api('PATCH', `/orders/${orderId}/status`, {
    token: sessions.customer,
    body: { status: 'delivered' },
  });
  check('a customer cannot set the status', customerStatus.status === 403, `got ${customerStatus.status}`);

  const ping = await api('PATCH', `/orders/${orderId}/location`, {
    token: sessions.rider,
    body: { lat: 27.7172, lng: 85.324 },
  });
  check('the rider GPS fallback endpoint works', ping.status === 200, `got ${ping.status}`);

  const delivered = await api('PATCH', `/orders/${orderId}/status`, {
    token: sessions.rider,
    body: { status: 'delivered' },
  });
  check(
    'the rider can mark the order delivered',
    delivered.status === 200 && delivered.data?.order?.status === 'delivered',
    `got ${delivered.status}/${delivered.data?.order?.status}`,
  );

  const riderRead = await api('GET', `/orders/${orderId}`, { token: sessions.rider });
  check('an involved rider can read the order', riderRead.status === 200, `got ${riderRead.status}`);

  const riderAsAdmin = await api('GET', '/orders', { token: sessions.rider });
  check('a rider cannot read the dispatch board', riderAsAdmin.status === 403, `got ${riderAsAdmin.status}`);

  // --- Summary -------------------------------------------------------------
  console.log(`\n${passed} passed, ${failures.length} failed`);

  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach((failure) => console.log(`  - ${failure}`));
    process.exit(1);
  }

  console.log('All good.\n');
}

main().catch((err) => {
  console.error('\nSmoke test crashed:', err.message);
  process.exit(1);
});
