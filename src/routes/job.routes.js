import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import {
  createJob,
  getMyJobs,
  getActiveJobs,
  getJob,
  validateJob,
  rejectJob,
  cancelJob,
  approveEnd,
  updateJobTitle,
} from '../controllers/job.controller.js';

const router = Router();

router.use(protect);

router.get('/', getMyJobs);
router.get('/active', getActiveJobs);
router.get('/:id', getJob);
router.post('/', validateJob, createJob);

// New action endpoints (replace the old PATCH /:id/status)
router.patch('/:id/title', updateJobTitle);
router.post('/:id/reject', rejectJob);
router.post('/:id/cancel', cancelJob);
router.post('/:id/approve-end', approveEnd);

export default router;
