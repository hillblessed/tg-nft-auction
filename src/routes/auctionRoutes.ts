import { Router } from 'express';
import { AuctionController } from '../controllers/AuctionController';

export const createAuctionRoutes = (auctionController: AuctionController): Router => {
  const router = Router();

  router.get('/', auctionController.getActiveAuctions);

  router.post('/', auctionController.createAuction);

  router.post('/:id/bid', auctionController.placeBid);

  router.get('/:id', auctionController.getAuction);

  router.get('/:id/leaderboard', auctionController.getLeaderboard);

  router.get('/:id/user/:userId/rank', auctionController.getUserRank);

  return router;
};
