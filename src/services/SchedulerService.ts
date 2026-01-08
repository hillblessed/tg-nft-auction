import * as cron from 'node-cron';
import mongoose from 'mongoose';
import type { Server as SocketIOServer } from 'socket.io';
import { Auction, AuctionStatus, RoundStatus } from '../models';
import { AuctionService } from './AuctionService';

export class SchedulerService {
  private auctionService: AuctionService;
  private io?: SocketIOServer;
  private cronJob: cron.ScheduledTask | null = null;
  private isProcessing: boolean = false;

  constructor(auctionService: AuctionService, io?: SocketIOServer) {
    this.auctionService = auctionService;
    this.io = io;
  }

  start(): void {
    if (this.cronJob) {
      console.log('⚠️ Scheduler is already running');
      return;
    }

    this.cronJob = cron.schedule('*/5 * * * * *', async () => {
      await this.checkAndProcessRounds();
    });

    console.log('🕐 Scheduler started - checking rounds every 5 seconds');
  }

  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      console.log('🛑 Scheduler stopped');
    }
  }

  private async checkAndProcessRounds(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      const now = new Date();

      const auctionsWithExpiredRounds = await Auction.find({
        status: AuctionStatus.ACTIVE,
        'rounds': {
          $elemMatch: {
            status: RoundStatus.ACTIVE,
            endTime: { $lte: now },
          },
        },
      });

      for (const auction of auctionsWithExpiredRounds) {
        const expiredRound = auction.rounds.find(
          r => r.status === RoundStatus.ACTIVE && r.endTime <= now
        );

        if (expiredRound) {
          console.log(
            `⏰ Round ${expiredRound.roundNumber} expired for auction ${auction._id}, processing...`
          );

          try {
            const result = await this.auctionService.processRoundEnd(
              auction._id as mongoose.Types.ObjectId,
              expiredRound.roundNumber
            );

            if (this.io) {
              this.io.emit('roundEnd', {
                auctionId: auction._id.toString(),
                roundNumber: expiredRound.roundNumber,
                winnersCount: result.winnersCount,
                nextRound: expiredRound.roundNumber < auction.totalRounds ? expiredRound.roundNumber + 1 : null,
              });
            }
          } catch (error) {
            console.error(
              `❌ Failed to process round ${expiredRound.roundNumber} for auction ${auction._id}:`,
              error
            );
          }
        }
      }
    } catch (error) {
      console.error('❌ Scheduler error:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  async processRoundManually(
    auctionId: mongoose.Types.ObjectId,
    roundNumber: number
  ): Promise<void> {
    console.log(`🔧 Manual processing of round ${roundNumber} for auction ${auctionId}`);
    await this.auctionService.processRoundEnd(auctionId, roundNumber);
  }
}
