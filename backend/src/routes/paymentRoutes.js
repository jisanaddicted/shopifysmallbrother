import { Router } from 'express';
import {
  getPayment,
  initPayment,
  paymentCancel,
  paymentFail,
  paymentIpn,
  paymentSuccess,
} from '../controllers/paymentController.js';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();

// --- Fixed paths FIRST, before "/:tranId" can capture them -----------------
// "/:tranId" is deliberately open (a guest paying online has no session, they
// have their checkout token), so a single-segment fixed path registered after it
// would be read as a transaction id and answered with 404.

// The four the GATEWAY calls. None of them require a session: success/fail/
// cancel are the banker's browser being redirected back to us, and the IPN is
// SSLCommerz's own server. Requiring a JWT here would mean no payment could ever
// be confirmed, because the person confirming it is not the shopper.
//
// They redirect with a 302 rather than answering JSON, because they are browser
// navigations - the shopper is meant to end up back in the app.
//
// Express must be able to read the bodies SSLCommerz sends. app.js already
// mounts express.urlencoded(), so the form posts below arrive parsed.
router.post('/success', paymentSuccess);
router.post('/fail', paymentFail);
router.post('/cancel', paymentCancel);
router.post('/ipn', paymentIpn);

// --- Starting a payment ---------------------------------------------------
// optionalAuth, not requireAuth: a guest can pay online just as they can cancel
// or confirm a delivery. loadOrderFor inside the controller decides who is
// actually allowed - a session must match the order's customer, or a guestToken
// must prove it.
router.post('/init', optionalAuth, initPayment);

// --- Reading one back -----------------------------------------------------
// The success page arrives holding only ?tran_id=…, so it asks the server what
// actually happened rather than trusting the URL. Guests pass their token as a
// query param, exactly like the order tracker does.
router.get('/:tranId', optionalAuth, getPayment);

export default router;