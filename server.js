const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(path.join(__dirname)));
app.use(express.json());

// File to store scores
const SCORES_FILE = path.join(__dirname, 'scores.json');

// Load scores from file
function loadScores() {
    try {
        if (fs.existsSync(SCORES_FILE)) {
            return JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8'));
        }
    } catch (e) {
        console.log('No saved scores file');
    }
    return {};
}

// Save scores to file
function saveScores() {
    fs.writeFileSync(SCORES_FILE, JSON.stringify(scores, null, 2));
}

// Load initial scores
let scores = loadScores();

// Game rooms
let rooms = {};

// Track when room was last active
let roomLastActivity = {};

// Connected players (username -> socketId)
let connectedPlayers = {};

// Clean up empty rooms every 10 seconds
setInterval(() => {
    const now = Date.now();
    for (const roomId in rooms) {
        if (roomId === 'lobby') continue; // Don't delete main lobby
        
        const room = rooms[roomId];
        const lastActivity = roomLastActivity[roomId] || now;
        
        // Delete room if empty and inactive for 10 seconds
        if (room.players.length === 0 && (now - lastActivity > 10000)) {
            delete rooms[roomId];
            delete roomLastActivity[roomId];
            io.emit('updateRooms', getRoomsList());
            console.log(`Room ${roomId} deleted (empty)`);
        }
    }
}, 10000);

// Update room activity when player joins/leaves
function updateRoomActivity(roomId) {
    roomLastActivity[roomId] = Date.now();
}

// Socket.io connection
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    // Player joins with username
    socket.on('join', (username) => {
        // Check if username is already taken
        const existingSocket = Object.keys(connectedPlayers).find(
            key => connectedPlayers[key] === username
        );
        
        if (existingSocket) {
            socket.emit('usernameTaken');
            return;
        }
        
        // Store player connection
        connectedPlayers[socket.id] = username;
        
        // Create default room for this player
        const roomId = 'lobby';
        socket.join(roomId);
        
        if (!rooms[roomId]) {
            rooms[roomId] = {
                id: roomId,
                name: 'Main Lobby',
                game: null,
                players: [],
                maxPlayers: 50
            };
        }
        
        rooms[roomId].players.push({
            id: socket.id,
            username: username,
            score: scores[username] || 0
        });
        
        socket.roomId = roomId;
        socket.username = username;
        
        io.to(roomId).emit('updateRoom', rooms[roomId]);
        io.emit('updatePlayerList', getAllPlayers());
        
        console.log(`${username} joined`);
    });

    // Create or join a room
    socket.on('joinRoom', (roomId) => {
        const username = connectedPlayers[socket.id];
        if (!username) return;
        
        // Leave current room
        if (socket.roomId) {
            rooms[socket.roomId].players = rooms[socket.roomId].players.filter(p => p.id !== socket.id);
            socket.leave(socket.roomId);
            io.to(socket.roomId).emit('updateRoom', rooms[socket.roomId]);
        }
        
        // Join new room
        socket.roomId = roomId;
        socket.join(roomId);
        
        if (!rooms[roomId]) {
            rooms[roomId] = {
                id: roomId,
                name: roomId,
                game: null,
                players: [],
                maxPlayers: 10
            };
        }
        
        const existingPlayer = rooms[roomId].players.find(p => p.id === socket.id);
        if (!existingPlayer) {
            rooms[roomId].players.push({
                id: socket.id,
                username: username,
                score: scores[username] || 0
            });
        }
        
        io.to(roomId).emit('updateRoom', rooms[roomId]);
        console.log(`${username} joined room ${roomId}`);
    });

    // Create a new room with game type
    socket.on('createRoom', ({ roomName, gameType }) => {
        const username = connectedPlayers[socket.id];
        if (!username) return;
        
        const roomId = roomName.toLowerCase().replace(/\s+/g, '-');
        
        if (rooms[roomId]) {
            socket.emit('roomExists');
            return;
        }
        
        // Leave current room
        if (socket.roomId) {
            rooms[socket.roomId].players = rooms[socket.roomId].players.filter(p => p.id !== socket.id);
            socket.leave(socket.roomId);
            io.to(socket.roomId).emit('updateRoom', rooms[socket.roomId]);
        }
        
        rooms[roomId] = {
            id: roomId,
            name: roomName,
            game: gameType,
            players: [{
                id: socket.id,
                username: username,
                score: scores[username] || 0,
                isHost: true
            }],
            maxPlayers: gameType === 'tictactoe' ? 2 : gameType === 'blackjack' ? 6 : 10,
            gameState: null
        };
        
        socket.roomId = roomId;
        socket.join(roomId);
        
        io.emit('updateRooms', getRoomsList());
        io.to(roomId).emit('updateRoom', rooms[roomId]);
        socket.emit('roomCreated', roomId);
        
        console.log(`${username} created room ${roomId} for ${gameType}`);
    });

    // Start game
    socket.on('startGame', () => {
        const room = rooms[socket.roomId];
        if (!room || !room.players.find(p => p.id === socket.id)?.isHost) return;
        
        if (room.game === 'tictactoe') {
            room.gameState = {
                board: Array(9).fill(null),
                currentPlayer: 0,
                players: room.players.map(p => p.username)
            };
        } else if (room.game === 'blackjack') {
            room.gameState = {
                deck: createDeck(),
                hands: {},
                scores: {},
                dealerHand: [],
                dealerScore: 0,
                gameOver: false,
                phase: 'betting'
            };
            room.players.forEach(p => {
                room.gameState.hands[p.id] = [];
                room.gameState.scores[p.id] = 1000; // Starting chips
            });
        }
        
        io.to(socket.roomId).emit('gameStarted', room.gameState);
    });

    // Tic-Tac-Toe move
    socket.on('tttMove', (index) => {
        const room = rooms[socket.roomId];
        if (!room || room.game !== 'tictactoe' || !room.gameState) return;
        
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== room.gameState.currentPlayer) return;
        
        if (room.gameState.board[index]) return;
        
        room.gameState.board[index] = room.players[playerIndex].username;
        
        // Check winner
        const winner = checkTTTWinner(room.gameState.board);
        if (winner) {
            // Update scores
            const winnerName = winner === 'X' ? room.players[0].username : room.players[1].username;
            scores[winnerName] = (scores[winnerName] || 0) + 10;
            saveScores();
        } else if (!room.gameState.board.includes(null)) {
            // Draw - no points
        }
        
        room.gameState.currentPlayer = room.gameState.currentPlayer === 0 ? 1 : 0;
        io.to(socket.roomId).emit('updateGameState', room.gameState);
    });

    // Blackjack actions
    socket.on('bjAction', (action) => {
        const room = rooms[socket.roomId];
        if (!room || room.game !== 'blackjack' || !room.gameState) return;
        
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;
        
        const gs = room.gameState;
        
        if (action === 'deal') {
            // Deal cards to player
            gs.hands[socket.id] = [drawCard(gs.deck), drawCard(gs.deck)];
            io.to(socket.id).emit('updateGameState', gs);
        } else if (action === 'hit') {
            gs.hands[socket.id].push(drawCard(gs.deck));
            const handScore = calculateBJScore(gs.hands[socket.id]);
            if (handScore > 21) {
                gs.scores[socket.id] = 0; // Bust - lose all bets
            }
            io.to(socket.id).emit('updateGameState', gs);
        } else if (action === 'stand') {
            // Dealer plays
            while (gs.dealerScore < 17) {
                gs.dealerHand.push(drawCard(gs.deck));
                gs.dealerScore = calculateBJScore(gs.dealerHand);
            }
            
            const playerScore = calculateBJScore(gs.hands[socket.id]);
            const playerChips = gs.scores[socket.id];
            
            if (playerScore <= 21) {
                if (gs.dealerScore > 21 || playerScore > gs.dealerScore) {
                    gs.scores[socket.id] = playerChips + 20; // Win
                    scores[player.username] = (scores[player.username] || 0) + 10;
                } else if (playerScore === gs.dealerScore) {
                    gs.scores[socket.id] = playerChips + 10; // Push
                }
            }
            saveScores();
            gs.gameOver = true;
            io.to(socket.roomId).emit('updateGameState', gs);
        }
    });

    // Update score
    socket.on('updateScore', (score) => {
        const username = connectedPlayers[socket.id];
        if (!username) return;
        
        if (!scores[username] || score > scores[username]) {
            scores[username] = score;
            saveScores();
        }
        
        // Update player in room
        if (socket.roomId && rooms[socket.roomId]) {
            const player = rooms[socket.roomId].players.find(p => p.id === socket.id);
            if (player) {
                player.score = score;
                io.to(socket.roomId).emit('updateRoom', rooms[socket.roomId]);
            }
        }
        
        io.emit('updateLeaderboard', getLeaderboard());
    });

    // Player disconnect
    socket.on('disconnect', () => {
        const username = connectedPlayers[socket.id];
        delete connectedPlayers[socket.id];
        
        if (socket.roomId && rooms[socket.roomId]) {
            rooms[socket.roomId].players = rooms[socket.roomId].players.filter(p => p.id !== socket.id);
            
            if (rooms[socket.roomId].players.length === 0) {
                if (socket.roomId !== 'lobby') {
                    delete rooms[socket.roomId];
                    io.emit('updateRooms', getRoomsList());
                }
            } else {
                io.to(socket.roomId).emit('updateRoom', rooms[socket.roomId]);
            }
        }
        
        io.emit('updatePlayerList', getAllPlayers());
        console.log(`${username || 'Player'} left`);
    });
});

// Helper functions
function getAllPlayers() {
    return Object.entries(connectedPlayers).map(([id, username]) => ({
        id,
        username,
        score: scores[username] || 0
    }));
}

function getRoomsList() {
    return Object.values(rooms).map(r => ({
        id: r.id,
        name: r.name,
        game: r.game,
        players: r.players.length,
        maxPlayers: r.maxPlayers
    }));
}

function getLeaderboard() {
    const sorted = Object.entries(scores)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
    
    const lb = {};
    sorted.forEach(([name, score]) => {
        lb[name] = score;
    });
    return lb;
}

function checkTTTWinner(board) {
    const lines = [
        [0,1,2], [3,4,5], [6,7,8], // rows
        [0,3,6], [1,4,7], [2,5,8], // cols
        [0,4,8], [2,4,6] // diagonals
    ];
    
    for (let [a,b,c] of lines) {
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a] === board[0] ? 'X' : 'O';
        }
    }
    return null;
}

function createDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
    const values = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
    let deck = [];
    for (let suit of suits) {
        for (let value of values) {
            deck.push({ suit, value });
        }
    }
    return deck.sort(() => Math.random() - 0.5);
}

function drawCard(deck) {
    return deck.pop();
}

function calculateBJScore(hand) {
    let score = 0;
    let aces = 0;
    
    for (let card of hand) {
        if (['J','Q','K'].includes(card.value)) {
            score += 10;
        } else if (card.value === 'A') {
            aces++;
            score += 11;
        } else {
            score += parseInt(card.value);
        }
    }
    
    while (score > 21 && aces > 0) {
        score -= 10;
        aces--;
    }
    
    return score;
}

// API endpoints
app.get('/api/scores', (req, res) => {
    res.json(scores);
});

app.get('/api/rooms', (req, res) => {
    res.json(getRoomsList());
});

app.post('/api/scores', (req, res) => {
    const { username, score } = req.body;
    if (username && typeof score === 'number') {
        scores[username] = score;
        saveScores();
        io.emit('updateLeaderboard', getLeaderboard());
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'Invalid data' });
    }
});

app.delete('/api/scores/:username', (req, res) => {
    const username = req.params.username;
    delete scores[username];
    saveScores();
    io.emit('updateLeaderboard', getLeaderboard());
    res.json({ success: true });
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

