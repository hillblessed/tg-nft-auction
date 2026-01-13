import mongoose from 'mongoose';
import { User, IUser } from '../models';
import { InsufficientFundsError, UserNotFoundError } from '../utils/errors';

export class WalletService {
  async lockFunds(
    userId: mongoose.Types.ObjectId,
    amount: number,
    session?: mongoose.ClientSession
  ): Promise<IUser> {
    if (amount <= 0) {
      throw new InsufficientFundsError('Lock amount must be positive');
    }

    // Atomic update: Check balance and increment frozenFunds in one go
    // We check if (balance - frozenFunds) >= amount by transforming to:
    // balance - frozenFunds - amount >= 0  =>  balance >= frozenFunds + amount
    // However, in a simple update we can't easily reference document fields in the query for comparison without $expr
    // Easier approach with optimistic concurrency or simple conditions:
    // We can just rely on the fact that we modify frozenFunds and check validity.
    // BUT, we want to prevent the update if funds are insufficient.
    
    // Using FindOneAndUpdate with a query condition is the standard way to do "compare and swap"
    
    /* 
       We need to ensure: balance - (frozenFunds + amount) >= 0
       So we query for: { _id: userId, $expr: { $gte: [ { $subtract: ["$balance", "$frozenFunds"] }, amount ] } }
    */

    const user = await User.findOneAndUpdate(
      { 
        _id: userId,
        $expr: { $gte: [ { $subtract: ["$balance", "$frozenFunds"] }, amount ] }
      },
      { $inc: { frozenFunds: amount } },
      { new: true, session }
    );
    
    if (!user) {
      // Either user doesn't exist OR condition failed (insufficient funds)
      // Let's verify which one it is to throw the right error
      const userExists = await User.findById(userId).session(session || null);
      if (!userExists) {
        throw new UserNotFoundError(userId.toString());
      }
      throw new InsufficientFundsError(
        `Insufficient funds. Available: ${userExists.balance - userExists.frozenFunds}, Required: ${amount}`
      );
    }

    return user;
  }

  async deductFunds(
    userId: mongoose.Types.ObjectId,
    amount: number,
    session?: mongoose.ClientSession
  ): Promise<IUser> {
    if (amount <= 0) {
      throw new InsufficientFundsError('Deduct amount must be positive');
    }

    // Atomic deduction: verify we have enough frozen funds AND balance
    // Usually we deduct from frozen funds assuming they were locked.
    // Condition: frozenFunds >= amount AND balance >= amount
    
    const user = await User.findOneAndUpdate(
      {
        _id: userId,
        frozenFunds: { $gte: amount },
        balance: { $gte: amount }
      },
      { 
        $inc: { 
          frozenFunds: -amount,
          balance: -amount
        } 
      },
      { new: true, session }
    );

    if (!user) {
         const userExists = await User.findById(userId).session(session || null);
      if (!userExists) {
        throw new UserNotFoundError(userId.toString());
      }
      throw new InsufficientFundsError(
        `Cannot deduct: sufficient frozen funds or balance not available.`
      );
    }

    return user;
  }

  async refundFunds(
    userId: mongoose.Types.ObjectId,
    amount: number,
    session?: mongoose.ClientSession
  ): Promise<IUser> {
    if (amount <= 0) {
      throw new InsufficientFundsError('Refund amount must be positive');
    }

    // Atomic refund: simply decrease frozenFunds
    // Condition: frozenFunds >= amount
    
    const user = await User.findOneAndUpdate(
      {
        _id: userId,
        frozenFunds: { $gte: amount }
      },
      { $inc: { frozenFunds: -amount } },
      { new: true, session }
    );

    if (!user) {
      const userExists = await User.findById(userId).session(session || null);
      if (!userExists) {
        throw new UserNotFoundError(userId.toString());
      }
       throw new InsufficientFundsError(
        `Cannot refund: frozen funds (${userExists.frozenFunds}) less than amount (${amount})`
      );
    }

    return user;
  }

  async getBalance(userId: mongoose.Types.ObjectId): Promise<{
    balance: number;
    frozenFunds: number;
    availableBalance: number;
  }> {
    const user = await User.findById(userId);
    
    if (!user) {
      throw new UserNotFoundError(userId.toString());
    }

    return {
      balance: user.balance,
      frozenFunds: user.frozenFunds,
      availableBalance: user.balance - user.frozenFunds,
    };
  }
}

export const walletService = new WalletService();
