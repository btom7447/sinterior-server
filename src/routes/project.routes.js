import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import {
  createProject,
  getMyProjects,
  getProject,
  updateProject,
  deleteProject,
  validateProject,
} from '../controllers/project.controller.js';

const router = Router();

router.use(protect);

router.get('/', getMyProjects);
router.get('/:id', getProject);
router.post('/', validateProject, createProject);
router.patch('/:id', updateProject);
router.delete('/:id', deleteProject);

export default router;
