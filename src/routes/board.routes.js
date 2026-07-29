import { Router } from 'express';
import { protect, optionalAuth } from '../middleware/auth.js';
import {
  listMyBoards,
  createBoard,
  updateBoard,
  deleteBoard,
  getBoard,
  getFeaturedBoards,
  getSavedPins,
  followBoard,
  unfollowBoard,
  savePinToBoard,
  removePinFromBoard,
  getPinBoardState,
} from '../controllers/board.controller.js';

const router = Router();

router.get('/', protect, listMyBoards);
router.post('/', protect, createBoard);
router.get('/featured', getFeaturedBoards);                 // public, must precede /:id
router.get('/saved', protect, getSavedPins);                // must precede /:id
router.get('/pin-state/:pinId', protect, getPinBoardState); // board-picker state
router.get('/:id', optionalAuth, getBoard); // public boards viewable; privacy enforced in controller
router.patch('/:id', protect, updateBoard);
router.delete('/:id', protect, deleteBoard);
router.post('/:id/follow', protect, followBoard);
router.delete('/:id/follow', protect, unfollowBoard);
router.post('/:id/pins', protect, savePinToBoard);
router.delete('/:id/pins/:pinId', protect, removePinFromBoard);

export default router;
