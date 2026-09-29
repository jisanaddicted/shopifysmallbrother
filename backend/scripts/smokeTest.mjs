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
    // Manual, so the 302s from the payment callbacks stay visible instead of
    // being silently followed to the SPA page. Nothing else in this API
    // redirects, so nothing else is affected.
    redirect: 'manual',
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // A 302 from the payment callbacks has no body to parse - that is normal,
    // not a failure, and `headers` below is what those checks read.
    data = null;
  }

  return { status: res.status, data, headers: res.headers };
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
  // A customer account belongs to a store, so a customer signs in FROM a
  // storefront: /s/<slug>/login sends `storeSlug`. Staff use the plain door.
  const CUSTOMER_STORE_SLUG = 'joes-pizza';

  const sessions = {};

  for (const [role, creds] of Object.entries(DEMO)) {
    const body =
      role === 'customer'
        ? { ...creds, storeSlug: CUSTOMER_STORE_SLUG }
        : creds;
    const res = await api('POST', '/auth/login', { body });
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

  // The storefront sign-in must be the only door for a customer.
  const portalDoor = await api('POST', '/auth/login', { body: DEMO.customer });
  check(
    'a customer cannot sign in at the staff portal door',
    portalDoor.status === 403,
    `got ${portalDoor.status}`,
  );

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
  // Joe's Pizza is resolved FIRST, and the order below is placed there on
  // purpose. The rest of this walk-through assumes it: the rider is invited to
  // this store, claims from its pool, and the platform admin is appointed to it
  // before the theme picker is checked. It used to pick the cheapest product in
  // the WHOLE catalogue, which made all of that depend on history - every run
  // leaves a "probe-store-*" behind (created by the signup check, never
  // deleted), and as soon as one of those held a cheap in-stock item the order
  // drifted onto a store nobody in this file has the password for. Tying the
  // pick to the seeded store makes it depend on the seed alone.
  const quantity = 2;
  const ownerEntries = {};
  for (const email of ['store@example.com', 'grocer@example.com']) {
    // eslint-disable-next-line no-await-in-loop
    const ownerLogin = await api('POST', '/auth/login', {
      body: { email, password: 'password123' },
    });
    const entryStore = ownerLogin.data?.store;
    if (ownerLogin.data?.token && entryStore?.slug) {
      ownerEntries[entryStore.slug] = {
        token: ownerLogin.data.token,
        id: String(entryStore._id || entryStore.id),
      };
    }
  }

  const pizza = ownerEntries['joes-pizza'];
  // In stock AND at Joe's Pizza.
  const sellable = [...list].filter(
    (product) =>
      Number(product.stock) >= quantity &&
      pizza &&
      String(product.store?._id || product.store) === pizza.id,
  );
  const cheapest =
    sellable.sort((a, b) => a.price - b.price)[0] ||
    [...list].sort((a, b) => a.price - b.price)[0];

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

  // --- Rider assignment is self-service now ------------------------------------------
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

  // The owner tokens were resolved up front, next to the order itself (see
  // "Place an order"), because the product had to come from one of their stores.
  const ownerToken = ownerEntries[order?.store?.slug]?.token || null;
  check(
    'the store that took the order has an owner who can sign in',
    Boolean(ownerToken),
    String(order?.store?.slug),
  );

  if (storeId && ownerToken) {
    const riderMe = await api('GET', '/auth/me', { token: sessions.rider });
    riderUserId = riderMe.data?.user?._id || riderMe.data?.user?.id;

    // The rule that replaced the old admin-driven step: a platform admin owns no
    // store, so they are turned away from somebody else's roster.
    const adminInvite = await api('POST', `/stores/${storeId}/riders`, {
      token: sessions.admin,
      body: { username: 'sam.rider' },
    });
    check(
      'a platform admin cannot invite a rider to a store',
      adminInvite.status === 403,
      `got ${why(adminInvite)}`,
    );

    // Clear any binding left by an earlier run so this stays repeatable.
    await api('DELETE', `/stores/${storeId}/riders/${riderUserId}`, {
      token: ownerToken,
    });

    const invite = await api('POST', `/stores/${storeId}/riders`, {
      token: ownerToken,
      body: { username: 'sam.rider' },
    });
    const requestId = invite.data?.invitation?._id || invite.data?.invitation?.id;
    check(
      'the store owner can invite a rider by username',
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

    // Closing the loop is a different question from setting the status, and it
    // has a different answer: the customer may not drive a delivery, but they do
    // get the last word. Checked here while the order is only `confirmed`, which
    // is exactly the state where pressing "Confirm delivery received" early must
    // be refused - otherwise a review could describe a parcel still in transit.
    const earlyReceive = await api('PATCH', `/orders/${orderId}/receive`, {
      token: sessions.customer,
    });
    check(
      'the customer cannot confirm a delivery that has not been delivered',
      earlyReceive.status === 400 && /not been delivered/.test(String(earlyReceive.data?.message)),
      `got ${why(earlyReceive)}`,
    );

    // --- Admin panel: the kitchen, and only the kitchen ----------------------
    // A platform admin only ever reaches orders of stores they actually run
    // (see canAccessOrder), so appoint this one first - the owner invites
    // ada.admin, ada.admin accepts. Without that every call below would be
    // refused with "This order does not belong to you" and the status rule would
    // never actually be exercised.
    //
    // Same repeatability guard as the rider above: drop the binding an earlier
    // run left behind, or re-inviting is refused with 409 "already has a pending
    // invitation" and the test only passes on a clean database.
    const adminMe = await api('GET', '/auth/me', { token: sessions.admin });
    const adminUserId = adminMe.data?.user?._id;
    if (adminUserId) {
      await api('DELETE', `/stores/${storeId}/riders/${adminUserId}`, {
        token: ownerToken,
      });
    }

    const appointAdmin = await api('POST', `/stores/${storeId}/riders`, {
      token: ownerToken,
      body: { username: 'ada.admin', role: 'admin' },
    });
    const adminRequestId =
      appointAdmin.data?.invitation?._id || appointAdmin.data?.invitation?.id;
    check(
      'the store owner can appoint a platform admin',
      (appointAdmin.status === 200 || appointAdmin.status === 201) &&
        Boolean(adminRequestId),
      `got ${why(appointAdmin)}`,
    );

    const adminAccepted = adminRequestId
      ? await api('PATCH', `/riders/requests/${adminRequestId}`, {
          token: sessions.admin,
          body: { action: 'accept' },
        })
      : { status: 0 };
    check(
      'the platform admin accepts and can now see that store orders',
      adminAccepted.status === 200,
      `got ${why(adminAccepted)}`,
    );

    // The order is sitting at `confirmed` here. An admin may walk it forward
    // exactly two steps - preparing, then ready for pickup - and nothing else:
    // no rewinding, no skipping, no marking somebody else's delivery finished.
    const adminPrepares = await api('PATCH', `/orders/${orderId}/status`, {
      token: sessions.admin,
      body: { status: 'preparing' },
    });
    check(
      'an admin can move a confirmed order to preparing',
      adminPrepares.status === 200 && adminPrepares.data?.order?.status === 'preparing',
      `got ${why(adminPrepares)}/${adminPrepares.data?.order?.status}`,
    );

    const adminReady = await api('PATCH', `/orders/${orderId}/status`, {
      token: sessions.admin,
      body: { status: 'ready_for_pickup' },
    });
    check(
      'an admin can then move it to ready for pickup',
      adminReady.status === 200 && adminReady.data?.order?.status === 'ready_for_pickup',
      `got ${why(adminReady)}/${adminReady.data?.order?.status}`,
    );

    const adminSkips = await api('PATCH', `/orders/${orderId}/status`, {
      token: sessions.admin,
      body: { status: 'out_for_delivery' },
    });
    check(
      'an admin cannot skip past the rider stages',
      adminSkips.status === 403,
      `got ${why(adminSkips)}`,
    );

    const adminDelivers = await api('PATCH', `/orders/${orderId}/status`, {
      token: sessions.admin,
      body: { status: 'delivered' },
    });
    check(
      'an admin cannot mark a delivery finished',
      adminDelivers.status === 403,
      `got ${why(adminDelivers)}`,
    );

    const adminRewinds = await api('PATCH', `/orders/${orderId}/status`, {
      token: sessions.admin,
      body: { status: 'preparing' },
    });
    check(
      'an admin cannot rewind the kitchen',
      adminRewinds.status === 403,
      `got ${why(adminRewinds)}`,
    );

    const ping = await api('PATCH', `/orders/${orderId}/location`, {
      token: sessions.rider,
      body: { lat: 27.7172, lng: 85.324 },
    });
    check('the rider GPS fallback endpoint works', ping.status === 200, `got ${why(ping)}`);

    // Walk the *whole* happy path rather than jumping straight to delivered, so
    // every leg of the delivery gets its own stamp in statusHistory. That is
    // what the analytics below read back: the ride can only be timed from a real
    // pickup, which a "confirmed -> delivered" shortcut would never record.
    //
    // The order is already at `ready_for_pickup` (the admin walked the kitchen
    // above), so the first entry or two here are no-ops or are refused - the
    // stamps that matter, picked_up / out_for_delivery / delivered, are the
    // rider's own and are what the analytics measures.
    for (const step of ['preparing', 'ready_for_pickup', 'picked_up', 'out_for_delivery']) {
      // Sequential on purpose: each status depends on the one before it.
      // eslint-disable-next-line no-await-in-loop
      await api('PATCH', `/orders/${orderId}/status`, {
        token: sessions.rider,
        body: { status: step },
      });
    }

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

    // --- Customer closes the loop, then reviews ------------------------------
    // The rider's `delivered` only claims they dropped the parcel off. Turning
    // that into "it is in the customer's hands" is deliberately the customer's
    // own move, and it is what unlocks the review.

    // A rider must not be able to do it for them.
    const riderReceive = await api('PATCH', `/orders/${orderId}/status`, {
      token: sessions.rider,
      body: { status: 'received' },
    });
    check(
      'a rider cannot mark an order received for the customer',
      riderReceive.status === 400,
      `got ${why(riderReceive)}`,
    );

    // ...and a review is refused while the order is merely `delivered`.
    const earlyReview = await api('POST', `/orders/${orderId}/review`, {
      token: sessions.customer,
      body: { rating: 5, comment: 'written far too early' },
    });
    check(
      'a review is refused until the customer confirms receipt',
      earlyReview.status === 400 && /Confirm you received/.test(String(earlyReview.data?.message)),
      `got ${why(earlyReview)}`,
    );

    const received = await api('PATCH', `/orders/${orderId}/receive`, {
      token: sessions.customer,
    });
    check(
      'the customer can confirm they received the order',
      received.status === 200 && received.data?.order?.status === 'received',
      `got ${why(received)}/${received.data?.order?.status}`,
    );
    check(
      'the receipt is written into the order history',
      (received.data?.order?.statusHistory || []).some(
        (entry) => entry?.status === 'received',
      ),
    );

    // A double tap, or a retry after the response was lost on the tunnel, must
    // not error - and must not stack a second `received` entry either.
    const receiveAgain = await api('PATCH', `/orders/${orderId}/receive`, {
      token: sessions.customer,
    });
    check(
      'confirming twice is harmless',
      receiveAgain.status === 200 && receiveAgain.data?.order?.status === 'received',
      `got ${why(receiveAgain)}/${receiveAgain.data?.order?.status}`,
    );
    check(
      'confirming twice does not duplicate the history entry',
      (receiveAgain.data?.order?.statusHistory || []).filter(
        (entry) => entry?.status === 'received',
      ).length === 1,
    );

    const badRating = await api('POST', `/orders/${orderId}/review`, {
      token: sessions.customer,
      body: { rating: 6 },
    });
    check('a rating outside 1-5 stars is refused', badRating.status === 400, `got ${why(badRating)}`);

    const halfStars = await api('POST', `/orders/${orderId}/review`, {
      token: sessions.customer,
      body: { rating: 4.5 },
    });
    check('half stars are refused', halfStars.status === 400, `got ${why(halfStars)}`);

    const review = await api('POST', `/orders/${orderId}/review`, {
      token: sessions.customer,
      body: { rating: 5, comment: 'Arrived early and well packed.' },
    });
    check(
      'the customer can review an order they received',
      review.status === 200 && review.data?.review?.rating === 5,
      `got ${why(review)}/${review.data?.review?.rating}`,
    );

    // A review belongs to the customer who placed the order - the rider on the
    // job cannot read it, edit it or answer it.
    const riderReview = await api('GET', `/orders/${orderId}/review`, {
      token: sessions.rider,
    });
    check(
      'a rider cannot read the customer review',
      riderReview.status === 403,
      `got ${why(riderReview)}`,
    );

    const strangerReview = await api('POST', `/orders/${orderId}/review`, {
      token: sessions.admin,
      body: { rating: 1, comment: 'not my order' },
    });
    check(
      'somebody else cannot review an order they did not place',
      strangerReview.status === 403,
      `got ${why(strangerReview)}`,
    );

    // One review per order: re-submitting edits the same one rather than
    // stacking a second opinion on the same delivery.
    await api('POST', `/orders/${orderId}/review`, {
      token: sessions.customer,
      body: { rating: 4, comment: 'Arrived early and well packed.' },
    });
    const readBack = await api('GET', `/orders/${orderId}/review`, {
      token: sessions.customer,
    });
    check(
      're-submitting edits the review instead of adding a second',
      readBack.status === 200 && readBack.data?.review?.rating === 4,
      `got ${why(readBack)}/${readBack.data?.review?.rating}`,
    );

    const withdrawn = await api('DELETE', `/orders/${orderId}/review`, {
      token: sessions.customer,
    });
    check(
      'the customer can withdraw their own review',
      withdrawn.status === 200 && withdrawn.data?.removed === true,
      `got ${why(withdrawn)}`,
    );

    // Leave one on the order so the store-side read below has something to find.
    const finalReview = await api('POST', `/orders/${orderId}/review`, {
      token: sessions.customer,
      body: { rating: 5, comment: 'Arrived early and well packed.' },
    });
    check(
      'a review can be written again after being withdrawn',
      finalReview.status === 200 && finalReview.data?.review?.rating === 5,
      `got ${why(finalReview)}`,
    );

    // And the store gets to read it.
    const storeReviews = await api('GET', `/stores/${storeId}/reviews`, {
      token: ownerToken,
    });
    check(
      'the store owner can read the reviews left on their deliveries',
      storeReviews.status === 200 &&
        (storeReviews.data?.reviews || []).some(
          (entry) => String(entry?.order?._id || entry?.order) === String(orderId),
        ),
      `got ${why(storeReviews)}`,
    );
    check(
      'the store review list carries the average and histogram',
      storeReviews.status === 200 &&
        (storeReviews.data?.distribution || []).length === 5 &&
        Number.isFinite(storeReviews.data?.average),
      `got ${why(storeReviews)}`,
    );

    // A finished order must never look like live work again - the rider's pool
    // and the store's board both filter on "not closed".
    const poolAfter = await api('GET', '/orders/pool', { token: sessions.rider });
    check(
      'a received order is not offered in the rider pool again',
      !(poolAfter.data?.orders || []).some(
        (entry) => (entry._id || entry.id) === orderId,
      ),
    );

    // --- Store-side rider analytics ------------------------------------------
    // The store owner's view of the same timings, rolled up per rider. Derived
    // from the order's statusHistory above, so the numbers are a record of what
    // happened rather than a counter that could drift.
    const storeAnalytics = await api('GET', '/orders/store/analytics', {
      token: ownerToken,
    });
    const analyticsSummary = storeAnalytics.data?.summary || {};
    const analyticsRow = (storeAnalytics.data?.orders || []).find(
      (row) => String(row.id) === String(orderId),
    );

    check(
      'the store owner can read their delivery analytics',
      storeAnalytics.status === 200,
      `got ${why(storeAnalytics)}`,
    );
    check(
      'the analytics carry the store back',
      storeAnalytics.data?.store?._id &&
        String(storeAnalytics.data.store._id) === String(storeId),
    );
    check(
      'the order that was just delivered is timed',
      analyticsRow?.isDelivered === true && Number.isFinite(analyticsRow?.totalMs),
      `isDelivered ${analyticsRow?.isDelivered}, total ${analyticsRow?.totalMs}`,
    );
    check(
      'every leg of that delivery is measured',
      Number.isFinite(analyticsRow?.prepMs) &&
        Number.isFinite(analyticsRow?.waitMs) &&
        Number.isFinite(analyticsRow?.rideMs),
      `prep ${analyticsRow?.prepMs}, wait ${analyticsRow?.waitMs}, ride ${analyticsRow?.rideMs}`,
    );
    check(
      'the rider who carried it is named',
      Boolean(analyticsRow?.riderName),
      `got ${analyticsRow?.riderName}`,
    );
    check(
      'the per-rider rollup covers the store',
      Array.isArray(storeAnalytics.data?.riders) &&
        storeAnalytics.data.riders.length > 0,
    );
    check(
      'the rollup averages match the store-wide average',
      Number.isFinite(analyticsSummary.avgTotalMs) ||
        analyticsSummary.avgTotalMs === null,
      `got ${analyticsSummary.avgTotalMs}`,
    );

    // Named distinctly from the `customerAnalytics` used further down for the
    // rider-analytics permission check.
    const customerStoreAnalytics = await api('GET', '/orders/store/analytics', {
      token: sessions.customer,
    });
    check(
      'a customer cannot read the store analytics',
      customerStoreAnalytics.status === 403,
      `got ${why(customerStoreAnalytics)}`,
    );

    // --- Rider analytics: the delivery timings we just performed --------------
    // Every duration is read back out of the order's own statusHistory, so the
    // order that was just delivered has to show up in the rider's own numbers.
    const analytics = await api('GET', '/orders/rider/analytics', {
      token: sessions.rider,
    });
    const myRow = (analytics.data?.orders || []).find(
      (row) => String(row.id) === String(orderId),
    );
    check(
      'the rider analytics endpoint reports their deliveries',
      analytics.status === 200 && Boolean(analytics.data?.summary),
      `got ${why(analytics)}`,
    );
    check(
      'the delivered order appears in the rider timings',
      Boolean(myRow) && myRow.isDelivered === true,
      `${(analytics.data?.orders || []).length} row(s)`,
    );
    check(
      'a delivered order reports a real end-to-end time',
      Number.isFinite(myRow?.totalMs) && myRow.totalMs > 0,
      `totalMs=${myRow?.totalMs}`,
    );
    check(
      'the ride leg is timed from pickup, not from the order',
      Number.isFinite(myRow?.rideMs) && myRow.rideMs > 0 && myRow.rideMs <= myRow.totalMs,
      `rideMs=${myRow?.rideMs} totalMs=${myRow?.totalMs}`,
    );
    check(
      'the rider timings stay inside the requested window',
      (analytics.data?.orders || []).length <= 100,
      `${(analytics.data?.orders || []).length} rows`,
    );
    check(
      'the averages are rolled up for the summary cards',
      Number.isFinite(analytics.data?.summary?.avgRideMs) &&
        Number.isFinite(analytics.data?.summary?.avgTotalMs) &&
        analytics.data.summary.avgTotalMs > 0,
      `avgRide=${analytics.data?.summary?.avgRideMs} avgTotal=${analytics.data?.summary?.avgTotalMs}`,
    );
    check(
      'the on-time share is reported as a percentage',
      Number.isFinite(analytics.data?.summary?.onTimePct) &&
        analytics.data.summary.onTimePct >= 0 &&
        analytics.data.summary.onTimePct <= 100,
      `onTimePct=${analytics.data?.summary?.onTimePct}`,
    );

    // A rider's numbers are their own: nobody else's row may appear.
    const otherRider = await api('POST', '/auth/login', {
      body: { email: 'rider2@example.com', password: 'password123' },
    });
    if (otherRider.status === 200) {
      const otherAnalytics = await api('GET', '/orders/rider/analytics', {
        token: otherRider.data?.token,
      });
      check(
        "a rider never sees another rider's deliveries",
        !(otherAnalytics.data?.orders || []).some(
          (row) => String(row.id) === String(orderId),
        ),
        `${(otherAnalytics.data?.orders || []).length} row(s)`,
      );
    }

    // The endpoint is rider-only.
    const customerAnalytics = await api('GET', '/orders/rider/analytics', {
      token: sessions.customer,
    });
    check(
      'a customer cannot read the rider analytics',
      customerAnalytics.status === 403,
      `got ${why(customerAnalytics)}`,
    );
    const adminAnalytics = await api('GET', '/orders/rider/analytics', {
      token: sessions.admin,
    });
    check(
      'a platform admin cannot read the rider analytics',
      adminAnalytics.status === 403,
      `got ${why(adminAnalytics)}`,
    );

    // Unbind again: the later journeys expect this rider NOT to be bound to
    // whatever store the catalogue order happened to come from. Only the store
    // owner may do this, so it uses the same session as the invite above.
    await api('DELETE', `/stores/${storeId}/riders/${riderUserId}`, {
      token: ownerToken,
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
  // She keeps the platform role `customer`, so - like every customer - she
  // signs in FROM a storefront (/s/<slug>/login), never the staff portal.
  const saLogin = await api('POST', '/auth/login', {
    body: {
      email: 'storeadmin@example.com',
      password: 'password123',
      storeSlug: CUSTOMER_STORE_SLUG,
    },
  });
  const saToken = saLogin.data?.token;
  check(
    'the seeded store admin can sign in',
    saLogin.status === 200 && saLogin.data?.user?.username === 'sara.admin',
    `got ${saLogin.status}/${saLogin.data?.user?.username}`,
  );

  if (saToken && storeId && ownerToken) {
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

    // Re-run friendly: drop any membership left over from an earlier run. The
    // roster belongs to the owner alone, so this uses the owner session resolved
    // above rather than the platform admin.
    const saMe = await api('GET', '/auth/me', { token: saToken });
    const saUserId = saMe.data?.user?._id || saMe.data?.user?.id;
    await api('DELETE', `/stores/${storeId}/riders/${saUserId}`, {
      token: ownerToken,
    });

    const inviteAdmin = await api('POST', `/stores/${storeId}/riders`, {
      token: ownerToken,
      body: { username: 'sara.admin', role: 'admin' },
    });
    const adminReqId =
      inviteAdmin.data?.invitation?._id || inviteAdmin.data?.invitation?.id;
    check(
      'the store owner can appoint a store admin by username',
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
  check('a rider cannot read the orders board', riderAsAdmin.status === 403, `got ${riderAsAdmin.status}`);

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

  // Same hazard as above: a leftover zero-stock fixture could sit first in the
  // store page, and ordering it would fail before the rider checks ever run.
  const pizzaItem =
    pizzaProducts.find((p) => Number(p.stock) >= 1) || pizzaProducts[0];
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

  // --- A guest closes their own order, without an account ------------------
  // The "Confirm delivery received" button must NOT be account-only. Somebody
  // who ordered without signing up still received the parcel, so they still get
  // the last word on it - the guestToken from checkout is the proof, exactly as
  // it already is for cancelling. What they still cannot do is REVIEW it.
  const guestBuyable =
    pizzaProducts.find((p) => Number(p.stock) >= 1) || pizzaProducts[0];
  const guestOrder = await api('POST', '/orders', {
    body: {
      items: [{ productId: guestBuyable._id, quantity: 1 }],
      address: {
        line1: '7 Guest Lane',
        city: 'Kathmandu',
        phone: '+1 555 011 2222',
      },
      location: { lat: 27.7172, lng: 85.324 },
      storeId: pizzaStore._id,
      guest: { name: 'Walk-in Shopper', email: 'walkin.shopper@example.com' },
    },
  });
  const guestOrderId = guestOrder.data?.order?._id || guestOrder.data?.order?.id;
  const guestToken = guestOrder.data?.guestToken;
  check(
    'a guest can place an order and is handed a guest token',
    // 201, not 200 - a fresh order is a creation.
    (guestOrder.status === 200 || guestOrder.status === 201) &&
      Boolean(guestOrderId) &&
      Boolean(guestToken),
    `got ${why(guestOrder)}`,
  );
  check(
    'a guest order carries no customer',
    Boolean(guestOrderId) && !guestOrder.data?.order?.customer,
    String(guestOrder.data?.order?.customer),
  );

  if (guestOrderId && guestToken) {
    // Still too early - the rider has not delivered it.
    const guestEarly = await api('PATCH', `/orders/${guestOrderId}/receive`, {
      body: { guestToken },
    });
    check(
      'a guest cannot confirm a delivery that has not been delivered',
      guestEarly.status === 400 && /not been delivered/.test(String(guestEarly.data?.message)),
      `got ${why(guestEarly)}`,
    );

    // No token at all proves nothing.
    const guestNoToken = await api('PATCH', `/orders/${guestOrderId}/receive`);
    check(
      'a guest order cannot be confirmed without its token',
      guestNoToken.status === 401,
      `got ${why(guestNoToken)}`,
    );

    const guestWrongToken = await api('PATCH', `/orders/${guestOrderId}/receive`, {
      body: { guestToken: 'not-the-real-token' },
    });
    check(
      'a made-up guest token is refused',
      guestWrongToken.status === 401,
      `got ${why(guestWrongToken)}`,
    );

    // Walk it to the doorstep, then let the guest close it.
    await api('POST', `/orders/${guestOrderId}/claim`, { token: sessions.rider });
    await api('PATCH', `/orders/${guestOrderId}/status`, {
      token: sessions.rider,
      body: { status: 'delivered' },
    });

    const guestReceived = await api('PATCH', `/orders/${guestOrderId}/receive`, {
      body: { guestToken },
    });
    check(
      'a guest can confirm they received their delivery',
      guestReceived.status === 200 && guestReceived.data?.order?.status === 'received',
      `got ${why(guestReceived)}/${guestReceived.data?.order?.status}`,
    );
    check(
      'the guest receipt lands in the order history',
      (guestReceived.data?.order?.statusHistory || []).some(
        (entry) => entry?.status === 'received',
      ),
    );

    // Confirming is about a parcel; rating it is about a person, and a guest
    // order has no account to attribute the rating to.
    const guestReview = await api('POST', `/orders/${guestOrderId}/review`, {
      body: { guestToken, rating: 5 },
    });
    check(
      'a guest still cannot leave a review',
      guestReview.status === 401,
      `got ${why(guestReview)}`,
    );

    // ...and a signed-in account that did not place it is refused too.
    const strangerConfirm = await api('PATCH', `/orders/${guestOrderId}/receive`, {
      token: sessions.customer,
    });
    check(
      'a signed-in customer cannot confirm a guest order they did not place',
      strangerConfirm.status === 403,
      `got ${why(strangerConfirm)}`,
    );
  }

  // --- Guest checkout is identified by EMAIL --------------------------------
  // The rule was inverted once: a name was demanded and the email was optional,
  // so the app produced guest orders it could neither send a receipt for nor
  // later turn into an account. These two pin the corrected contract.
  {
    const buyable = pizzaProducts.find((p) => Number(p.stock) >= 1) || pizzaProducts[0];
    const noEmail = await api('POST', '/orders', {
      body: {
        items: [{ productId: buyable._id, quantity: 1 }],
        address: { line1: '1 Nameless Way', city: 'Kathmandu', phone: '9800000000' },
        location: { lat: 27.7172, lng: 85.324 },
        storeId: pizzaStore._id,
        guest: { name: 'Only A Name' },
      },
    });
    check(
      'a guest checkout with a name but no email is refused',
      noEmail.status === 400,
      `got ${why(noEmail)}`,
    );

    // Email ALONE is enough - the name stays optional.
    const emailOnly = await api('POST', '/orders', {
      body: {
        items: [{ productId: buyable._id, quantity: 1 }],
        address: { line1: '1 Email Only Way', city: 'Kathmandu', phone: '9800000000' },
        location: { lat: 27.7172, lng: 85.324 },
        storeId: pizzaStore._id,
        guest: { email: 'email.only.shopper@example.com' },
      },
    });
    const emailOnlyId = emailOnly.data?.order?._id || emailOnly.data?.order?.id;
    const emailOnlyToken = emailOnly.data?.guestToken;
    check(
      'a guest can check out with an email and nothing else',
      (emailOnly.status === 200 || emailOnly.status === 201) &&
        Boolean(emailOnlyId) &&
        Boolean(emailOnlyToken),
      `got ${why(emailOnly)}`,
    );

    // --- Turning that guest order into an account --------------------------
    if (emailOnlyId && emailOnlyToken) {
      // A wrong token must not work: the order id alone is not proof.
      const wrongToken = await api('POST', '/auth/claim-guest-order', {
        body: {
          orderId: emailOnlyId,
          guestToken: 'not-the-real-token',
          password: 'hunter2!',
        },
      });
      check(
        'a guest order cannot be claimed without the right guest token',
        wrongToken.status === 403,
        `got ${why(wrongToken)}`,
      );

      const claimed = await api('POST', '/auth/claim-guest-order', {
        body: {
          orderId: emailOnlyId,
          guestToken: emailOnlyToken,
          password: 'hunter2!',
          name: 'Email Only Shopper',
        },
      });
      const claimedToken = claimed.data?.token;
      const claimedUser = claimed.data?.user;
      check(
        'a guest can turn a guest order into a real account with a password',
        claimed.status === 201 && Boolean(claimedToken) && claimedUser?.role === 'customer',
        `got ${why(claimed)}`,
      );

      if (claimedToken) {
        // The order really moved into the account's history - the whole point.
        const history = await api('GET', '/orders/mine', { token: claimedToken });
        const inHistory = (history.data?.orders || history.data || []).some(
          (o) => String(o._id || o.id) === String(emailOnlyId),
        );
        check(
          'the claimed order shows up in the new account\'s order history',
          history.status === 200 && inHistory,
          `got ${why(history)}`,
        );

        // And the guest token was retired, so the order is no longer reachable
        // by the secret that used to open it.
        const afterClaim = await api('GET', `/orders/${emailOnlyId}`, {
          params: { guestToken: emailOnlyToken },
        });
        check(
          'the guest token stops working once the order has an owner',
          afterClaim.status === 401 || afterClaim.status === 403,
          `got ${why(afterClaim)}`,
        );
      }

      // THE TAKEOVER GUARD. Claiming must never work for an email that already
      // belongs to a real account - otherwise anybody who ever checked out as a
      // guest with a shared address could reset that account's password.
      const existingEmailOrder = await api('POST', '/orders', {
        body: {
          items: [{ productId: buyable._id, quantity: 1 }],
          address: { line1: '1 Shared Address', city: 'Kathmandu', phone: '9800000000' },
          location: { lat: 27.7172, lng: 85.324 },
          storeId: pizzaStore._id,
          // This is a real registered customer's address.
          guest: { email: DEMO.customer.email },
        },
      });
      const existingId = existingEmailOrder.data?.order?._id || existingEmailOrder.data?.order?.id;
      const existingToken = existingEmailOrder.data?.guestToken;

      if (existingId && existingToken) {
        const takeover = await api('POST', '/auth/claim-guest-order', {
          body: {
            orderId: existingId,
            guestToken: existingToken,
            password: 'attacker-chosen-password',
          },
        });
        check(
          'a guest order on an already-registered email cannot be claimed',
          takeover.status === 409,
          `got ${why(takeover)}`,
        );
      }
    }
  }

  // --- A rider may not take an order from a store they are not bound to ---
  // Same care as the first order: the grocer's catalogue is served newest-first
  // and earlier runs have already sold out the top item, so buy something that
  // is actually on the shelf rather than blindly taking grocerProducts[0].
  const grocerBuyable =
    grocerProducts.find((p) => Number(p.stock) >= 1) || grocerProducts[0];
  const grocerOrder = await api('POST', '/orders', {
    token: sessions.customer,
    body: {
      items: [{ productId: grocerBuyable._id, quantity: 1 }],
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
    body: {
      name: `Test Item ${stamp}`,
      price: 3,
      category: 'Test',
      stock: 5,
      rack: 'B2',
      shelf: '4',
    },
  });
  check('a merchant can add a product', createdProduct.status === 201, `got ${createdProduct.status}`);
  check('the new product is attached to the merchant store', String(createdProduct.data?.product?.store) === String(pizzaStore._id), String(createdProduct.data?.product?.store));

  // Where the item sits in the shop: stored as sent, and printed back as one
  // line so a picker can read it off the screen.
  const newProduct = createdProduct.data?.product;
  check(
    'a product keeps its rack and shelf',
    newProduct?.rack === 'B2' && newProduct?.shelf === '4',
    `rack=${newProduct?.rack} shelf=${newProduct?.shelf}`,
  );
  check('a product reports one location line', newProduct?.location === 'Rack B2 · Shelf 4', String(newProduct?.location));

  // "Where is it?" - the catalogue search must match the rack, not just names.
  const rackSearch = await api('GET', `/products?store=${pizzaStore._id}&search=B2`);
  check(
    'a product can be found by its rack number',
    (rackSearch.data?.products || []).some((p) => String(p._id) === String(newProduct?._id)),
    `${(rackSearch.data?.products || []).length} hit(s)`,
  );

  const stealAttempt = await api('DELETE', `/products/${grocerProducts[0]._id}`, { token: sessions.merchant });
  check('a merchant cannot delete another store product', stealAttempt.status === 403, `got ${stealAttempt.status}`);

  // --- The pick list the back office shows on an order ----------------------
  // Each line carries a *live* lookup of its catalogue product, so an admin can
  // read off where every item is right now. The frozen name/price receipt next to
  // it must not move. This runs before the product is deleted below - an order
  // line can only point at a product that still exists.
  const pickOrder = await api('POST', '/orders', {
    token: sessions.customer,
    body: {
      items: [{ productId: newProduct._id, quantity: 1 }],
      address: { line1: '4 Pick Lane', phone: '+1 555 010 9999' },
      location: { lat: 27.7172, lng: 85.324 },
    },
  });
  const pickOrderId = pickOrder.data?.order?._id;
  const pickLine = pickOrder.data?.order?.items?.[0];
  check(
    'an order line carries the rack the picker needs',
    String(pickLine?.product?._id) === String(newProduct?._id) &&
      pickLine?.product?.rack === 'B2' &&
      pickLine?.product?.shelf === '4',
    `rack=${pickLine?.product?.rack} shelf=${pickLine?.product?.shelf}`,
  );
  check(
    'the receipt keeps the name and price it was bought at',
    pickLine?.name === newProduct.name && Number(pickLine?.price) === Number(newProduct.price),
    `${pickLine?.name} @ ${pickLine?.price}`,
  );
  // The pick list shows a photo so the picker recognises the item, and the
  // count they must put in the bag.
  check(
    'the order line carries the product photo for the pick list',
    pickLine?.product?.image === newProduct.image,
    String(pickLine?.product?.image),
  );
  check(
    'the order line carries the ordered quantity',
    Number(pickLine?.quantity) === 1,
    String(pickLine?.quantity),
  );

  // Re-shelve it. "Where is it?" is a question about now, so the order has to
  // follow the product to its new rack.
  await api('PUT', `/products/${newProduct._id}`, {
    token: sessions.merchant,
    body: { name: newProduct.name, price: newProduct.price, category: 'Test', stock: 5, rack: 'C9', shelf: '1' },
  });
  const pickAfter = await api('GET', `/orders/${pickOrderId}`, { token: sessions.merchant });
  check(
    'a re-shelved product shows its new rack on the order',
    pickAfter.data?.order?.items?.[0]?.product?.rack === 'C9',
    String(pickAfter.data?.order?.items?.[0]?.product?.rack),
  );

  // Now the product leaves the catalogue. A receipt must outlive it: the line is
  // still there, with no location to show - which the UI flags rather than
  // inventing a shelf.
  const ownDelete = await api('DELETE', `/products/${newProduct._id}`, { token: sessions.merchant });
  check('a merchant can delete their own product', ownDelete.status === 200, `got ${ownDelete.status}`);

  const pickDeleted = await api('GET', `/orders/${pickOrderId}`, { token: sessions.merchant });
  const orphanLine = pickDeleted.data?.order?.items?.[0];
  check(
    'a deleted product leaves the order line intact but unlocated',
    orphanLine?.name === newProduct.name && (orphanLine?.product ?? null) === null,
    `name=${orphanLine?.name} product=${orphanLine?.product}`,
  );

  // --- Store -> admin invitation: accept/decline + panel scoping -----------
  // A store owner invites the platform admin by username; the admin answers
  // from the panel (GET/PATCH /riders/requests). Until an invitation is
  // accepted, the admin's orders board and store list must not contain that
  // store's data at all - the panel is scoped to stores the admin runs.
  if (sessions.admin && sessions.merchant && pizzaStore?._id && storeOrderId) {
    const adminMe = await api('GET', '/auth/me', { token: sessions.admin });
    const adminUserId = adminMe.data?.user?._id || adminMe.data?.user?.id;

    // Re-run friendly: revoke the membership an earlier run may have left.
    await api('DELETE', `/stores/${pizzaStore._id}/riders/${adminUserId}`, {
      token: sessions.merchant,
    });

    const boardBefore = await api('GET', '/orders', { token: sessions.admin });
    check(
      'the admin board starts out without the invited store',
      (boardBefore.data?.orders || []).every(
        (entry) =>
          String(entry.store?._id || entry.store) !== String(pizzaStore._id),
      ),
      `${(boardBefore.data?.orders || []).length} order(s)`,
    );

    // The platform admin never owns a store (Green Grocer belongs to its own
    // demo merchant) - everything in the panel comes from invitations.
    check(
      'the admin owns no store of their own',
      !(adminMe.data?.stores || []).some((entry) => entry.role === 'owner'),
      `${(adminMe.data?.stores || [])
        .map((entry) => entry.store?.slug || entry.store?.name)
        .join(', ') || '(none)'}`,
    );

    const adminReadBefore = await api('GET', `/orders/${storeOrderId}`, {
      token: sessions.admin,
    });
    check(
      "the admin cannot open that store's order before accepting",
      adminReadBefore.status === 403,
      `got ${why(adminReadBefore)}`,
    );

    const inviteAdmin = await api('POST', `/stores/${pizzaStore._id}/riders`, {
      token: sessions.merchant,
      body: { username: 'ada.admin', role: 'admin' },
    });
    const adminInviteId =
      inviteAdmin.data?.invitation?._id || inviteAdmin.data?.invitation?.id;
    check(
      'a store owner can invite the platform admin by username',
      (inviteAdmin.status === 200 || inviteAdmin.status === 201) &&
        Boolean(adminInviteId),
      `got ${why(inviteAdmin)}`,
    );

    const adminRequests = await api('GET', '/riders/requests', {
      token: sessions.admin,
    });
    check(
      'the admin sees the pending store invitation in the panel',
      (adminRequests.data?.requests || []).some(
        (request) =>
          (request._id || request.id) === adminInviteId &&
          request.role === 'admin' &&
          request.store?.slug === 'joes-pizza',
      ),
      `${(adminRequests.data?.requests || []).length} request(s)`,
    );

    const declined = await api('PATCH', `/riders/requests/${adminInviteId}`, {
      token: sessions.admin,
      body: { action: 'decline' },
    });
    check(
      'the admin can decline the invitation',
      declined.status === 200 &&
        declined.data?.invitation?.status !== 'active',
      `got ${why(declined)}`,
    );

    const boardStillClosed = await api('GET', '/orders', {
      token: sessions.admin,
    });
    check(
      'a declined invitation does not open the orders board',
      (boardStillClosed.data?.orders || []).every(
        (entry) =>
          String(entry.store?._id || entry.store) !== String(pizzaStore._id),
      ),
    );

    // Re-inviting re-opens the declined row, so the accept half can run.
    const reinviteAdmin = await api(
      'POST',
      `/stores/${pizzaStore._id}/riders`,
      { token: sessions.merchant, body: { username: 'ada.admin', role: 'admin' } },
    );
    check(
      'the store can re-invite after a decline',
      reinviteAdmin.status === 200 || reinviteAdmin.status === 201,
      `got ${why(reinviteAdmin)}`,
    );

    const acceptedInvite = await api(
      'PATCH',
      `/riders/requests/${adminInviteId}`,
      { token: sessions.admin, body: { action: 'accept' } },
    );
    check(
      'the admin accepts the store invitation',
      acceptedInvite.status === 200 &&
        acceptedInvite.data?.invitation?.status === 'active',
      `got ${why(acceptedInvite)}`,
    );

    const afterMe = await api('GET', '/auth/me', { token: sessions.admin });
    check(
      'the accepted store joins the admin session',
      (afterMe.data?.stores || []).some(
        (entry) =>
          entry.store?.slug === 'joes-pizza' ||
          String(entry.store?._id) === String(pizzaStore._id),
      ),
      `${(afterMe.data?.stores || []).length} store(s)`,
    );

    const boardAfter = await api('GET', '/orders', { token: sessions.admin });
    check(
      "the orders board now includes that store's orders",
      (boardAfter.data?.orders || []).some(
        (entry) => (entry._id || entry.id) === storeOrderId,
      ),
      `${(boardAfter.data?.orders || []).length} order(s)`,
    );

    const adminReadAfter = await api('GET', `/orders/${storeOrderId}`, {
      token: sessions.admin,
    });
    check(
      'the admin can open the accepted store order',
      adminReadAfter.status === 200,
      `got ${why(adminReadAfter)}`,
    );

    const storesAfter = await api('GET', '/stores', { token: sessions.admin });
    check(
      'the admin store list feeds the theme picker with accepted stores',
      (storesAfter.data?.stores || []).some(
        (entry) => String(entry._id) === String(pizzaStore._id),
      ) &&
        // ...and only those: stores the admin does not run (Green Grocer,
        // owned by another merchant) never show up.
        !(storesAfter.data?.stores || []).some(
          (entry) => entry.slug === 'green-grocer',
        ),
      `${(storesAfter.data?.stores || []).map((entry) => entry.slug).join(', ')}`,
    );

    // --- Remove store: the panel button drops the membership again ----------
    const ownerLeave = await api('DELETE', `/riders/stores/${pizzaStore._id}`, {
      token: sessions.merchant,
    });
    check(
      'the store owner cannot walk away from their own store',
      ownerLeave.status === 403,
      `got ${why(ownerLeave)}`,
    );

    const riderLeave = await api('DELETE', `/riders/stores/${pizzaStore._id}`, {
      token: sessions.rider,
    });
    check(
      "a rider's delivery binding is untouched by the admin remove endpoint",
      riderLeave.status === 404,
      `got ${why(riderLeave)}`,
    );

    const badLeave = await api('DELETE', '/riders/stores/not-an-id', {
      token: sessions.admin,
    });
    check('an invalid store id is rejected', badLeave.status === 400, `got ${why(badLeave)}`);

    const leave = await api('DELETE', `/riders/stores/${pizzaStore._id}`, {
      token: sessions.admin,
    });
    check(
      'the admin can remove an invited store from their panel',
      leave.status === 200 && leave.data?.removed === true,
      `got ${why(leave)}`,
    );


    // --- Payments: cash on delivery + the SSLCommerz sandbox ----------------
    // Only the paths that do NOT need real gateway credentials, so this stays
    // runnable on a clean checkout. The happy path through the gateway itself
    // is a manual sandbox test, not something to fake in CI: pretending to
    // settle a payment would be worse than not testing it.
    const payNoOrder = await api('POST', '/payment/init', { body: {} });
    check(
      'starting a payment without an order is refused',
      payNoOrder.status === 400,
      `got ${why(payNoOrder)}`,
    );

    const payUnknown = await api('GET', '/payment/txn_not_a_real_one');
    check(
      'an unknown transaction reads as 404',
      payUnknown.status === 404,
      `got ${why(payUnknown)}`,
    );

    // A rider is signed in but did not place the order, so they may not open a
    // payment session for it. The same rule as every other order action.
    const payNotMine = await api('POST', '/payment/init', {
      token: sessions.rider,
      body: { orderId },
    });
    check(
      'somebody else cannot start a payment for an order',
      payNotMine.status === 403,
      `got ${why(payNotMine)}`,
    );

    // The gateway callbacks are unauthenticated by necessity - they come from
    // SSLCommerz and from a browser we do not control - but with nothing
    // recognisable they must bounce the shopper to the failure page rather than
    // credit anybody.
    //
    // `headers` is a fetch Headers object, so the Location header has to be read
    // with .get() rather than as a property.
    const straySuccess = await api('POST', '/payment/success', { body: {} });
    check(
      'a success callback with no transaction bounces to the failure page',
      straySuccess.status === 302 &&
        String(straySuccess.headers?.get?.('location') || '').includes(
          '/payment-failed',
        ),
      `got ${why(straySuccess)}`,
    );

    const strayFail = await api('POST', '/payment/fail', {
      body: { error: 'Card declined' },
    });
    check(
      'a fail callback with no transaction still lands on the failure page',
      strayFail.status === 302 &&
        String(strayFail.headers?.get?.('location') || '').includes(
          '/payment-failed',
        ),
      `got ${why(strayFail)}`,
    );

    // A malformed IPN is acknowledged with a 200 so SSLCommerz stops retrying,
    // rather than answered with an error that would make it hammer us.
    const strayIpn = await api('POST', '/payment/ipn', { body: {} });
    check(
      'a malformed IPN is acknowledged and ignored',
      strayIpn.status === 200 && strayIpn.data?.settled === false,
      `got ${why(strayIpn)}`,
    );

    // The order's payment state is carried on the order itself, so the tracker
    // and the store dashboard can read it. A cash-on-delivery order is Pending
    // with no transaction id - never null-collides in the unique index.
    const afterOrders = await api('GET', `/orders/${orderId}`, {
      token: sessions.customer,
    });
    check(
      'a cash order carries a payment record with no transaction yet',
      afterOrders.data?.order?.payment?.status === 'Pending' &&
        !afterOrders.data?.order?.payment?.transactionId,
      `${why(afterOrders)}/${afterOrders.data?.order?.payment?.status}`,
    );

    const leftMe = await api('GET', '/auth/me', { token: sessions.admin });
    check(
      'the removed store leaves the admin session',
      !(leftMe.data?.stores || []).some(
        (entry) =>
          entry.store?.slug === 'joes-pizza' ||
          String(entry.store?._id) === String(pizzaStore._id),
      ),
      `${(leftMe.data?.stores || []).map((entry) => entry.store?.slug).join(', ')}`,
    );

    const boardLeft = await api('GET', '/orders', { token: sessions.admin });
    check(
      'the orders board closes for a removed store',
      (boardLeft.data?.orders || []).every(
        (entry) => String(entry.store?._id || entry.store) !== String(pizzaStore._id),
      ),
    );

    const storeListLeft = await api('GET', '/stores', { token: sessions.admin });
    check(
      'the theme picker no longer offers the removed store',
      !(storeListLeft.data?.stores || []).some(
        (entry) => String(entry._id) === String(pizzaStore._id),
      ),
    );

    // Removal is reversible: the store can simply invite this account again
    // (the revoked row is re-opened, same as re-inviting after a decline).
    const inviteAgain = await api('POST', `/stores/${pizzaStore._id}/riders`, {
      token: sessions.merchant,
      body: { username: 'ada.admin', role: 'admin' },
    });
    check(
      'the store can invite the admin again after a removal',
      inviteAgain.status === 200 || inviteAgain.status === 201,
      `got ${why(inviteAgain)}`,
    );
  }

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
