// src/load-test.ts
// Load Testing Script for Digital Goods Auction System
// Simulates concurrent bids and sniping attacks to verify system robustness

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { connectDB } from './config/database';
import { User } from './models';

dotenv.config();

const API_BASE = process.env.API_BASE || 'http://localhost:3000';

interface TestResult {
  totalBids: number;
  successfulBids: number;
  failedBids: number;
  duplicateBidErrors: number;
  insufficientFundsErrors: number;
  otherErrors: number;
  roundExtended: boolean;
  avgResponseTime: number;
  maxResponseTime: number;
  minResponseTime: number;
}

interface BidResponse {
  success: boolean;
  data?: {
    bidId: string;
    amount: number;
    roundExtended: boolean;
    newEndTime?: string;
  };
  error?: string;
}

async function placeBid(
  auctionId: string,
  userId: string,
  amount: number
): Promise<{ success: boolean; roundExtended: boolean; error?: string; responseTime: number }> {
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${API_BASE}/api/auctions/${auctionId}/bid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, amount }),
    });
    
    const data = await response.json() as BidResponse;
    const responseTime = Date.now() - startTime;
    
    return {
      success: data.success,
      roundExtended: data.data?.roundExtended || false,
      error: data.error,
      responseTime,
    };
  } catch (error) {
    return {
      success: false,
      roundExtended: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      responseTime: Date.now() - startTime,
    };
  }
}

async function createTestUsers(count: number): Promise<string[]> {
  console.log(`\n📦 Creating ${count} test users for load testing...`);
  
  const usersData = Array.from({ length: count }, () => ({
    balance: 100000, // High balance for testing
    frozenFunds: 0,
  }));
  
  const users = await User.insertMany(usersData);
  const userIds = users.map(u => u._id.toString());
  
  console.log(`✅ Created ${userIds.length} test users`);
  return userIds;
}

async function getActiveAuction(): Promise<{ id: string; currentRound: number; endTime: Date; itemsPerRound: number } | null> {
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
  
  return null;
}

async function getLeaderboard(auctionId: string): Promise<{ userId: string; amount: number; rank: number }[]> {
  try {
    const response = await fetch(`${API_BASE}/api/auctions/${auctionId}/leaderboard?limit=50`);
    const data = await response.json() as { success: boolean; data?: { leaderboard: any[] } };
    
    if (data.success && data.data) {
      return data.data.leaderboard;
    }
  } catch {
    // Ignore errors
  }
  return [];
}

async function runConcurrentBidsTest(
  auctionId: string,
  userIds: string[],
  bidCount: number
): Promise<TestResult> {
  console.log(`\n🚀 Running Concurrent Bids Test: ${bidCount} bids...`);
  
  const results: TestResult = {
    totalBids: bidCount,
    successfulBids: 0,
    failedBids: 0,
    duplicateBidErrors: 0,
    insufficientFundsErrors: 0,
    otherErrors: 0,
    roundExtended: false,
    avgResponseTime: 0,
    maxResponseTime: 0,
    minResponseTime: Infinity,
  };
  
  const responseTimes: number[] = [];
  
  // Create bid promises - each user bids a random amount
  const bidPromises = Array.from({ length: bidCount }, (_, i) => {
    const userId = userIds[i % userIds.length];
    const amount = Math.floor(Math.random() * 5000) + 100; // Random bid 100-5100
    return placeBid(auctionId, userId, amount);
  });
  
  // Execute all bids concurrently
  const startTime = Date.now();
  const bidResults = await Promise.all(bidPromises);
  const totalTime = Date.now() - startTime;
  
  // Analyze results
  for (const result of bidResults) {
    responseTimes.push(result.responseTime);
    
    if (result.success) {
      results.successfulBids++;
      if (result.roundExtended) {
        results.roundExtended = true;
      }
    } else {
      results.failedBids++;
      if (result.error?.includes('already has an active bid') || result.error?.includes('must be higher')) {
        results.duplicateBidErrors++;
      } else if (result.error?.includes('Insufficient')) {
        results.insufficientFundsErrors++;
      } else {
        results.otherErrors++;
      }
    }
  }
  
  // Calculate timing stats
  results.avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
  results.maxResponseTime = Math.max(...responseTimes);
  results.minResponseTime = Math.min(...responseTimes);
  
  console.log(`\n📊 Concurrent Bids Test Results:`);
  console.log(`   Total Time: ${totalTime}ms`);
  console.log(`   ✅ Successful: ${results.successfulBids}/${results.totalBids}`);
  console.log(`   ❌ Failed: ${results.failedBids}`);
  console.log(`      - Duplicate/Increment errors: ${results.duplicateBidErrors}`);
  console.log(`      - Insufficient funds: ${results.insufficientFundsErrors}`);
  console.log(`      - Other errors: ${results.otherErrors}`);
  console.log(`   ⏱️  Avg Response: ${results.avgResponseTime.toFixed(2)}ms`);
  console.log(`   ⏱️  Min/Max: ${results.minResponseTime}ms / ${results.maxResponseTime}ms`);
  
  return results;
}

async function runSnipingAttackTest(
  auctionId: string,
  userIds: string[]
): Promise<{ roundExtended: boolean; extensionCount: number }> {
  console.log(`\n⚔️  Running Sniping Attack Simulation...`);
  console.log(`   Waiting for anti-snipe window (last 30 seconds of round)...`);
  
  const auction = await getActiveAuction();
  if (!auction) {
    console.log('   ❌ No active auction found');
    return { roundExtended: false, extensionCount: 0 };
  }
  
  const now = new Date();
  const timeUntilEnd = auction.endTime.getTime() - now.getTime();
  
  // Wait until we're in the anti-snipe window (last 30 seconds)
  if (timeUntilEnd > 32000) {
    const waitTime = timeUntilEnd - 28000; // Enter window with ~28 seconds left
    console.log(`   ⏳ Waiting ${Math.round(waitTime / 1000)}s to enter anti-snipe window...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  // Get current leaderboard to outbid real leaders
  const leaderboard = await getLeaderboard(auctionId);
  const topBid = leaderboard.length > 0 ? leaderboard[0].amount : 0;
  
  console.log(`   📊 Current top bid: ${topBid}`);
  console.log(`   🎯 Launching sniping attack with 20 rapid bids to outbid leaders...`);
  
  // Burst of bids in anti-snipe window - each bot outbids the current top
  const snipeUserIds = userIds.slice(0, 20);
  let extensionCount = 0;
  let roundExtended = false;
  let currentTopBid = topBid;
  
  for (let i = 0; i < snipeUserIds.length; i++) {
    // Each sniper outbids by 100-500 more than current top
    const outbidAmount = Math.floor(Math.random() * 400) + 100;
    const amount = currentTopBid + outbidAmount;
    
    const result = await placeBid(auctionId, snipeUserIds[i], amount);
    
    if (result.success) {
      currentTopBid = amount; // Update for next sniper
      console.log(`   💰 Sniper ${i + 1} bid: ${amount} (outbid by ${outbidAmount})`);
    }
    
    if (result.roundExtended) {
      extensionCount++;
      roundExtended = true;
      console.log(`   🔄 Round extended! (extension #${extensionCount})`);
    }
    
    // Small delay between bids to simulate real attack
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`\n📊 Sniping Attack Results:`);
  console.log(`   Round Extended: ${roundExtended ? 'YES ✅' : 'NO'}`);
  console.log(`   Extension Count: ${extensionCount}`);
  console.log(`   Final top bid after sniping: ${currentTopBid}`);
  console.log(`   Anti-Sniping Protection: ${roundExtended ? 'WORKING ✅' : 'NOT TRIGGERED (round may have ended)'}`);
  
  return { roundExtended, extensionCount };
}

async function runLeaderboardConsistencyTest(auctionId: string): Promise<boolean> {
  console.log(`\n🔍 Running Leaderboard Consistency Test...`);
  
  try {
    const response = await fetch(`${API_BASE}/api/auctions/${auctionId}/leaderboard`);
    const data = await response.json() as { success: boolean; data?: { leaderboard: any[] }; error?: string };
    
    if (!data.success) {
      console.log(`   ❌ Failed to fetch leaderboard: ${data.error}`);
      return false;
    }
    
    const leaderboard = data.data?.leaderboard || [];
    console.log(`   📋 Leaderboard entries: ${leaderboard.length}`);
    
    // Verify leaderboard is sorted by amount (descending)
    let isSorted = true;
    for (let i = 1; i < leaderboard.length; i++) {
      if (leaderboard[i].amount > leaderboard[i - 1].amount) {
        isSorted = false;
        break;
      }
    }
    
    console.log(`   Sorting: ${isSorted ? 'CORRECT ✅' : 'INCORRECT ❌'}`);
    return isSorted;
  } catch (error) {
    console.log(`   ❌ Error: ${error}`);
    return false;
  }
}

async function runStressTest(
  auctionId: string,
  userIds: string[],
  bidCount: number
): Promise<TestResult> {
  console.log(`\n💪 Running Stress Test: ${bidCount} bids...`);
  
  const results: TestResult = {
    totalBids: bidCount,
    successfulBids: 0,
    failedBids: 0,
    duplicateBidErrors: 0,
    insufficientFundsErrors: 0,
    otherErrors: 0,
    roundExtended: false,
    avgResponseTime: 0,
    minResponseTime: Infinity,
    maxResponseTime: 0,
  };
  
  const responseTimes: number[] = [];
  const batchSize = 100; // Process in batches to avoid overwhelming
  const batches = Math.ceil(bidCount / batchSize);
  
  for (let batch = 0; batch < batches; batch++) {
    const start = batch * batchSize;
    const end = Math.min(start + batchSize, bidCount);
    const batchBids = end - start;
    
    console.log(`   📦 Batch ${batch + 1}/${batches}: ${batchBids} bids...`);
    
    const promises = [];
    for (let i = start; i < end; i++) {
      const userId = userIds[i % userIds.length];
      const amount = 100 + Math.floor(Math.random() * 5000);
      promises.push(placeBid(auctionId, userId, amount));
    }
    
    const batchResults = await Promise.all(promises);
    
    for (const result of batchResults) {
      responseTimes.push(result.responseTime);
      results.minResponseTime = Math.min(results.minResponseTime, result.responseTime);
      results.maxResponseTime = Math.max(results.maxResponseTime, result.responseTime);
      
      if (result.success) {
        results.successfulBids++;
      } else {
        results.failedBids++;
        if (result.error?.includes('Insufficient')) {
          results.insufficientFundsErrors++;
        } else if (result.error?.includes('duplicate') || result.error?.includes('increment')) {
          results.duplicateBidErrors++;
        } else {
          results.otherErrors++;
        }
      }
    }
    
    // Small delay between batches
    if (batch < batches - 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  results.avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
  
  console.log(`\n📊 Stress Test Results (${bidCount} bids):`);
  console.log(`   ✅ Successful: ${results.successfulBids}/${results.totalBids}`);
  console.log(`   ❌ Failed: ${results.failedBids}`);
  console.log(`   ⏱️  Avg Response: ${results.avgResponseTime.toFixed(2)}ms`);
  console.log(`   ⏱️  Min/Max: ${results.minResponseTime}ms / ${results.maxResponseTime}ms`);
  
  return results;
}

async function runMultiWaveSnipingTest(
  auctionId: string,
  userIds: string[]
): Promise<{ totalExtensions: number; wavesExecuted: number }> {
  console.log(`\n🌊 Running Multi-Wave Sniping Test...`);
  
  let totalExtensions = 0;
  let wavesExecuted = 0;
  const maxWaves = 5;
  
  for (let wave = 1; wave <= maxWaves; wave++) {
    const auction = await getActiveAuction();
    if (!auction) {
      console.log('   ❌ Auction ended');
      break;
    }
    
    const timeUntilEnd = auction.endTime.getTime() - Date.now();
    
    if (timeUntilEnd <= 0) {
      console.log('   ⏰ Round ended');
      break;
    }
    
    // Wait for anti-snipe window if needed
    if (timeUntilEnd > 32000) {
      const waitTime = timeUntilEnd - 28000;
      console.log(`   ⏳ Wave ${wave}: Waiting ${Math.round(waitTime / 1000)}s for anti-snipe window...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    // Get current top bid
    const leaderboard = await getLeaderboard(auctionId);
    const topBid = leaderboard.length > 0 ? leaderboard[0].amount : 0;
    
    console.log(`   🎯 Wave ${wave}: Launching 10 rapid snipe bids (top bid: ${topBid})...`);
    
    const waveUserIds = userIds.slice(wave * 10, wave * 10 + 10);
    let currentTop = topBid;
    let waveExtensions = 0;
    
    for (let i = 0; i < waveUserIds.length; i++) {
      const outbid = Math.floor(Math.random() * 300) + 100;
      const amount = currentTop + outbid;
      
      const result = await placeBid(auctionId, waveUserIds[i], amount);
      
      if (result.success) {
        currentTop = amount;
      }
      
      if (result.roundExtended) {
        waveExtensions++;
        totalExtensions++;
        console.log(`   🔄 Extension triggered! (total: ${totalExtensions})`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    wavesExecuted++;
    console.log(`   ✅ Wave ${wave} complete: ${waveExtensions} extensions`);
    
    // Brief pause between waves
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log(`\n📊 Multi-Wave Sniping Results:`);
  console.log(`   Waves Executed: ${wavesExecuted}`);
  console.log(`   Total Extensions: ${totalExtensions}`);
  console.log(`   Anti-Sniping: ${totalExtensions > 0 ? 'WORKING ✅' : 'NOT TRIGGERED ⚠️'}`);
  
  return { totalExtensions, wavesExecuted };
}

async function runLoadTest() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   🧪 DIGITAL GOODS AUCTION - STRESS TEST SUITE');
  console.log('═══════════════════════════════════════════════════════════');
  
  try {
    await connectDB();
    console.log('✅ Connected to MongoDB');
    
    const auction = await getActiveAuction();
    if (!auction) {
      console.log('❌ No active auction found. Run `npm run seed` first.');
      process.exit(1);
    }
    
    console.log(`\n📦 Active Auction: ${auction.id}`);
    console.log(`   Current Round: ${auction.currentRound}`);
    console.log(`   Round Ends: ${auction.endTime.toISOString()}`);
    
    // Create more test users for stress testing
    const testUserIds = await createTestUsers(500);
    
    // Test 1: Concurrent Bids (50 simultaneous)
    console.log('\n' + '─'.repeat(60));
    const concurrentResults = await runConcurrentBidsTest(auction.id, testUserIds.slice(0, 50), 50);
    
    // Test 2: Stress Test (1000 bids in batches)
    console.log('\n' + '─'.repeat(60));
    const stressResults = await runStressTest(auction.id, testUserIds.slice(50, 300), 1000);
    
    // Test 3: Leaderboard Consistency
    console.log('\n' + '─'.repeat(60));
    const leaderboardOk = await runLeaderboardConsistencyTest(auction.id);
    
    // Test 4: Multi-Wave Sniping Attack
    console.log('\n' + '─'.repeat(60));
    const timeUntilEnd = auction.endTime.getTime() - Date.now();
    let snipingResults = { totalExtensions: 0, wavesExecuted: 0 };
    let singleSnipeResults = { roundExtended: false, extensionCount: 0 };
    
    if (timeUntilEnd > 5000) {
      // Run single snipe test first
      singleSnipeResults = await runSnipingAttackTest(auction.id, testUserIds.slice(300, 350));
      
      // Then multi-wave test
      console.log('\n' + '─'.repeat(60));
      snipingResults = await runMultiWaveSnipingTest(auction.id, testUserIds.slice(350, 450));
    } else {
      console.log(`\n⚔️  Sniping Tests: SKIPPED (round ending soon)`);
    }
    
    // Final Summary
    console.log('\n' + '═'.repeat(60));
    console.log('   📊 STRESS TEST SUMMARY');
    console.log('═'.repeat(60));
    
    console.log(`\n   Concurrent Bids (50):`);
    console.log(`   ├─ Success Rate: ${((concurrentResults.successfulBids / concurrentResults.totalBids) * 100).toFixed(1)}%`);
    console.log(`   ├─ Avg Response: ${concurrentResults.avgResponseTime.toFixed(2)}ms`);
    console.log(`   └─ Status: ${concurrentResults.successfulBids > 0 ? 'PASSED ✅' : 'FAILED ❌'}`);
    
    console.log(`\n   Stress Test (1000 bids):`);
    console.log(`   ├─ Success Rate: ${((stressResults.successfulBids / stressResults.totalBids) * 100).toFixed(1)}%`);
    console.log(`   ├─ Avg Response: ${stressResults.avgResponseTime.toFixed(2)}ms`);
    console.log(`   └─ Status: ${stressResults.successfulBids > 500 ? 'PASSED ✅' : 'FAILED ❌'}`);
    
    console.log(`\n   Leaderboard Consistency:`);
    console.log(`   └─ Status: ${leaderboardOk ? 'PASSED ✅' : 'FAILED ❌'}`);
    
    console.log(`\n   Anti-Sniping Protection:`);
    console.log(`   ├─ Single Attack: ${singleSnipeResults.roundExtended ? 'VERIFIED ✅' : 'NOT TRIGGERED ⚠️'}`);
    console.log(`   └─ Multi-Wave: ${snipingResults.totalExtensions > 0 ? `${snipingResults.totalExtensions} extensions ✅` : 'NOT TESTED ⚠️'}`);
    
    const allPassed = concurrentResults.successfulBids > 0 && stressResults.successfulBids > 500 && leaderboardOk;
    console.log(`\n   ════════════════════════════════`);
    console.log(`   OVERALL: ${allPassed ? '✅ SYSTEM ROBUST' : '⚠️ ISSUES DETECTED'}`);
    console.log(`   ════════════════════════════════\n`);
    
  } catch (error) {
    console.error('\n❌ Load test failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
}

// Run the load test
runLoadTest();
