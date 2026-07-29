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
  likeBoard,
  unlikeBoard,
  savePinToBoard,
  removePinFromBoard,
  getPinBoardState,
  unsavePinEverywhere,
  reorderBoards,
  setSavedPinTop,
} from '../controllers/board.controller.js';

const router = Router();

router.get('/', protect, listMyBoards);
router.post('/', protect, createBoard);
router.get('/featured', getFeaturedBoards);                 // public, must precede /:id
router.get('/saved', protect, getSavedPins);                // must precede /:id
router.get('/pin-state/:pinId', protect, getPinBoardState); // board-picker state
router.delete('/pin/:pinId', protect, unsavePinEverywhere);  // must precede /:id
router.patch('/order', protect, reorderBoards);              // must precede /:id
router.post('/pin/:pinId/top', protect, setSavedPinTop);
router.delete('/pin/:pinId/top', protect, setSavedPinTop);
router.get('/:id', optionalAuth, getBoard); // public boards viewable; privacy enforced in controller
router.patch('/:id', protect, updateBoard);
router.delete('/:id', protect, deleteBoard);
router.post('/:id/follow', protect, followBoard);
router.post('/:id/like', protect, likeBoard);
router.delete('/:id/like', protect, unlikeBoard);
router.delete('/:id/follow', protect, unfollowBoard);
router.post('/:id/pins', protect, savePinToBoard);
router.delete('/:id/pins/:pinId', protect, removePinFromBoard);

export default router;
