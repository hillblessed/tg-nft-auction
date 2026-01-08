import mongoose from 'mongoose';
import type { Redis } from 'ioredis';
import type { Server as SocketIOServer } from 'socket.io';
import { Auction, IAuction, Bid, IBid, BidStatus, AuctionStatus, RoundStatus, IRound, Item } from '../models';
import { WalletService } from './WalletService';
import { config } from '../config';
import {
  AuctionNotFoundError,
  AuctionNotActiveError,
  RoundNotActiveError,
  InvalidBidAmountError,
} from '../utils/errors';

export interface PlaceBidResult {
  bid: IBid;
  auction: IAuction;
  roundExtended: boolean;
  newEndTime?: Date;
}

export class AuctionService {
  private walletService: WalletService;
  private redis: Redis;
  private io?: SocketIOServer;

  constructor(walletService: WalletService, redis: Redis, io?: SocketIOServer) {
    this.walletService = walletService;
    this.redis = redis;
    this.io = io;
  }

  private getRedisLeaderboardKey(auctionId: string, roundNumber: number): string {
    return `auction:${auctionId}:round:${roundNumber}`;
  }

  private findActiveRound(auction: IAuction): IRound | null {
    const now = new Date();
    
    for (const round of auction.rounds) {
      if (
        round.status === RoundStatus.ACTIVE &&
        round.startTime <= now &&
        round.endTime > now
      ) {
        return round;
      }
    }
    
    return null;
  }

  async placeBid(
    userId: mongoose.Types.ObjectId,
    auctionId: mongoose.Types.ObjectId,
    amount: number
  ): Promise<PlaceBidResult> {
    if (amount <= 0) {
      throw new InvalidBidAmountError('Bid amount must be positive');
    }

    const auction = await Auction.findById(auctionId);
    
    if (!auction) {
      throw new AuctionNotFoundError(auctionId.toString());
    }

    if (auction.status !== AuctionStatus.ACTIVE) {
      throw new AuctionNotActiveError(auctionId.toString());
    }

    const activeRound = this.findActiveRound(auction);
    
    if (!activeRound) {
      throw new RoundNotActiveError(auctionId.toString(), auction.currentRound);
    }

    const existingBid = await Bid.findOne({
      userId,
      auctionId,
      status: { $in: [BidStatus.ACTIVE, BidStatus.CARRIED_OVER] },
    });

    let bid: IBid;
    let roundExtended = false;
    let newEndTime: Date | undefined;

    if (existingBid) {
      // Bid increment: amount is the ADDITIONAL sum to add to existing bid
      if (amount <= 0) {
        throw new InvalidBidAmountError('Additional amount must be greater than 0');
      }

      // Lock the additional amount
      await this.walletService.lockFunds(userId, amount);

      // Update existing bid: add the amount to current bid
      const newTotalBid = existingBid.amount + amount;
      existingBid.amount = newTotalBid;
      existingBid.updatedAt = new Date();
      await existingBid.save();

      bid = existingBid;
    } else {
      // New bid
      await this.walletService.lockFunds(userId, amount);

      bid = new Bid({
        userId,
        auctionId,
        amount,
        status: BidStatus.ACTIVE,
        roundNumber: activeRound.roundNumber,
        originalRound: activeRound.roundNumber,
        isCarriedOver: false,
      });

      await bid.save();
    }

    const now = new Date();
    const timeUntilEnd = activeRound.endTime.getTime() - now.getTime();
    const antiSnipeWindow = config.antiSnipeWindowSeconds * 1000;

    if (timeUntilEnd > 0 && timeUntilEnd <= antiSnipeWindow) {
      const extensionMs = config.antiSnipeExtensionSeconds * 1000;
      newEndTime = new Date(activeRound.endTime.getTime() + extensionMs);

      await Auction.updateOne(
        { 
          _id: auctionId, 
          'rounds.roundNumber': activeRound.roundNumber 
        },
        {
          $set: { 'rounds.$.endTime': newEndTime },
          $inc: { 'rounds.$.extendedCount': 1 },
        }
      );

      roundExtended = true;
    }

    try {
      const leaderboardKey = this.getRedisLeaderboardKey(
        auctionId.toString(),
        activeRound.roundNumber
      );
      
      // Use bid.amount (total bid) not amount (which could be just the increment)
      await this.redis.zadd(leaderboardKey, bid.amount, userId.toString());
    } catch (redisError) {
      console.error('Failed to update Redis leaderboard:', redisError);
    }

    const updatedAuction = await Auction.findById(auctionId);

    if (this.io) {
      this.io.emit('newBid', {
        auctionId: auctionId.toString(),
        oderId: userId.toString(),
        amount: bid.amount, // Send total bid amount
        roundNumber: activeRound.roundNumber,
      });

      if (roundExtended && newEndTime) {
        this.io.emit('roundExtended', {
          auctionId: auctionId.toString(),
          roundNumber: activeRound.roundNumber,
          newEndTime: newEndTime.toISOString(),
        });
      }
    }

    return {
      bid,
      auction: updatedAuction!,
      roundExtended,
      newEndTime,
    };
  }

  async getLeaderboard(
    auctionId: mongoose.Types.ObjectId,
    roundNumber: number,
    limit: number = 100
  ): Promise<{ userId: string; amount: number; rank: number }[]> {
    const leaderboardKey = this.getRedisLeaderboardKey(auctionId.toString(), roundNumber);
    
    const results = await this.redis.zrevrange(leaderboardKey, 0, limit - 1, 'WITHSCORES');
    
    const leaderboard: { userId: string; amount: number; rank: number }[] = [];
    
    for (let i = 0; i < results.length; i += 2) {
      leaderboard.push({
        userId: results[i],
        amount: parseFloat(results[i + 1]),
        rank: Math.floor(i / 2) + 1,
      });
    }

    return leaderboard;
  }

  async getUserRank(
    userId: mongoose.Types.ObjectId,
    auctionId: mongoose.Types.ObjectId,
    roundNumber: number
  ): Promise<{ rank: number | null; amount: number | null }> {
    const leaderboardKey = this.getRedisLeaderboardKey(auctionId.toString(), roundNumber);
    
    const rank = await this.redis.zrevrank(leaderboardKey, userId.toString());
    const score = await this.redis.zscore(leaderboardKey, userId.toString());

    return {
      rank: rank !== null ? rank + 1 : null,
      amount: score !== null ? parseFloat(score) : null,
    };
  }

  async processRoundEnd(
    auctionId: mongoose.Types.ObjectId,
    roundNumber: number
  ): Promise<{ winnersCount: number; losersCarriedOver: number; losersRefunded: number }> {
    const auction = await Auction.findById(auctionId);
    
    if (!auction) {
      throw new AuctionNotFoundError(auctionId.toString());
    }

    const round = auction.rounds.find(r => r.roundNumber === roundNumber);
    
    if (!round) {
      throw new RoundNotActiveError(auctionId.toString(), roundNumber);
    }

    if (round.status !== RoundStatus.ACTIVE) {
      console.log(`Round ${roundNumber} is not active (status: ${round.status}), skipping`);
      return { winnersCount: 0, losersCarriedOver: 0, losersRefunded: 0 };
    }

    await Auction.updateOne(
      { _id: auctionId, 'rounds.roundNumber': roundNumber },
      { $set: { 'rounds.$.status': RoundStatus.FINALIZING } }
    );

    const leaderboardKey = this.getRedisLeaderboardKey(auctionId.toString(), roundNumber);
    const itemsInRound = round.itemsInRound;

    const winnersData = await this.redis.zrevrange(
      leaderboardKey, 
      0, 
      itemsInRound - 1, 
      'WITHSCORES'
    );

    const winners: { oderId: string; amount: number }[] = [];
    for (let i = 0; i < winnersData.length; i += 2) {
      winners.push({
        oderId: winnersData[i],
        amount: parseFloat(winnersData[i + 1]),
      });
    }

    let winnersCount = 0;
    let losersCarriedOver = 0;
    let losersRefunded = 0;

    const winnerUserIds = winners.map(w => new mongoose.Types.ObjectId(w.oderId));
    const roundWinners: IAuction['rounds'][0]['winners'] = [];

    for (let rankIdx = 0; rankIdx < winners.length; rankIdx++) {
      const winner = winners[rankIdx];
      const oderId = new mongoose.Types.ObjectId(winner.oderId);

      const bid = await Bid.findOneAndUpdate(
        {
          userId: oderId,
          auctionId,
          status: { $in: [BidStatus.ACTIVE, BidStatus.CARRIED_OVER] },
        },
        {
          $set: {
            status: BidStatus.WON,
            wonAt: new Date(),
          },
        },
        { new: true }
      );

      if (bid) {
        await this.walletService.deductFunds(oderId, winner.amount);
        
        // Assign item ownership to winner
        const itemSerialNumber = (roundNumber - 1) * itemsInRound + rankIdx + 1;
        await Item.findOneAndUpdate(
          { auctionId, serialNumber: itemSerialNumber },
          {
            $set: {
              ownerId: oderId,
              roundWon: roundNumber,
              wonAt: new Date(),
              bidId: bid._id,
            },
          },
          { upsert: true, new: true }
        );
        
        roundWinners.push({
          userId: oderId,
          bidId: bid._id,
          amount: winner.amount,
          rank: rankIdx + 1,
          wonAt: new Date(),
        });
        
        winnersCount++;

        // Emit item won event
        if (this.io) {
          this.io.emit('itemWon', {
            auctionId: auctionId.toString(),
            roundNumber,
            userId: oderId.toString(),
            itemSerialNumber,
            amount: winner.amount,
            rank: rankIdx + 1,
          });
        }
      }
    }

    await Auction.updateOne(
      { _id: auctionId, 'rounds.roundNumber': roundNumber },
      { $set: { 'rounds.$.winners': roundWinners } }
    );

    if (winnerUserIds.length > 0) {
      await this.redis.zrem(leaderboardKey, ...winnerUserIds.map(id => id.toString()));
    }

    const remainingLosers = await this.redis.zrevrange(leaderboardKey, 0, -1, 'WITHSCORES');
    const losers: { oderId: string; amount: number }[] = [];
    
    for (let i = 0; i < remainingLosers.length; i += 2) {
      losers.push({
        oderId: remainingLosers[i],
        amount: parseFloat(remainingLosers[i + 1]),
      });
    }

    const isLastRound = roundNumber >= auction.totalRounds;
    const nextRoundNumber = roundNumber + 1;

    if (isLastRound) {
      for (const loser of losers) {
        const loserUserId = new mongoose.Types.ObjectId(loser.oderId);

        await Bid.updateOne(
          {
            userId: loserUserId,
            auctionId,
            status: { $in: [BidStatus.ACTIVE, BidStatus.CARRIED_OVER] },
          },
          {
            $set: {
              status: BidStatus.REFUNDED,
              refundedAt: new Date(),
            },
          }
        );

        await this.walletService.refundFunds(loserUserId, loser.amount);
        losersRefunded++;
      }

      await Auction.updateOne(
        { _id: auctionId },
        { $set: { status: AuctionStatus.COMPLETED } }
      );
    } else {
      const nextRoundKey = this.getRedisLeaderboardKey(auctionId.toString(), nextRoundNumber);

      for (const loser of losers) {
        const loserUserId = new mongoose.Types.ObjectId(loser.oderId);

        await Bid.updateOne(
          {
            userId: loserUserId,
            auctionId,
            status: { $in: [BidStatus.ACTIVE, BidStatus.CARRIED_OVER] },
          },
          {
            $set: {
              status: BidStatus.CARRIED_OVER,
              roundNumber: nextRoundNumber,
              isCarriedOver: true,
            },
          }
        );

        losersCarriedOver++;
      }

      if (losers.length > 0) {
        const pipeline = this.redis.pipeline();
        for (const loser of losers) {
          pipeline.zadd(nextRoundKey, loser.amount, loser.oderId);
        }
        await pipeline.exec();
      }

      await Auction.updateOne(
        { _id: auctionId, 'rounds.roundNumber': nextRoundNumber },
        { $set: { 'rounds.$.status': RoundStatus.ACTIVE } }
      );

      await Auction.updateOne(
        { _id: auctionId },
        { $set: { currentRound: nextRoundNumber } }
      );
    }

    await this.redis.del(leaderboardKey);

    await Auction.updateOne(
      { _id: auctionId, 'rounds.roundNumber': roundNumber },
      { $set: { 'rounds.$.status': RoundStatus.COMPLETED } }
    );

    console.log(
      `✅ Round ${roundNumber} processed for auction ${auctionId}: ` +
      `${winnersCount} winners, ${losersCarriedOver} carried over, ${losersRefunded} refunded`
    );

    return { winnersCount, losersCarriedOver, losersRefunded };
  }

  async getAuctionById(auctionId: mongoose.Types.ObjectId): Promise<IAuction | null> {
    return Auction.findById(auctionId);
  }

  async getActiveAuctions(): Promise<IAuction[]> {
    return Auction.find({ status: AuctionStatus.ACTIVE }).sort({ createdAt: -1 });
  }

  async createAuction(params: {
    title: string;
    description?: string;
    itemsPerRound?: number;
    totalRounds?: number;
    roundDurationMinutes?: number;
  }): Promise<IAuction> {
    const {
      title,
      description = '',
      itemsPerRound = 10,
      totalRounds = 5,
      roundDurationMinutes = 2,
    } = params;

    // Delete all existing active auctions to keep only one running
    const existingAuctions = await Auction.find({ status: AuctionStatus.ACTIVE });
    for (const existing of existingAuctions) {
      // Clean up Redis leaderboards for all rounds
      for (let r = 1; r <= existing.totalRounds; r++) {
        const key = this.getRedisLeaderboardKey(existing._id.toString(), r);
        await this.redis.del(key);
      }
      // Delete related bids and items
      await Bid.deleteMany({ auctionId: existing._id });
      await Item.deleteMany({ auctionId: existing._id });
      await existing.deleteOne();
    }

    const now = new Date();
    const rounds = [];

    for (let i = 0; i < totalRounds; i++) {
      const startTime = new Date(now.getTime() + i * roundDurationMinutes * 60 * 1000);
      const endTime = new Date(startTime.getTime() + roundDurationMinutes * 60 * 1000);
      rounds.push({
        roundNumber: i + 1,
        status: i === 0 ? RoundStatus.ACTIVE : RoundStatus.PENDING,
        startTime,
        endTime,
        winners: [],
        itemsInRound: itemsPerRound,
        extendedCount: 0,
      });
    }

    const auction = new Auction({
      title,
      description,
      status: AuctionStatus.ACTIVE,
      totalItems: itemsPerRound * totalRounds,
      itemsPerRound,
      totalRounds,
      currentRound: 1,
      rounds,
    });

    await auction.save();

    // Create items for the auction
    const totalItems = itemsPerRound * totalRounds;
    const itemsData = [];
    
    for (let i = 0; i < totalItems; i++) {
      itemsData.push({
        auctionId: auction._id,
        serialNumber: i + 1,
        ownerId: null,
        roundWon: null,
        wonAt: null,
        bidId: null,
        metadata: {
          name: `${title} #${i + 1}`,
          description: description,
          rarity: i < 3 ? 'legendary' : i < Math.floor(totalItems * 0.3) ? 'epic' : 'rare',
        },
      });
    }
    
    await Item.insertMany(itemsData);

    if (this.io) {
      this.io.emit('auctionCreated', {
        auctionId: auction._id.toString(),
        title: auction.title,
        totalItems,
      });
    }

    return auction;
  }
}
