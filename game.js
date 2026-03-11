let socket;
let username = '';
let currentRoom = null;
let currentGame = null;

// Game state variables
let snakeGameRunning = false;
let snake = [];
let snakeDirection = { x: 1, y: 0 };
let nextSnakeDir = { x: 1, y: 0 };
let snakeScore = 0;
let snakeLoop = null;

const CANVAS_SIZE = 500;
const GRID_SIZE = 20;
const TILE_COUNT = CANVAS_SIZE / GRID_SIZE;
let food = { x: 10, y: 10 };
let snakeCanvas, snakeCtx;

function init() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('Connected');
    });
    
    socket.on('usernameTaken', () => {
        alert('Username is already taken! Please choose another.');
    });
    
    socket.on('roomCreated', (roomId) => {
        console.log('Room created:', roomId);
    });
    
    socket.on('roomExists', () => {
        alert('Room name already exists!');
    });
    
    socket.on('updateRooms', (rooms) => {
        displayRooms(rooms);
    });
    
    socket.on('updateRoom', (room) => {
        currentRoom = room;
        displayRoomPlayers(room);
        
        if (room.game && room.gameState) {
            showGame(room.game, room.gameState);
        }
    });
    
    socket.on('updatePlayerList', (players) => {
        // Update any player displays if needed
    });
    
    socket.on('updateLeaderboard', (leaderboard) => {
        displayLeaderboard(leaderboard);
    });
    
    socket.on('updateGameState', (gameState) => {
        if (currentGame === 'tictactoe') {
            updateTicTacToe(gameState);
        } else if (currentGame === 'blackjack') {
            updateBlackjack(gameState);
        }
    });
    
    socket.on('gameStarted', (gameState) => {
        if (currentGame === 'snake') {
            startSnakeGame();
        }
    });
    
    // Load leaderboard
    fetchScores();
}

function joinGame() {
    const input = document.getElementById('usernameInput');
    username = input.value.trim();
    
    if (!username) {
        alert('Please enter a username!');
        return;
    }
    
    socket.emit('join', username);
    
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('lobbyContainer').style.display = 'flex';
    document.getElementById('displayUsername').textContent = username;
    
    // Request rooms list
    fetchRooms();
}

async function fetchScores() {
    try {
        const res = await fetch('/api/scores');
        const scores = await res.json();
        displayLeaderboard(scores);
    } catch (e) {
        console.log('Error loading scores');
    }
}

async function fetchRooms() {
    try {
        const res = await fetch('/api/rooms');
        const rooms = await res.json();
        displayRooms(rooms);
    } catch (e) {
        console.log('Error loading rooms');
    }
}

function displayLeaderboard(scores) {
    const list = document.getElementById('leaderboardList');
    const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 10);
    
    list.innerHTML = entries.map(([name, score], i) => `
        <li class="${i < 3 ? 'top-' + (i+1) : ''}">
            <span>${i+1}. ${name}</span>
            <span>${score}</span>
        </li>
    `).join('') || '<li>No scores yet</li>';
    
    // Update total score
    const myScore = scores[username] || 0;
    document.getElementById('totalScore').textContent = myScore;
}

function displayRooms(rooms) {
    const grid = document.getElementById('roomsGrid');
    
    if (rooms.length === 0) {
        grid.innerHTML = '<p style="color:#888;text-align:center;grid-column:1/-1">No rooms available. Create one!</p>';
        return;
    }
    
    grid.innerHTML = rooms.map(room => `
        <div class="room-card" onclick="joinRoom('${room.id}')">
            <h4>${room.name}</h4>
            <p>${getGameIcon(room.game)} ${room.game}</p>
            <p>${room.players}/${room.maxPlayers} players</p>
        </div>
    `).join('');
}

function getGameIcon(game) {
    if (game === 'snake') return '🐍';
    if (game === 'tictactoe') return '⭕';
    if (game === 'blackjack') return '🃏';
    return '🎮';
}

function displayRoomPlayers(room) {
    const container = document.getElementById('roomPlayers');
    container.innerHTML = room.players.map(p => 
        `<span class="room-player">${p.username} ${p.isHost ? '👑' : ''}</span>`
    ).join('');
}

function createRoom() {
    const roomName = document.getElementById('roomNameInput').value.trim();
    const gameType = document.getElementById('gameTypeSelect').value;
    
    if (!roomName) {
        alert('Please enter a room name!');
        return;
    }
    
    socket.emit('createRoom', { roomName, gameType });
    document.getElementById('roomNameInput').value = '';
}

function quickJoin(gameType) {
    const roomName = `${gameType}-${Date.now()}`;
    socket.emit('createRoom', { roomName, gameType });
}

function joinRoom(roomId) {
    socket.emit('joinRoom', roomId);
    
    document.getElementById('lobbyContainer').style.display = 'none';
    document.getElementById('gameContainer').style.display = 'block';
}

function leaveRoom() {
    socket.emit('joinRoom', 'lobby');
    
    document.getElementById('gameContainer').style.display = 'none';
    document.getElementById('lobbyContainer').style.display = 'flex';
    document.getElementById('snakeGame').style.display = 'none';
    document.getElementById('tttGame').style.display = 'none';
    document.getElementById('blackjackGame').style.display = 'none';
    currentGame = null;
    
    stopSnake();
}

// ============ SNAKE GAME ============
function showSnake() {
    currentGame = 'snake';
    document.getElementById('snakeGame').style.display = 'block';
    document.getElementById('roomName').textContent = currentRoom.name;
    
    snakeCanvas = document.getElementById('snakeCanvas');
    snakeCtx = snakeCanvas.getContext('2d');
    
    document.addEventListener('keydown', handleSnakeInput);
}

function startSnake() {
    socket.emit('startGame');
}

function startSnakeGame() {
    showSnake();
    snake = [
        { x: Math.floor(TILE_COUNT/2), y: Math.floor(TILE_COUNT/2) },
        { x: Math.floor(TILE_COUNT/2)-1, y: Math.floor(TILE_COUNT/2) },
        { x: Math.floor(TILE_COUNT/2)-2, y: Math.floor(TILE_COUNT/2) }
    ];
    snakeDirection = { x: 1, y: 0 };
    nextSnakeDir = { x: 1, y: 0 };
    snakeScore = 0;
    document.getElementById('snakeScore').textContent = 0;
    spawnFood();
    snakeGameRunning = true;
    
    if (snakeLoop) clearInterval(snakeLoop);
    snakeLoop = setInterval(updateSnake, 100);
}

function handleSnakeInput(e) {
    if (!snakeGameRunning) return;
    
    const map = {
        'ArrowUp': { x: 0, y: -1 }, 'w': { x: 0, y: -1 }, 'W': { x: 0, y: -1 },
        'ArrowDown': { x: 0, y: 1 }, 's': { x: 0, y: 1 }, 'S': { x: 0, y: 1 },
        'ArrowLeft': { x: -1, y: 0 }, 'a': { x: -1, y: 0 }, 'A': { x: -1, y: 0 },
        'ArrowRight': { x: 1, y: 0 }, 'd': { x: 1, y: 0 }, 'D': { x: 1, y: 0 }
    };
    
    const dir = map[e.key];
    if (dir && ((dir.x && !snakeDirection.y) || (dir.y && !snakeDirection.x))) {
        nextSnakeDir = dir;
        e.preventDefault();
    }
}

function updateSnake() {
    snakeDirection = nextSnakeDir;
    const head = { x: snake[0].x + snakeDirection.x, y: snake[0].y + snakeDirection.y };
    
    if (head.x < 0 || head.x >= TILE_COUNT || head.y < 0 || head.y >= TILE_COUNT) {
        snakeGameOver();
        return;
    }
    
    for (let s of snake) {
        if (head.x === s.x && head.y === s.y) {
            snakeGameOver();
            return;
        }
    }
    
    snake.unshift(head);
    
    if (head.x === food.x && head.y === food.y) {
        snakeScore += 10;
        document.getElementById('snakeScore').textContent = snakeScore;
        socket.emit('updateScore', snakeScore);
        spawnFood();
    } else {
        snake.pop();
    }
    
    drawSnake();
}

function drawSnake() {
    snakeCtx.fillStyle = '#0a0a1a';
    snakeCtx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    
    // Grid
    snakeCtx.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < TILE_COUNT; i++) {
        snakeCtx.beginPath();
        snakeCtx.moveTo(i*GRID_SIZE, 0);
        snakeCtx.lineTo(i*GRID_SIZE, CANVAS_SIZE);
        snakeCtx.stroke();
        snakeCtx.beginPath();
        snakeCtx.moveTo(0, i*GRID_SIZE);
        snakeCtx.lineTo(CANVAS_SIZE, i*GRID_SIZE);
        snakeCtx.stroke();
    }
    
    // Food
    snakeCtx.fillStyle = '#ff6b6b';
    snakeCtx.shadowColor = '#ff6b6b';
    snakeCtx.shadowBlur = 15;
    snakeCtx.beginPath();
    snakeCtx.arc(food.x*GRID_SIZE+GRID_SIZE/2, food.y*GRID_SIZE+GRID_SIZE/2, GRID_SIZE/2-2, 0, Math.PI*2);
    snakeCtx.fill();
    snakeCtx.shadowBlur = 0;
    
    // Snake
    snake.forEach((seg, i) => {
        snakeCtx.fillStyle = i === 0 ? '#00ff88' : '#00cc6a';
        snakeCtx.beginPath();
        snakeCtx.roundRect(seg.x*GRID_SIZE+1, seg.y*GRID_SIZE+1, GRID_SIZE-2, GRID_SIZE-2, 4);
        snakeCtx.fill();
    });
}

function spawnFood() {
    food = {
        x: Math.floor(Math.random() * TILE_COUNT),
        y: Math.floor(Math.random() * TILE_COUNT)
    };
    for (let s of snake) {
        if (s.x === food.x && s.y === food.y) {
            spawnFood();
            return;
        }
    }
}

function snakeGameOver() {
    snakeGameRunning = false;
    clearInterval(snakeLoop);
    document.getElementById('gameOver').style.display = 'block';
    document.getElementById('finalScore').textContent = snakeScore;
}

function restartGame() {
    document.getElementById('gameOver').style.display = 'none';
    startSnake();
}

function stopSnake() {
    snakeGameRunning = false;
    if (snakeLoop) clearInterval(snakeLoop);
}

// ============ TIC-TAC-TOE ============
function showTicTacToe(gameState) {
    currentGame = 'tictactoe';
    document.getElementById('tttGame').style.display = 'block';
    document.getElementById('roomName').textContent = currentRoom.name;
    updateTicTacToe(gameState);
}

function startTicTacToe() {
    socket.emit('startGame');
}

function updateTicTacToe(gameState) {
    currentRoom.gameState = gameState;
    showTicTacToe(gameState);
    
    const board = gameState.board;
    const playerIndex = currentRoom.players.findIndex(p => p.id === socket.id);
    const isMyTurn = playerIndex === gameState.currentPlayer;
    
    let status = '';
    if (!board.includes(null)) {
        status = "It's a draw!";
    } else if (board[0] && (board[0]===board[1] && board[1]===board[2])) {
        status = `${board[0]} wins!`;
    } else if (board[3] && (board[3]===board[4] && board[4]===board[5])) {
        status = `${board[3]} wins!`;
    } else if (board[6] && (board[6]===board[7] && board[7]===board[8])) {
        status = `${board[6]} wins!`;
    } else if (board[0] && (board[0]===board[3] && board[3]===board[6])) {
        status = `${board[0]} wins!`;
    } else if (board[1] && (board[1]===board[4] && board[4]===board[7])) {
        status = `${board[1]} wins!`;
    } else if (board[2] && (board[2]===board[5] && board[5]===board[8])) {
        status = `${board[2]} wins!`;
    } else if (board[0] && (board[0]===board[4] && board[4]===board[8])) {
        status = `${board[0]} wins!`;
    } else if (board[2] && (board[2]===board[4] && board[4]===board[6])) {
        status = `${board[2]} wins!`;
    } else {
        status = isMyTurn ? 'Your turn!' : `Waiting for ${gameState.players[gameState.currentPlayer]}...`;
    }
    
    document.getElementById('tttStatus').textContent = status;
    
    const boardEl = document.getElementById('tttBoard');
    boardEl.innerHTML = board.map((cell, i) => `
        <div class="ttt-cell ${cell}" onclick="tttMove(${i})">${cell || ''}</div>
    `).join('');
    
    document.getElementById('tttStartBtn').style.display = currentRoom.players.length < 2 ? 'block' : 'none';
}

function tttMove(index) {
    if (!currentRoom.gameState || currentRoom.gameState.board[index]) return;
    const playerIndex = currentRoom.players.findIndex(p => p.id === socket.id);
    if (playerIndex !== currentRoom.gameState.currentPlayer) return;
    socket.emit('tttMove', index);
}

// ============ BLACKJACK ============
function showBlackjack(gameState) {
    currentGame = 'blackjack';
    document.getElementById('blackjackGame').style.display = 'block';
    document.getElementById('roomName').textContent = currentRoom.name;
    updateBlackjack(gameState);
}

function startBlackjack() {
    socket.emit('startGame');
}

function updateBlackjack(gameState) {
    currentRoom.gameState = gameState;
    showBlackjack(gameState);
    
    const myHand = gameState.hands[socket.id] || [];
    const dealerHand = gameState.dealerHand || [];
    
    document.getElementById('dealerHand').innerHTML = `
        <h4>Dealer ${gameState.dealerScore > 0 ? `(${gameState.dealerScore})` : ''}</h4>
        <div class="cards">${dealerHand.map(c => `<div class="card ${c.suit==='♥'||c.suit==='♦'?'red':''}">${c.value}${c.suit}</div>`).join('')}</div>
    `;
    
    const myScore = calculateBJScore(myHand);
    document.getElementById('playerHand').innerHTML = `
        <h4>Your Hand ${myScore > 0 ? `(${myScore})` : ''}</h4>
        <div class="cards">${myHand.map(c => `<div class="card ${c.suit==='♥'||c.suit==='♦'?'red':''}">${c.value}${c.suit}</div>`).join('')}</div>
    `;
    
    document.getElementById('bjChips').textContent = gameState.scores[socket.id] || 1000;
    
    const inGame = myHand.length > 0 && !gameState.gameOver;
    document.getElementById('dealBtn').style.display = inGame ? 'none' : 'inline-block';
    document.getElementById('hitBtn').disabled = !inGame;
    document.getElementById('standBtn').disabled = !inGame;
    
    if (gameState.gameOver) {
        document.getElementById('tttStatus').textContent = myScore > 21 ? 'Bust! You lose!' : 
            (gameState.dealerScore > 21 || myScore > gameState.dealerScore) ? 'You win!' : 
            (myScore === gameState.dealerScore) ? 'Push!' : 'Dealer wins!';
    }
    
    document.getElementById('bjStartBtn').style.display = currentRoom.players.length < 1 ? 'block' : 'none';
}

function bjAction(action) {
    socket.emit('bjAction', action);
}

function calculateBJScore(hand) {
    let score = 0, aces = 0;
    for (let c of hand) {
        if (['J','Q','K'].includes(c.value)) score += 10;
        else if (c.value === 'A') { aces++; score += 11; }
        else score += parseInt(c.value);
    }
    while (score > 21 && aces > 0) { score -= 10; aces--; }
    return score;
}

function showGame(game, gameState) {
    if (game === 'snake') showSnake();
    else if (game === 'tictactoe') showTicTacToe(gameState);
    else if (game === 'blackjack') showBlackjack(gameState);
}

window.onload = init;

