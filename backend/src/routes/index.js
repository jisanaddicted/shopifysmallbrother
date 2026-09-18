import { Router } from 'express';
import mongoose from 'mongoose';
import adminRoutes from './adminRoutes.js';
import authRoutes from './authRoutes.js';
import orderRoutes from './orderRoutes.js';
import productRoutes from './productRoutes.js';

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
router.use('/admin', adminRoutes);

export default router;
