import mongoose from 'mongoose';
import { User, IUser } from '../models';
import { InsufficientFundsError, UserNotFoundError } from '../utils/errors';

export class WalletService {
  async lockFunds(
    userId: mongoose.Types.ObjectId,
    amount: number
  ): Promise<IUser> {
    if (amount <= 0) {
      throw new InsufficientFundsError('Lock amount must be positive');
    }

    const user = await User.findById(userId);
    
    if (!user) {
      throw new UserNotFoundError(userId.toString());
    }

    const availableBalance = user.balance - user.frozenFunds;
    
    if (availableBalance < amount) {
      throw new InsufficientFundsError(
        `Insufficient funds. Available: ${availableBalance}, Required: ${amount}`
      );
    }

    user.frozenFunds += amount;
    await user.save();

    return user;
  }

  async deductFunds(
    userId: mongoose.Types.ObjectId,
    amount: number
  ): Promise<IUser> {
    if (amount <= 0) {
      throw new InsufficientFundsError('Deduct amount must be positive');
    }

    const user = await User.findById(userId);
    
    if (!user) {
      throw new UserNotFoundError(userId.toString());
    }

    if (user.frozenFunds < amount) {
      throw new InsufficientFundsError(
        `Cannot deduct: frozen funds (${user.frozenFunds}) less than amount (${amount})`
      );
    }

    if (user.balance < amount) {
      throw new InsufficientFundsError(
        `Cannot deduct: balance (${user.balance}) less than amount (${amount})`
      );
    }

    user.frozenFunds -= amount;
    user.balance -= amount;
    await user.save();

    return user;
  }

  async refundFunds(
    userId: mongoose.Types.ObjectId,
    amount: number
  ): Promise<IUser> {
    if (amount <= 0) {
      throw new InsufficientFundsError('Refund amount must be positive');
    }

    const user = await User.findById(userId);
    
    if (!user) {
      throw new UserNotFoundError(userId.toString());
    }

    if (user.frozenFunds < amount) {
      throw new InsufficientFundsError(
        `Cannot refund: frozen funds (${user.frozenFunds}) less than amount (${amount})`
      );
    }

    user.frozenFunds -= amount;
    await user.save();

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
