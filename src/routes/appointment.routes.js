import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import {
  createAppointment,
  getMyAppointments,
  updateAppointmentStatus,
  rescheduleAppointment,
  validateAppointment,
  validateReschedule,
} from '../controllers/appointment.controller.js';

const router = Router();

router.use(protect);

router.get('/', getMyAppointments);
router.post('/', validateAppointment, createAppointment);
router.patch('/:id/status', updateAppointmentStatus);
router.patch('/:id/reschedule', validateReschedule, rescheduleAppointment);

export default router;
