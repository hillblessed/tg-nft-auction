import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { AuctionService } from '../services/AuctionService';
import { AppError } from '../utils/errors';

export class AuctionController {
  private auctionService: AuctionService;

  constructor(auctionService: AuctionService) {
    this.auctionService = auctionService;
  }

  placeBid = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const { userId, amount } = req.body;

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({
          success: false,
          error: 'Invalid auction ID',
        });
        return;
      }

      if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
        res.status(400).json({
          success: false,
          error: 'Invalid user ID',
        });
        return;
      }

      if (!amount || typeof amount !== 'number' || amount <= 0) {
        res.status(400).json({
          success: false,
          error: 'Invalid bid amount. Must be a positive number.',
        });
        return;
      }

      const result = await this.auctionService.placeBid(
        new mongoose.Types.ObjectId(userId),
        new mongoose.Types.ObjectId(id),
        amount
      );

      res.status(201).json({
        success: true,
        data: {
          bidId: result.bid._id,
          amount: result.bid.amount,
          roundNumber: result.bid.roundNumber,
          roundExtended: result.roundExtended,
          newEndTime: result.newEndTime,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  getAuction = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({
          success: false,
          error: 'Invalid auction ID',
        });
        return;
      }

      const auction = await this.auctionService.getAuctionById(
        new mongoose.Types.ObjectId(id)
      );

      if (!auction) {
        res.status(404).json({
          success: false,
          error: 'Auction not found',
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: auction,
      });
    } catch (error) {
      next(error);
    }
  };

  getLeaderboard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      let roundNumber = parseInt(req.query.round as string, 10);
      const limit = parseInt(req.query.limit as string, 10) || 100;

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({
          success: false,
          error: 'Invalid auction ID',
        });
        return;
      }

      if (isNaN(roundNumber) || roundNumber < 1) {
        const auction = await this.auctionService.getAuctionById(
          new mongoose.Types.ObjectId(id)
        );
        if (!auction) {
          res.status(404).json({ success: false, error: 'Auction not found' });
          return;
        }
        roundNumber = auction.currentRound || 1;
      }

      const leaderboard = await this.auctionService.getLeaderboard(
        new mongoose.Types.ObjectId(id),
        roundNumber,
        limit
      );

      res.status(200).json({
        success: true,
        data: {
          auctionId: id,
          roundNumber,
          leaderboard,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  getUserRank = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id, userId } = req.params;
      const roundNumber = parseInt(req.query.round as string, 10);

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({
          success: false,
          error: 'Invalid auction ID',
        });
        return;
      }

      if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
        res.status(400).json({
          success: false,
          error: 'Invalid user ID',
        });
        return;
      }

      if (isNaN(roundNumber) || roundNumber < 1) {
        res.status(400).json({
          success: false,
          error: 'Invalid round number',
        });
        return;
      }

      const rankInfo = await this.auctionService.getUserRank(
        new mongoose.Types.ObjectId(userId),
        new mongoose.Types.ObjectId(id),
        roundNumber
      );

      res.status(200).json({
        success: true,
        data: {
          auctionId: id,
          userId,
          roundNumber,
          ...rankInfo,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  getActiveAuctions = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auctions = await this.auctionService.getActiveAuctions();

      res.status(200).json({
        success: true,
        data: auctions,
      });
    } catch (error) {
      next(error);
    }
  };

  createAuction = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { title, description, itemsPerRound, totalRounds, roundDurationMinutes } = req.body;

      if (!title || typeof title !== 'string') {
        res.status(400).json({ success: false, error: 'Title is required' });
        return;
      }

      const auction = await this.auctionService.createAuction({
        title,
        description: description || '',
        itemsPerRound: itemsPerRound || 10,
        totalRounds: totalRounds || 5,
        roundDurationMinutes: roundDurationMinutes || 2,
      });

      res.status(201).json({
        success: true,
        data: auction,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  console.error('Error:', err);

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
    });
    return;
  }

  res.status(500).json({
    success: false,
    error: 'Internal server error',
  });
};
