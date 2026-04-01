import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { createJob, getMyJobs, getJob, updateJobStatus, validateJob } from '../controllers/job.controller.js';

const router = Router();

router.use(protect);

router.get('/', getMyJobs);
router.get('/:id', getJob);
router.post('/', validateJob, createJob);
router.patch('/:id/status', updateJobStatus);

export default router;
