import { Router } from 'express';
import mongoose from 'mongoose';
import adminRoutes from './adminRoutes.js';
import authRoutes from './authRoutes.js';
import orderRoutes from './orderRoutes.js';
import paymentRoutes from './paymentRoutes.js';
import productRoutes from './productRoutes.js';
import riderRoutes from './riderRoutes.js';
import menuRoutes from './menuRoutes.js';
import storeRoutes from './storeRoutes.js';
import userRoutes from './userRoutes.js';

const router = Router();

/** Handy for "is the API up, and is the database reachable?" checks. */
router.get('/health', (req, res) => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];

  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    database: states[mongoose.connection.readyState] || 'unknown',
  });
});

router.use('/auth', authRoutes);
router.use('/products', productRoutes);
router.use('/orders', orderRoutes);
router.use('/menu', menuRoutes);
router.use('/stores', storeRoutes);
router.use('/riders', riderRoutes);
router.use('/users', userRoutes);
router.use('/admin', adminRoutes);
// Cash on delivery + SSLCommerz sandbox. Mounted last, and deliberately NOT
// behind a JWT: the gateway's own callbacks (/success, /fail, /cancel, /ipn) are
// made by a browser we do not control and by SSLCommerz's servers, so requiring
// a login would make it impossible to ever mark a payment paid. Who may START a
// payment is decided inside the controller, against the order.
router.use('/payment', paymentRoutes);

export default router;
