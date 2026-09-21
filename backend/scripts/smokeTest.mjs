/**
 * End-to-end smoke test for the API.
 *
 *   npm run test:smoke          (the server must already be running)
 *
 * Walks the exact journey the React client takes: log in as each demo user,
 * load the catalogue, place an order, claim it as a rider, advance the status -
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

  // --- Dispatch is self-service now ------------------------------------------
  // There is no admin "choose a rider" step: riders are bound to a store and
  // claim orders from their pool. The old manual endpoints must be gone.
  const forbidden = await api('GET', '/orders', { token: sessions.customer });
  check('a customer cannot read the orders board', forbidden.status === 403, `got ${forbidden.status}`);

  const assignGone = await api('PATCH', `/orders/${orderId}/assign`, {
    token: sessions.admin,
    body: { riderId: 'whatever' },
  });
  check('manual assignment has been removed', assignGone.status === 404, `got ${assignGone.status}`);

  const ridersGone = await api('GET', '/admin/riders', { token: sessions.admin });
  check('the admin rider-dropdown endpoint has been removed', ridersGone.status === 404, `got ${ridersGone.status}`);

  // --- Rider console: bind, get notified, claim, deliver --------------------
  // There is no admin "choose a rider" step. The admin/merchant binds the
  // rider to a store (by username), the rider accepts, and from then on every
  // new order for that store lands in their pool to claim and deliver.
  const why = (r) => `${r.status}${r.data?.message ? ` - ${r.data.message}` : ''}`;
  const storeId = order?.store?._id || order?.store || null;
  let riderUserId = null;

  if (storeId) {
    const riderMe = await api('GET', '/auth/me', { token: sessions.rider });
    riderUserId = riderMe.data?.user?._id || riderMe.data?.user?.id;

    // Clear any binding left by an earlier run so this stays repeatable.
    await api('DELETE', `/stores/${storeId}/riders/${riderUserId}`, {
      token: sessions.admin,
    });

    const invite = await api('POST', `/stores/${storeId}/riders`, {
      token: sessions.admin,
      body: { username: 'sam.rider' },
    });
    const requestId = invite.data?.invitation?._id || invite.data?.invitation?.id;
    check(
      'an admin can invite a rider by username',
      (invite.status === 200 || invite.status === 201) && Boolean(requestId),
      `got ${why(invite)}`,
    );

    const accepted = await api('PATCH', `/riders/requests/${requestId}`, {
      token: sessions.rider,
      body: { action: 'accept' },
    });
    check('the rider accepts the store invitation', accepted.status === 200, `got ${why(accepted)}`);

    // The reported bug: a bound rider opening an unclaimed store order got
    // 403 "This order does not belong to you." instead of the order.
    const peek = await api('GET', `/orders/${orderId}`, { token: sessions.rider });
    check('a bound rider can open an unclaimed store order', peek.status === 200, `got ${why(peek)}`);

    const pool = await api('GET', '/orders/pool', { token: sessions.rider });
    check(
      'the new order is waiting in the bound rider pool',
      (pool.data?.orders || []).some((entry) => (entry._id || entry.id) === orderId),
    );

    const claimed = await api('POST', `/orders/${orderId}/claim`, {
      token: sessions.rider,
    });
    check(
      'the rider accepts the delivery by claiming it',
      claimed.status === 200 && Boolean(claimed.data?.order?.rider),
      `got ${why(claimed)}`,
    );

    const assignedToMe = await api('GET', '/orders/rider/assigned', {
      token: sessions.rider,
    });
    check(
      'the claimed order appears in the rider console',
      (assignedToMe.data?.orders || []).some((entry) => (entry._id || entry.id) === orderId),
    );

    const advance = await api('PATCH', `/orders/${orderId}/status`, {
      token: sessions.rider,
      body: { status: 'confirmed' },
    });
    check(
      'the rider can advance the status',
      advance.status === 200 && advance.data?.order?.status === 'confirmed',
      `got ${why(advance)}/${advance.data?.order?.status}`,
    );

    const backwards = await api('PATCH', `/orders/${orderId}/status`, {
      token: sessions.rider,
      body: { status: 'pending' },
    });
    check(
      'the rider cannot move the status backwards',
      backwards.status === 400 && /cannot move/.test(String(backwards.data?.message)),
      `got ${why(backwards)}`,
    );

    const customerStatus = await api('PATCH', `/orders/${orderId}/status`, {
      token: sessions.customer,
      body: { status: 'delivered' },
    });
    check('a customer cannot set the status', customerStatus.status === 403, `got ${why(customerStatus)}`);

    const ping = await api('PATCH', `/orders/${orderId}/location`, {
      token: sessions.rider,
      body: { lat: 27.7172, lng: 85.324 },
    });
    check('the rider GPS fallback endpoint works', ping.status === 200, `got ${why(ping)}`);

    const delivered = await api('PATCH', `/orders/${orderId}/status`, {
      token: sessions.rider,
      body: { status: 'delivered' },
    });
    check(
      'the rider can mark the order delivered',
      delivered.status === 200 && delivered.data?.order?.status === 'delivered',
      `got ${why(delivered)}/${delivered.data?.order?.status}`,
    );

    const riderRead = await api('GET', `/orders/${orderId}`, { token: sessions.rider });
    check('an involved rider can read the order', riderRead.status === 200, `got ${why(riderRead)}`);

    // Unbind again: the later journeys expect this rider NOT to be bound to
    // whatever store the catalogue order happened to come from.
    await api('DELETE', `/stores/${storeId}/riders/${riderUserId}`, {
      token: sessions.admin,
    });
  }

  check(
    'the rider journey ran (the catalogue order belongs to a store)',
    Boolean(storeId),
    'no product with a store was found - is the seed data loaded?',
  );

  // --- Store admins: global search, invite by username, store dashboard ----
  // Sara is an ordinary customer account. An owner/admin searches her
  // globally by username, sees her profile card, and invites her as a store
  // ADMIN (not a rider). After accepting, she manages the store's orders but
  // still cannot take deliveries on the road.
  const saLogin = await api('POST', '/auth/login', {
    body: { email: 'storeadmin@example.com', password: 'password123' },
  });
  const saToken = saLogin.data?.token;
  check(
    'the seeded store admin can sign in',
    saLogin.status === 200 && saLogin.data?.user?.username === 'sara.admin',
    `got ${saLogin.status}/${saLogin.data?.user?.username}`,
  );

  if (saToken && storeId) {
    const card = await api('GET', '/users/lookup?username=sam.rider', {
      token: saToken,
    });
    check(
      'global username search returns a profile card',
      card.status === 200 && card.data?.user?.username === 'sam.rider',
      `got ${card.status}`,
    );
    check(
      'the profile card carries quality stats',
      Boolean(card.data?.user?.stats),
      JSON.stringify(card.data?.user?.stats || null).slice(0, 140),
    );

    // Re-run friendly: drop any membership left over from an earlier run.
    const saMe = await api('GET', '/auth/me', { token: saToken });
    const saUserId = saMe.data?.user?._id || saMe.data?.user?.id;
    await api('DELETE', `/stores/${storeId}/riders/${saUserId}`, {
      token: sessions.admin,
    });

    const inviteAdmin = await api('POST', `/stores/${storeId}/riders`, {
      token: sessions.admin,
      body: { username: 'sara.admin', role: 'admin' },
    });
    const adminReqId =
      inviteAdmin.data?.invitation?._id || inviteAdmin.data?.invitation?.id;
    check(
      'an admin can invite a store admin by username',
      (inviteAdmin.status === 200 || inviteAdmin.status === 201) &&
        Boolean(adminReqId),
      `got ${inviteAdmin.status} ${JSON.stringify(inviteAdmin.data?.message || null)}`,
    );

    const acceptedAdmin = await api('PATCH', `/riders/requests/${adminReqId}`, {
      token: saToken,
      body: { action: 'accept' },
    });
    check(
      'the store admin accepts her invitation',
      acceptedAdmin.status === 200,
      `got ${acceptedAdmin.status}`,
    );

    const managed = await api('GET', '/orders/store/mine', { token: saToken });
    check(
      'the store admin sees the store orders on her dashboard',
      managed.status === 200 &&
        (managed.data?.orders || []).some(
          (entry) => (entry._id || entry.id) === orderId,
        ),
      `got ${managed.status}`,
    );

    const claimAsAdmin = await api('POST', `/orders/${orderId}/claim`, {
      token: saToken,
    });
    check(
      'a store admin cannot take deliveries',
      claimAsAdmin.status === 403,
      `got ${claimAsAdmin.status}`,
    );

    const unknown = await api(
      'GET',
      '/users/lookup?username=nobody.by-this-name',
      { token: saToken },
    );
    check(
      'the global search reports unknown usernames cleanly',
      unknown.status === 404 || unknown.data?.user === null,
      `got ${unknown.status}`,
    );
  }

  const riderAsAdmin = await api('GET', '/orders', { token: sessions.rider });
  check('a rider cannot read the dispatch board', riderAsAdmin.status === 403, `got ${riderAsAdmin.status}`);

  // --- Merchant signup, storefront URL, and username rules -----------------
  const stamp = Date.now().toString(36);
  const newMerchant = {
    name: 'Test Merchant',
    email: `merchant.${stamp}@example.com`,
    username: `merchant.${stamp}`,
    password: 'password123',
    role: 'store',
    storeName: `Test Store ${stamp}`,
  };

  const signedUp = await api('POST', '/auth/register', { body: newMerchant });
  const newSlug = signedUp.data?.store?.slug;
  check('a store can sign up and gets its own URL slug', signedUp.status === 201 && Boolean(newSlug), `got ${signedUp.status}/${newSlug}`);

  const newStorefront = await api('GET', `/stores/${newSlug}`);
  check('the new storefront is publicly reachable', newStorefront.status === 200 && newStorefront.data?.store?.slug === newSlug, `got ${newStorefront.status}`);
  check('a brand-new store starts with no products', (newStorefront.data?.products || []).length === 0);

  const dupeHandle = await api('POST', '/auth/register', {
    body: { name: 'Someone Else', email: `dupe.${stamp}@example.com`, username: newMerchant.username, password: 'password123', role: 'rider' },
  });
  check('a taken username is rejected', dupeHandle.status === 409, `got ${dupeHandle.status}`);

  const shortHandle = await api('POST', '/auth/register', {
    body: { name: 'Shorty', email: `short.${stamp}@example.com`, username: 'ab', password: 'password123', role: 'rider' },
  });
  check('an invalid username is rejected', shortHandle.status === 400, `got ${shortHandle.status}`);

  const noHandle = await api('POST', '/auth/register', {
    body: { name: 'No Handle', email: `nohandle.${stamp}@example.com`, password: 'password123', role: 'rider' },
  });
  check('a rider must supply a username', noHandle.status === 400, `got ${noHandle.status}`);

  const takenCheck = await api('GET', `/auth/username-available?username=${newMerchant.username}`);
  check('the availability check reports a taken handle', takenCheck.data?.available === false);

  const freeCheck = await api('GET', `/auth/username-available?username=free.${stamp}`);
  check('the availability check reports a free handle', freeCheck.data?.available === true);

  // --- The demo merchant and the seeded storefront -------------------------
  const merchantLogin = await api('POST', '/auth/login', { body: { email: 'store@example.com', password: 'password123' } });
  sessions.merchant = merchantLogin.data?.token;
  check('a store account can log in', merchantLogin.status === 200 && merchantLogin.data?.user?.role === 'store', `got ${merchantLogin.status}`);
  check('logging in as a store returns its store', Boolean(merchantLogin.data?.store?.slug), String(merchantLogin.data?.store?.slug));

  const myStore = await api('GET', '/stores/mine', { token: sessions.merchant });
  const pizzaStore = myStore.data?.store;
  check('a merchant can load their own store', myStore.status === 200 && pizzaStore?.slug === 'joes-pizza', `got ${myStore.status}/${pizzaStore?.slug}`);

  const publicPizza = await api('GET', '/stores/joes-pizza');
  const pizzaProducts = publicPizza.data?.products || [];
  check('the seeded storefront is public', publicPizza.status === 200 && pizzaProducts.length > 0, `${pizzaProducts.length} products`);
  check('every product on a store page belongs to that store', pizzaProducts.every((p) => String(p.store) === String(publicPizza.data.store._id)));

  const scoped = await api('GET', '/products?store=green-grocer');
  const grocerProducts = scoped.data?.products || [];
  check('the catalogue can be filtered by store slug', grocerProducts.length > 0 && grocerProducts.every((p) => String(p.store) === String(grocerProducts[0].store)), `${grocerProducts.length} products`);

  // --- Finding a rider by username ----------------------------------------
  const search = await api('GET', '/riders/lookup?username=sam.rider', { token: sessions.merchant });
  const samRider = (search.data?.riders || []).find((r) => r.username === 'sam.rider');
  const samRiderId = samRider?._id || samRider?.id;
  check('a merchant can find a rider by exact username', search.status === 200 && Boolean(samRiderId), `got ${search.status}`);

  const partial = await api('GET', '/riders/lookup?username=sam', { token: sessions.merchant });
  check('a partial username still finds the rider', (partial.data?.riders || []).some((r) => r.username === 'sam.rider'));

  const unknownRider = await api('GET', '/riders/lookup?username=does.not.exist', { token: sessions.merchant });
  check('an unknown username finds nothing', (unknownRider.data?.riders || []).length === 0);

  const anonSearch = await api('GET', '/riders/lookup?username=sam.rider');
  check('searching riders needs a token', anonSearch.status === 401, `got ${anonSearch.status}`);

  const customerSearch = await api('GET', '/riders/lookup?username=sam.rider', { token: sessions.customer });
  check('a customer cannot search riders', customerSearch.status === 403, `got ${customerSearch.status}`);

  // --- Invite, then accept ------------------------------------------------
  // Clear any binding left by an earlier run so this stays repeatable.
  await api('DELETE', `/stores/${pizzaStore._id}/riders/${samRiderId}`, { token: sessions.merchant });

  const invited = await api('POST', `/stores/${pizzaStore._id}/riders`, {
    token: sessions.merchant,
    body: { username: 'sam.rider' },
  });
  // A re-invite after a revoke re-opens the existing row (200); a first-time
  // invite creates one (201). Both mean the invitation was sent.
  check(
    'a merchant can invite a rider by username',
    invited.status === 201 || invited.status === 200,
    `got ${invited.status}`,
  );
  check('a new invitation is pending, not active', invited.data?.invitation?.status === 'pending', String(invited.data?.invitation?.status));

  const reInvite = await api('POST', `/stores/${pizzaStore._id}/riders`, {
    token: sessions.merchant,
    body: { username: 'sam.rider' },
  });
  check('inviting the same rider twice is rejected', reInvite.status === 409, `got ${reInvite.status}`);

  const ghostInvite = await api('POST', `/stores/${pizzaStore._id}/riders`, {
    token: sessions.merchant,
    body: { username: 'ghost.rider' },
  });
  check('inviting an unknown username is a 404', ghostInvite.status === 404, `got ${ghostInvite.status}`);

  const customerInvite = await api('POST', `/stores/${pizzaStore._id}/riders`, {
    token: sessions.customer,
    body: { username: 'sam.rider' },
  });
  check('a customer cannot invite riders', customerInvite.status === 403, `got ${customerInvite.status}`);

  const roster = await api('GET', `/stores/${pizzaStore._id}/riders`, { token: sessions.merchant });
  check('the invitation shows on the merchant roster as pending', (roster.data?.riders || []).some((link) => link.status === 'pending'));

  const requests = await api('GET', '/riders/requests', { token: sessions.rider });
  const request = (requests.data?.requests || []).find((r) => String(r.store?._id) === String(pizzaStore._id));
  check('the rider sees the invitation', Boolean(request), `${(requests.data?.requests || []).length} request(s)`);

  const accepted = await api('PATCH', `/riders/requests/${request?._id}`, {
    token: sessions.rider,
    body: { action: 'accept' },
  });
  check('the rider can accept the invitation', accepted.status === 200 && accepted.data?.invitation?.status === 'active', `got ${accepted.status}/${accepted.data?.invitation?.status}`);

  const boundStores = await api('GET', '/riders/stores', { token: sessions.rider });
  check('the store appears in the rider stores list', (boundStores.data?.stores || []).some((s) => s.slug === 'joes-pizza'), `${(boundStores.data?.stores || []).length} store(s)`);

  const acceptTwice = await api('PATCH', `/riders/requests/${request?._id}`, {
    token: sessions.rider,
    body: { action: 'accept' },
  });
  check('accepting twice is rejected', acceptTwice.status === 409, `got ${acceptTwice.status}`);

  // --- An order placed on a store page belongs to that store --------------
  const storeIdOf = (order) => String(order?.store?._id || order?.store || '');

  const pizzaItem = pizzaProducts[0];
  const storeOrder = await api('POST', '/orders', {
    token: sessions.customer,
    body: {
      items: [{ productId: pizzaItem._id, quantity: 1 }],
      address: { line1: '9 Store Lane', city: 'Kathmandu', phone: '+1 555 010 7777' },
      location: { lat: 27.7172, lng: 85.324 },
      storeId: pizzaStore._id,
    },
  });
  const storeOrderId = storeOrder.data?.order?._id;
  check('an order from a store page is owned by that store', storeIdOf(storeOrder.data?.order) === String(pizzaStore._id), storeIdOf(storeOrder.data?.order));
  check('a fresh store order has no rider yet', storeOrder.data?.order?.rider === null, String(storeOrder.data?.order?.rider));

  // --- The bound rider sees it in the pool and takes it -------------------
  const pool = await api('GET', '/orders/pool', { token: sessions.rider });
  check('the bound rider sees it in the available pool', (pool.data?.orders || []).some((o) => (o._id || o.id) === storeOrderId), `${(pool.data?.orders || []).length} available`);

  const claimed = await api('POST', `/orders/${storeOrderId}/claim`, { token: sessions.rider });
  check('the rider can take the delivery', claimed.status === 200 && String(claimed.data?.order?.rider?._id || claimed.data?.order?.rider) === String(samRiderId), `got ${claimed.status}`);

  const poolAfter = await api('GET', '/orders/pool', { token: sessions.rider });
  check('a taken order leaves the pool', !(poolAfter.data?.orders || []).some((o) => (o._id || o.id) === storeOrderId));

  const myDeliveries = await api('GET', '/orders/rider/assigned', { token: sessions.rider });
  check('the taken order joins the rider deliveries', (myDeliveries.data?.orders || []).some((o) => (o._id || o.id) === storeOrderId));

  const claimAgain = await api('POST', `/orders/${storeOrderId}/claim`, { token: sessions.rider });
  check('claiming the same order twice is rejected', claimAgain.status === 409, `got ${claimAgain.status}`);

  const customerPool = await api('GET', '/orders/pool', { token: sessions.customer });
  check('a customer cannot see the delivery pool', customerPool.status === 403, `got ${customerPool.status}`);

  // --- A rider may not take an order from a store they are not bound to ---
  const grocerOrder = await api('POST', '/orders', {
    token: sessions.customer,
    body: {
      items: [{ productId: grocerProducts[0]._id, quantity: 1 }],
      address: { line1: '3 Grocer Way', phone: '+1 555 010 8888' },
      location: { lat: 27.7172, lng: 85.324 },
    },
  });
  const grocerOrderId = grocerOrder.data?.order?._id;
  check('that order is owned by its own store', storeIdOf(grocerOrder.data?.order) !== String(pizzaStore._id), storeIdOf(grocerOrder.data?.order));

  const unboundClaim = await api('POST', `/orders/${grocerOrderId}/claim`, { token: sessions.rider });
  check('a rider cannot take an order from an unbound store', unboundClaim.status === 403, `got ${unboundClaim.status}`);

  const poolHidden = await api('GET', '/orders/pool', { token: sessions.rider });
  check('the unbound store order is not advertised in the pool', !(poolHidden.data?.orders || []).some((o) => (o._id || o.id) === grocerOrderId));

  // --- A merchant manages only their own products -------------------------
  const createdProduct = await api('POST', '/products', {
    token: sessions.merchant,
    body: { name: `Test Item ${stamp}`, price: 3, category: 'Test', stock: 5 },
  });
  check('a merchant can add a product', createdProduct.status === 201, `got ${createdProduct.status}`);
  check('the new product is attached to the merchant store', String(createdProduct.data?.product?.store) === String(pizzaStore._id), String(createdProduct.data?.product?.store));

  const stealAttempt = await api('DELETE', `/products/${grocerProducts[0]._id}`, { token: sessions.merchant });
  check('a merchant cannot delete another store product', stealAttempt.status === 403, `got ${stealAttempt.status}`);

  const ownDelete = await api('DELETE', `/products/${createdProduct.data?.product?._id}`, { token: sessions.merchant });
  check('a merchant can delete their own product', ownDelete.status === 200, `got ${ownDelete.status}`);

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
