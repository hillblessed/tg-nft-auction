// Connect to WebSocket
const socket = io();

// State
let currentAuction = null;
let currentRoundEndTime = null;
let timerInterval = null;

// DOM Elements
const connectionStatus = document.getElementById('connection-status');
const auctionStatus = document.getElementById('auction-status');
const auctionInfo = document.getElementById('auction-info');
const timerSection = document.getElementById('timer-section');
const timerDisplay = document.getElementById('timer');
const userIdInput = document.getElementById('userId');
const amountInput = document.getElementById('amount');
const bidForm = document.getElementById('bid-form');
const bidResult = document.getElementById('bid-result');
const leaderboardDiv = document.getElementById('leaderboard');
const leaderboardRound = document.getElementById('leaderboard-round');
const eventsLog = document.getElementById('events-log');

// WebSocket connection handlers
socket.on('connect', () => {
  connectionStatus.textContent = 'Connected';
  connectionStatus.className = 'status connected';
  logEvent('Connected to server', 'success');
});

socket.on('disconnect', () => {
  connectionStatus.textContent = 'Disconnected';
  connectionStatus.className = 'status disconnected';
  logEvent('Disconnected from server', 'error');
});

// Real-time event handlers
socket.on('newBid', (data) => {
  logEvent(`New bid: ${data.amount} from ...${data.oderId.slice(-6)}`, 'bid');
  if (currentAuction && data.auctionId === currentAuction._id) {
    fetchLeaderboard();
  }
  fetchUsers(); // Always refresh user balances
});

socket.on('roundExtended', (data) => {
  logEvent(`Round extended to ${formatTime(new Date(data.newEndTime))}`, 'warning');
  if (currentAuction && data.auctionId === currentAuction._id) {
    currentRoundEndTime = new Date(data.newEndTime);
  }
});

socket.on('roundEnd', (data) => {
  const msg = data.nextRound 
    ? `Round ${data.roundNumber} ended! Winners: ${data.winnersCount}. Next: Round ${data.nextRound}` 
    : `Auction completed! Winners: ${data.winnersCount}`;
  logEvent(msg, 'success');
  
  // Force refresh after round ends
  setTimeout(() => {
    fetchAuction();
  }, 500);
});

// Fetch functions
async function fetchAuction() {
  try {
    const response = await fetch('/api/auctions');
    const data = await response.json();
    
    console.log('Auction API response:', data);
    
    if (data.success && data.data && data.data.length > 0) {
      currentAuction = data.data[0];
      renderAuctionDetails();
      startTimer();
      fetchLeaderboard();
    } else {
      auctionInfo.innerHTML = '<div class="empty-state">No active auctions. Run seed first.</div>';
      auctionStatus.textContent = '-';
    }
  } catch (error) {
    console.error('Error fetching auction:', error);
    auctionInfo.innerHTML = '<div class="empty-state">Failed to load auction</div>';
  }
}

async function fetchLeaderboard() {
  if (!currentAuction) {
    leaderboardDiv.innerHTML = '<div class="empty-state">No auction loaded</div>';
    return;
  }
  
  try {
    const response = await fetch(`/api/auctions/${currentAuction._id}/leaderboard?limit=50`);
    const data = await response.json();
    
    if (data.success) {
      renderLeaderboard(data.data.leaderboard, data.data.roundNumber);
    }
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    leaderboardDiv.innerHTML = '<div class="empty-state">Failed to load</div>';
  }
}

// Render functions
function renderAuctionDetails() {
  if (!currentAuction) return;
  
  const activeRound = currentAuction.rounds.find(r => r.status === 'active');
  currentRoundEndTime = activeRound ? new Date(activeRound.endTime) : null;
  
  auctionStatus.textContent = currentAuction.status.toUpperCase();
  auctionStatus.className = `badge ${currentAuction.status}`;
  
  auctionInfo.innerHTML = `
    <div class="info-row">
      <span class="info-label">Title</span>
      <span class="info-value">${currentAuction.title}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Round</span>
      <span class="info-value">${currentAuction.currentRound} / ${currentAuction.totalRounds}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Items/Round</span>
      <span class="info-value">${currentAuction.itemsPerRound}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Total Items</span>
      <span class="info-value">${currentAuction.totalItems}</span>
    </div>
  `;
  
  if (activeRound) {
    timerSection.style.display = 'block';
  } else {
    timerSection.style.display = 'block';
    timerDisplay.textContent = currentAuction.status === 'completed' ? 'DONE' : '--:--';
  }
}

function renderLeaderboard(leaderboard, roundNumber) {
  leaderboardRound.textContent = `Round ${roundNumber}`;
  
  if (!leaderboard || leaderboard.length === 0) {
    leaderboardDiv.innerHTML = '<div class="empty-state">No bids yet</div>';
    return;
  }
  
  const itemsPerRound = currentAuction ? currentAuction.itemsPerRound : 10;
  
  let html = '<table class="leaderboard-table"><thead><tr><th>#</th><th>User</th><th>Amount</th></tr></thead><tbody>';
  
  leaderboard.forEach((entry, index) => {
    const isWinning = index < itemsPerRound;
    html += `
      <tr class="${isWinning ? 'winning' : 'losing'}">
        <td>${entry.rank}</td>
        <td>...${entry.userId.slice(-6)}</td>
        <td>${entry.amount.toLocaleString()}</td>
      </tr>
    `;
  });
  
  html += '</tbody></table>';
  leaderboardDiv.innerHTML = html;
}

// Timer functions
function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(updateTimer, 1000);
  updateTimer();
}

let endingRefreshScheduled = false;

function updateTimer() {
  if (!currentRoundEndTime) {
    timerDisplay.textContent = '--:--';
    return;
  }
  
  const now = new Date();
  const diff = currentRoundEndTime - now;
  
  if (diff <= 0) {
    timerDisplay.textContent = 'Processing...';
    timerDisplay.classList.add('expired');
    
    // Auto-refresh when round ends
    if (!endingRefreshScheduled) {
      endingRefreshScheduled = true;
      setTimeout(() => {
        fetchAuction();
        endingRefreshScheduled = false;
      }, 3000);
    }
    return;
  }
  
  timerDisplay.classList.remove('expired');
  
  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  
  timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  
  if (diff <= 30000) {
    timerDisplay.classList.add('warning');
  } else {
    timerDisplay.classList.remove('warning');
  }
}

// Event logging
function logEvent(message, type = 'info') {
  const eventEl = document.createElement('div');
  eventEl.className = `event ${type}`;
  eventEl.innerHTML = `<span class="time">${formatTime(new Date())}</span><span class="msg">${message}</span>`;
  
  eventsLog.insertBefore(eventEl, eventsLog.firstChild);
  
  while (eventsLog.children.length > 15) {
    eventsLog.removeChild(eventsLog.lastChild);
  }
}

function formatTime(date) {
  return date.toLocaleTimeString('en-US', { hour12: false });
}

// Form handling
bidForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const userId = userIdInput.value.trim();
  const amount = parseInt(amountInput.value, 10);
  
  if (!userId) {
    showBidResult('Enter User ID', 'error');
    return;
  }
  
  if (!amount || amount <= 0) {
    showBidResult('Enter valid amount', 'error');
    return;
  }
  
  if (!currentAuction) {
    showBidResult('No active auction', 'error');
    return;
  }
  
  const bidButton = document.getElementById('bid-button');
  bidButton.disabled = true;
  bidButton.textContent = 'Placing...';
  
  try {
    const response = await fetch(`/api/auctions/${currentAuction._id}/bid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, amount }),
    });
    
    const data = await response.json();
    
    if (data.success) {
      const msg = data.data.roundExtended 
        ? `Bid placed! Round extended!` 
        : `Bid placed: ${data.data.amount}`;
      showBidResult(msg, 'success');
      amountInput.value = '';
      fetchLeaderboard();
    } else {
      showBidResult(data.error || 'Failed', 'error');
    }
  } catch (error) {
    console.error('Error placing bid:', error);
    showBidResult('Network error', 'error');
  } finally {
    bidButton.disabled = false;
    bidButton.textContent = 'Place Bid';
  }
});

function showBidResult(message, type) {
  bidResult.textContent = message;
  bidResult.className = type;
  
  setTimeout(() => {
    bidResult.textContent = '';
    bidResult.className = '';
  }, 4000);
}

// Create auction form
const createForm = document.getElementById('create-form');
const createResult = document.getElementById('create-result');

createForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const title = document.getElementById('auctionTitle').value.trim();
  const itemsPerRound = parseInt(document.getElementById('itemsPerRound').value, 10) || 10;
  const totalRounds = parseInt(document.getElementById('totalRounds').value, 10) || 5;
  
  if (!title) {
    showCreateResult('Enter title', 'error');
    return;
  }
  
  const createButton = document.getElementById('create-button');
  createButton.disabled = true;
  createButton.textContent = 'Creating...';
  
  try {
    const response = await fetch('/api/auctions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, itemsPerRound, totalRounds }),
    });
    
    const data = await response.json();
    
    if (data.success) {
      showCreateResult(`Created: ${data.data.title}`, 'success');
      document.getElementById('auctionTitle').value = '';
      logEvent(`Auction created: ${data.data.title}`, 'success');
      fetchAuction();
    } else {
      showCreateResult(data.error || 'Failed', 'error');
    }
  } catch (error) {
    console.error('Error creating auction:', error);
    showCreateResult('Network error', 'error');
  } finally {
    createButton.disabled = false;
    createButton.textContent = 'Create';
  }
});

function showCreateResult(message, type) {
  createResult.textContent = message;
  createResult.className = type;
  
  setTimeout(() => {
    createResult.textContent = '';
    createResult.className = '';
  }, 4000);
}

// Listen for new auctions
socket.on('auctionCreated', (data) => {
  logEvent(`New auction: ${data.title}`, 'success');
  fetchAuction();
});

// Users/Balance functionality
async function fetchUsers() {
  try {
    const response = await fetch('/api/users');
    const data = await response.json();
    
    if (data.success) {
      renderUsersList(data.data);
    }
  } catch (error) {
    console.error('Error fetching users:', error);
    document.getElementById('users-list').innerHTML = '<div class="empty-state">Failed to load users</div>';
  }
}

function renderUsersList(users) {
  const usersList = document.getElementById('users-list');
  
  if (!users || users.length === 0) {
    usersList.innerHTML = '<div class="empty-state">No users. Run seed first.</div>';
    return;
  }
  
  let html = '<div class="users-grid">';
  
  users.forEach((user, index) => {
    html += `
      <div class="user-item" onclick="selectUser('${user.userId}')">
        <div class="user-index">#${index + 1}</div>
        <div class="user-id">...${user.userId.slice(-6)}</div>
        <div class="user-balance">
          <span class="balance-available">${user.availableBalance.toLocaleString()}</span>
        </div>
      </div>
    `;
  });
  
  html += '</div>';
  usersList.innerHTML = html;
}

function selectUser(userId) {
  userIdInput.value = userId;
  userIdInput.focus();
  logEvent(`Selected user: ...${userId.slice(-6)}`, 'info');
}

// Refresh users button
document.getElementById('refresh-users')?.addEventListener('click', () => {
  fetchUsers();
  logEvent('Users refreshed', 'info');
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  fetchAuction();
  fetchUsers();
  logEvent('Ready', 'info');
});
