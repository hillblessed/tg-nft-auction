// src/models/Item.ts
// Represents a digital item/gift that can be won in an auction

import mongoose, { Document, Schema } from 'mongoose';

export interface IItem extends Document {
  auctionId: mongoose.Types.ObjectId;
  ownerId: mongoose.Types.ObjectId | null;
  serialNumber: number;
  roundWon: number | null;
  wonAt: Date | null;
  bidId: mongoose.Types.ObjectId | null;
  metadata: {
    name: string;
    description?: string;
    rarity?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const ItemSchema = new Schema<IItem>(
  {
    auctionId: {
      type: Schema.Types.ObjectId,
      ref: 'Auction',
      required: true,
      index: true,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    serialNumber: {
      type: Number,
      required: true,
    },
    roundWon: {
      type: Number,
      default: null,
    },
    wonAt: {
      type: Date,
      default: null,
    },
    bidId: {
      type: Schema.Types.ObjectId,
      ref: 'Bid',
      default: null,
    },
    metadata: {
      name: {
        type: String,
        required: true,
      },
      description: {
        type: String,
        default: '',
      },
      rarity: {
        type: String,
        enum: ['common', 'uncommon', 'rare', 'epic', 'legendary'],
        default: 'common',
      },
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient queries
ItemSchema.index({ auctionId: 1, serialNumber: 1 }, { unique: true });
ItemSchema.index({ auctionId: 1, ownerId: 1 });

export const Item = mongoose.model<IItem>('Item', ItemSchema);
