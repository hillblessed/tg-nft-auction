import mongoose, { Document, Schema, Model } from 'mongoose';

export enum BidStatus {
  ACTIVE = 'active',
  WON = 'won',
  LOST = 'lost',
  CARRIED_OVER = 'carried_over',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}

export interface IBid extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  auctionId: mongoose.Types.ObjectId;
  amount: number;
  status: BidStatus;
  roundNumber: number;
  originalRound: number;
  isCarriedOver: boolean;
  wonAt?: Date;
  cancelledAt?: Date;
  refundedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const bidSchema = new Schema<IBid>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    auctionId: {
      type: Schema.Types.ObjectId,
      ref: 'Auction',
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [0.01, 'Bid amount must be positive'],
    },
    status: {
      type: String,
      enum: Object.values(BidStatus),
      default: BidStatus.ACTIVE,
      required: true,
      index: true,
    },
    roundNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    originalRound: {
      type: Number,
      required: true,
      min: 1,
    },
    isCarriedOver: {
      type: Boolean,
      default: false,
    },
    wonAt: {
      type: Date,
    },
    cancelledAt: {
      type: Date,
    },
    refundedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

bidSchema.index({ auctionId: 1, roundNumber: 1, status: 1 });
bidSchema.index({ auctionId: 1, userId: 1 });
bidSchema.index({ userId: 1, status: 1 });
bidSchema.index({ auctionId: 1, amount: -1 });
bidSchema.index({ auctionId: 1, roundNumber: 1, amount: -1 });

bidSchema.statics.findActiveBidsForRound = async function (
  auctionId: mongoose.Types.ObjectId,
  roundNumber: number
): Promise<IBid[]> {
  return this.find({
    auctionId,
    roundNumber,
    status: { $in: [BidStatus.ACTIVE, BidStatus.CARRIED_OVER] },
  }).sort({ amount: -1 });
};

bidSchema.statics.findUserActiveBid = async function (
  userId: mongoose.Types.ObjectId,
  auctionId: mongoose.Types.ObjectId
): Promise<IBid | null> {
  return this.findOne({
    userId,
    auctionId,
    status: { $in: [BidStatus.ACTIVE, BidStatus.CARRIED_OVER] },
  });
};

bidSchema.statics.carryOverBids = async function (
  auctionId: mongoose.Types.ObjectId,
  fromRound: number,
  toRound: number,
  loserBidIds: mongoose.Types.ObjectId[]
): Promise<void> {
  await this.updateMany(
    {
      _id: { $in: loserBidIds },
      auctionId,
      roundNumber: fromRound,
    },
    {
      $set: {
        roundNumber: toRound,
        status: BidStatus.CARRIED_OVER,
        isCarriedOver: true,
      },
    }
  );
};

export const Bid: Model<IBid> = mongoose.model<IBid>('Bid', bidSchema);
