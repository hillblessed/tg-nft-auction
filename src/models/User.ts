import mongoose, { Document, Schema, Model } from 'mongoose';

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  balance: number;
  frozenFunds: number;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    balance: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'Balance cannot be negative'],
    },
    frozenFunds: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'Frozen funds cannot be negative'],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

userSchema.index({ balance: 1 });
userSchema.index({ createdAt: -1 });

userSchema.methods.getAvailableBalance = function (): number {
  return this.balance - this.frozenFunds;
};

userSchema.statics.findByIdWithLock = async function (
  userId: mongoose.Types.ObjectId,
  session: mongoose.ClientSession
): Promise<IUser | null> {
  return this.findById(userId).session(session);
};

export const User: Model<IUser> = mongoose.model<IUser>('User', userSchema);
