// src/demo-bots.ts
// Demo Bots - Simulates live auction activity for demonstration purposes
// Bots place random bids at intervals to show the system working in real-time

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { connectDB } from './config/database';
import { User } from './models';

dotenv.config();

const API_BASE = process.env.API_BASE || 'http://localhost:3000';

interface BotConfig {
  userId: string;
  balance: number;
  minBid: number;
  maxBid: number;
  intervalMs: number;
}

interface AuctionInfo {
  id: string;
  currentRound: number;
  endTime: Date;
  itemsPerRound: number;
}

let isRunning = true;
let activeBots: BotConfig[] = [];

async function placeBid(auctionId: string, userId: string, amount: number): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/auctions/${auctionId}/bid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, amount }),
    });
    
    const data = await response.json() as { success: boolean; error?: string };
    return data.success;
  } catch {
    return false;
  }
}

async function getActiveAuction(): Promise<AuctionInfo | null> {
  try {
    const response = await fetch(`${API_BASE}/api/auctions`);
    const data = await response.json() as { success: boolean; data?: any[] };
    
    if (data.success && data.data && data.data.length > 0) {
      const auction = data.data[0];
      const activeRound = auction.rounds.find((r: any) => r.status === 'active');
      
      return {
        id: auction._id,
        currentRound: auction.currentRound,
        endTime: activeRound ? new Date(activeRound.endTime) : new Date(),
        itemsPerRound: auction.itemsPerRound,
      };
    }
  } catch {
    // Ignore errors
  }
  return null;
}

async function getLeaderboard(auctionId: string): Promise<{ userId: string; amount: number }[]> {
  try {
    const response = await fetch(`${API_BASE}/api/auctions/${auctionId}/leaderboard?limit=20`);
    const data = await response.json() as { success: boolean; data?: { leaderboard: any[] } };
    
    if (data.success && data.data) {
      return data.data.leaderboard;
    }
  } catch {
    // Ignore errors
  }
  return [];
}

async function loadBots(): Promise<BotConfig[]> {
  const users = await User.find({}).limit(5);
  
  return users.map((user, index) => ({
    userId: user._id.toString(),
    balance: user.balance,
    minBid: 100 + index * 50,
    maxBid: 2000 + index * 500,
    intervalMs: 5000 + Math.random() * 10000, // 5-15 seconds
  }));
}

function getRandomBidAmount(bot: BotConfig, currentTopBid: number): number {
  // Smart bidding: try to outbid current top or place competitive bid
  const baseAmount = Math.max(bot.minBid, currentTopBid + 50);
  const randomExtra = Math.floor(Math.random() * (bot.maxBid - bot.minBid));
  return Math.min(baseAmount + randomExtra, bot.maxBid);
}

async function runBot(bot: BotConfig, auction: AuctionInfo): Promise<void> {
  const leaderboard = await getLeaderboard(auction.id);
  const topBid = leaderboard.length > 0 ? leaderboard[0].amount : 0;
  
  // Check if bot already has a bid
  const existingBid = leaderboard.find(entry => entry.userId === bot.userId);
  
  let bidAmount: number;
  
  if (existingBid) {
    // Bot already has a bid - decide whether to increase
    const rank = leaderboard.findIndex(e => e.userId === bot.userId) + 1;
    
    // Only increase if not in winning position
    if (rank > auction.itemsPerRound) {
      // Need to outbid to get into winning positions
      const targetPosition = leaderboard[auction.itemsPerRound - 1];
      bidAmount = targetPosition ? targetPosition.amount + Math.floor(Math.random() * 200) + 50 : existingBid.amount + 100;
    } else {
      // Already winning, skip this round
      return;
    }
  } else {
    // New bid
    bidAmount = getRandomBidAmount(bot, topBid);
  }
  
  // Don't bid more than balance allows
  if (bidAmount > bot.balance) {
    return;
  }
  
  const success = await placeBid(auction.id, bot.userId, bidAmount);
  
  if (success) {
    console.log(`🤖 Bot ...${bot.userId.slice(-6)} placed bid: ${bidAmount}`);
  }
}

async function runDemoBots(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   🤖 DEMO BOTS - Live Auction Simulation');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   Press Ctrl+C to stop\n');
  
  try {
    await connectDB();
    console.log('✅ Connected to MongoDB');
    
    // Load bot configurations
    activeBots = await loadBots();
    
    if (activeBots.length === 0) {
      console.log('❌ No users found. Run `npm run seed` first.');
      process.exit(1);
    }
    
    console.log(`✅ Loaded ${activeBots.length} bots:\n`);
    activeBots.forEach((bot, i) => {
      console.log(`   Bot ${i + 1}: ...${bot.userId.slice(-6)} | Balance: ${bot.balance} | Interval: ${Math.round(bot.intervalMs / 1000)}s`);
    });
    console.log('');
    
    // Main loop
    while (isRunning) {
      const auction = await getActiveAuction();
      
      if (!auction) {
        console.log('⏳ Waiting for active auction...');
        await sleep(5000);
        continue;
      }
      
      const timeUntilEnd = auction.endTime.getTime() - Date.now();
      
      if (timeUntilEnd <= 0) {
        console.log('⏳ Round ended, waiting for next round...');
        await sleep(3000);
        continue;
      }
      
      // Pick a random bot to act
      const bot = activeBots[Math.floor(Math.random() * activeBots.length)];
      
      // Increase activity near end of round (anti-snipe testing)
      const isNearEnd = timeUntilEnd < 60000; // Last 60 seconds
      
      await runBot(bot, auction);
      
      // Wait before next action
      const waitTime = isNearEnd 
        ? 2000 + Math.random() * 3000  // 2-5 seconds near end
        : 4000 + Math.random() * 8000; // 4-12 seconds normally
      
      await sleep(waitTime);
    }
    
  } catch (error) {
    console.error('\n❌ Demo bots error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Demo bots stopped.');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Stopping demo bots...');
  isRunning = false;
});

process.on('SIGTERM', () => {
  isRunning = false;
});

// Run
runDemoBots();
