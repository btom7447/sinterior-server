import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { getStats, getRecentOrders } from '../controllers/dashboard.controller.js';

const router = Router();

router.use(protect);

router.get('/stats', getStats);
router.get('/recent-orders', getRecentOrders);

export default router;
