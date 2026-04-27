import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import {
  createJob,
  getMyJobs,
  getActiveJobs,
  getJob,
  validateJob,
  acceptJob,
  rejectJob,
  cancelJob,
  approveStart,
  approveEnd,
  acceptWork,
} from '../controllers/job.controller.js';

const router = Router();

router.use(protect);

router.get('/', getMyJobs);
router.get('/active', getActiveJobs);
router.get('/:id', getJob);
router.post('/', validateJob, createJob);

// New action endpoints (replace the old PATCH /:id/status)
router.post('/:id/accept', acceptJob);
router.post('/:id/reject', rejectJob);
router.post('/:id/cancel', cancelJob);
router.post('/:id/approve-start', approveStart);
router.post('/:id/approve-end', approveEnd);
router.post('/:id/accept-work', acceptWork);

export default router;
