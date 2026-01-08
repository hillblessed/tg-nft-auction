import mongoose, { Document, Schema, Model } from 'mongoose';

export enum AuctionStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum RoundStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  FINALIZING = 'finalizing',
  COMPLETED = 'completed',
}

export interface IRoundWinner {
  userId: mongoose.Types.ObjectId;
  bidId: mongoose.Types.ObjectId;
  amount: number;
  rank: number;
  wonAt: Date;
}

export interface IRound {
  roundNumber: number;
  startTime: Date;
  endTime: Date;
  status: RoundStatus;
  itemsInRound: number;
  winners: IRoundWinner[];
  extendedCount: number;
}

export interface IAuction extends Document {
  _id: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  totalItems: number;
  itemsPerRound: number;
  totalRounds: number;
  currentRound: number;
  status: AuctionStatus;
  rounds: IRound[];
  antiSnipeWindowSeconds: number;
  antiSnipeExtensionSeconds: number;
  createdAt: Date;
  updatedAt: Date;
}

const roundWinnerSchema = new Schema<IRoundWinner>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    bidId: {
      type: Schema.Types.ObjectId,
      ref: 'Bid',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    rank: {
      type: Number,
      required: true,
      min: 1,
    },
    wonAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  { _id: false }
);

const roundSchema = new Schema<IRound>(
  {
    roundNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(RoundStatus),
      default: RoundStatus.PENDING,
      required: true,
    },
    itemsInRound: {
      type: Number,
      required: true,
      min: 1,
    },
    winners: {
      type: [roundWinnerSchema],
      default: [],
    },
    extendedCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false }
);

const auctionSchema = new Schema<IAuction>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    totalItems: {
      type: Number,
      required: true,
      min: [1, 'Total items must be at least 1'],
    },
    itemsPerRound: {
      type: Number,
      required: true,
      min: [1, 'Items per round must be at least 1'],
    },
    totalRounds: {
      type: Number,
      required: true,
      min: [1, 'Total rounds must be at least 1'],
    },
    currentRound: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: Object.values(AuctionStatus),
      default: AuctionStatus.PENDING,
      required: true,
      index: true,
    },
    rounds: {
      type: [roundSchema],
      default: [],
    },
    antiSnipeWindowSeconds: {
      type: Number,
      default: 30,
      min: 0,
    },
    antiSnipeExtensionSeconds: {
      type: Number,
      default: 30,
      min: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

auctionSchema.index({ status: 1, 'rounds.status': 1 });
auctionSchema.index({ 'rounds.endTime': 1 });
auctionSchema.index({ createdAt: -1 });

auctionSchema.pre('validate', function (next) {
  if (this.isNew && this.totalItems && this.itemsPerRound) {
    this.totalRounds = Math.ceil(this.totalItems / this.itemsPerRound);
  }
  next();
});

auctionSchema.methods.getCurrentRound = function (): IRound | null {
  if (this.currentRound === 0 || this.currentRound > this.rounds.length) {
    return null;
  }
  return this.rounds[this.currentRound - 1];
};

auctionSchema.methods.isAntiSnipeActive = function (): boolean {
  const currentRound = this.getCurrentRound();
  if (!currentRound || currentRound.status !== RoundStatus.ACTIVE) {
    return false;
  }
  const now = new Date();
  const timeUntilEnd = currentRound.endTime.getTime() - now.getTime();
  return timeUntilEnd <= this.antiSnipeWindowSeconds * 1000 && timeUntilEnd > 0;
};

export const Auction: Model<IAuction> = mongoose.model<IAuction>('Auction', auctionSchema);
