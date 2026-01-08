export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class InsufficientFundsError extends AppError {
  constructor(message: string = 'Insufficient funds') {
    super(message, 400);
  }
}

export class AuctionNotFoundError extends AppError {
  constructor(auctionId: string) {
    super(`Auction not found: ${auctionId}`, 404);
  }
}

export class AuctionNotActiveError extends AppError {
  constructor(auctionId: string) {
    super(`Auction is not active: ${auctionId}`, 400);
  }
}

export class RoundNotActiveError extends AppError {
  constructor(auctionId: string, roundNumber: number) {
    super(`Round ${roundNumber} is not active for auction: ${auctionId}`, 400);
  }
}

export class UserNotFoundError extends AppError {
  constructor(userId: string) {
    super(`User not found: ${userId}`, 404);
  }
}

export class InvalidBidAmountError extends AppError {
  constructor(message: string = 'Invalid bid amount') {
    super(message, 400);
  }
}

export class DuplicateBidError extends AppError {
  constructor(message: string = 'User already has an active bid in this auction') {
    super(message, 400);
  }
}
