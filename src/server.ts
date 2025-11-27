// src/server.ts
import express, { Request, Response } from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import mongoose from 'mongoose';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';

// Typen importieren
import { IGame, ISession, ServerToClientEvents, ClientToServerEvents } from './types';
import { GameModel } from './models/Quiz';

// --- SETUP ---
const app = express();
const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server);
const PORT = 3000;

app.use(express.static('public'));
app.use(express.json());

// --- MONGODB ---
const DB_URI = 'mongodb://localhost:27017/jeopardyquiz';
mongoose.connect(DB_URI)
    .then(() => console.log('MongoDB verbunden'))
    .catch(err => console.error('MongoDB Fehler:', err));

// --- STATE MANAGEMENT ---
const sessions: Record<string, ISession> = {};

function generateRoomCode(): string {
    let code: string;
    do {
        code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (sessions[code]);
    return code;
}

interface SessionInfo {
    code: string;
    session: ISession;
    isHost?: boolean;
    isBoard?: boolean;
    isPlayer?: boolean;
    playerId?: string;
}

function getSessionBySocketId(socketId: string): SessionInfo | null {
    for (const [code, session] of Object.entries(sessions)) {
        if (session.hostSocketId === socketId) return { code, session, isHost: true };
        if (session.boardSocketId === socketId) return { code, session, isBoard: true };
        for (const pId in session.players) {
            if (session.players[pId].socketId === socketId) {
                return { code, session, playerId: pId, isPlayer: true };
            }
        }
    }
    return null;
}

async function deleteMediaFile(filePath: string) {
    if (!filePath || filePath.startsWith('http')) return;
    const absolutePath = path.join(__dirname, '../public', filePath); // Pfad anpassen wg. /src
    try {
        await fs.unlink(absolutePath);
        console.log(`Datei gelöscht: ${absolutePath}`);
    } catch (error: any) {
        if (error.code !== 'ENOENT') console.error(`Fehler beim Löschen:`, error);
    }
}

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number, isCustom: boolean): number {
    if (isCustom) {
        const dx = lat1 - lat2;
        const dy = lng1 - lng2;
        return Math.sqrt(dx * dx + dy * dy);
    }
    const R = 6371; 
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLng = (lng2 - lng1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// --- UPLOAD ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage: storage });

app.post('/api/upload', upload.single('mediaFile'), (req: Request, res: Response) => {
    if (req.file) {
        res.json({ success: true, filePath: '/uploads/' + req.file.filename });
    } else {
        res.status(400).json({ success: false, error: 'Keine Datei.' });
    }
});

// --- API ROUTES ---
app.get('/api/games', async (req, res) => {
    try {
        const games = await GameModel.find().select('_id title');
        res.json(games);
    } catch (err) {
        res.status(500).json({ error: 'Fehler beim Laden' });
    }
});

app.get('/api/games/:id', async (req, res) => {
    try {
        const game = await GameModel.findById(req.params.id);
        if (!game) return res.status(404).json({ error: 'Nicht gefunden' });
        res.json(game);
    } catch (err) {
        res.status(500).json({ error: 'Fehler' });
    }
});

app.post('/api/create-game', async (req, res) => {
    try {
        const gameData = req.body;
        let savedGame;
        if (gameData._id) {
            savedGame = await GameModel.findByIdAndUpdate(gameData._id, gameData, { new: true });
        } else {
            savedGame = await new GameModel(gameData).save();
        }
        return res.json({ success: true, gameId: savedGame?._id });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/games/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const game = await GameModel.findById(id);
        if (game) {
            const files: string[] = [];
            if (game.boardBackgroundPath) files.push(game.boardBackgroundPath);
            game.categories.forEach(c => c.questions.forEach(q => {
                if(q.mediaPath) files.push(q.mediaPath);
                if(q.answerMediaPath) files.push(q.answerMediaPath);
            }));
            await Promise.all(files.map(deleteMediaFile));
            await GameModel.findByIdAndDelete(id);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Fehler beim Löschen" });
    }
});

app.post('/api/delete-files', async (req, res) => {
    const files: string[] = req.body.files || [];
    await Promise.all(files.map(deleteMediaFile));
    res.json({ success: true });
});

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    console.log('Verbunden:', socket.id);

    socket.on('host_create_session', (gameId) => {
        const roomCode = generateRoomCode();
        sessions[roomCode] = {
            gameId,
            hostSocketId: socket.id,
            players: {},
            buzzersActive: false,
            currentBuzzWinnerId: null,
            activeQuestion: null,
            activeQuestionPoints: 0,
            mapGuesses: {}
        };
        socket.join(roomCode);
        socket.emit('session_created', roomCode);
    });
    
    // NEU: Host Start Game Handler, falls das Board-Update über Socket läuft
    socket.on('host_start_game', async (gameId) => {
        try {
            const game = await GameModel.findById(gameId);
            if(game) {
                // Sende das Spiel zurück an den Host zur Anzeige
                socket.emit('load_game_on_board', game); 
            }
        } catch(e) { console.error(e); }
    });

    socket.on('board_join_session', async (roomCode) => {
        const session = sessions[roomCode];
        if (session) {
            session.boardSocketId = socket.id;
            socket.join(roomCode);
            socket.emit('board_connected_success');
            
            const game = await GameModel.findById(session.gameId);
            if(game) socket.emit('board_init_game', game);
            
            io.to(session.boardSocketId!).emit('update_scores', session.players);
        } else {
            socket.emit('error_message', 'Raum nicht gefunden.');
        }
    });

    socket.on('player_join_session', (data) => {
        const { roomCode, name, existingPlayerId } = data;
        const session = sessions[roomCode];
        if (!session) {
            socket.emit('join_error', 'Raum existiert nicht.');
            return;
        }

        if (existingPlayerId && session.players[existingPlayerId]) {
            const p = session.players[existingPlayerId];
            p.socketId = socket.id;
            p.active = true;
            socket.join(roomCode);
            socket.emit('join_success', { playerId: existingPlayerId, roomCode, name: p.name });
        } else {
            const newPlayerId = 'p_' + Math.random().toString(36).substr(2, 9);
            session.players[newPlayerId] = {
                id: newPlayerId,
                name: name,
                score: 0,
                socketId: socket.id,
                color: '#' + Math.floor(Math.random()*16777215).toString(16),
                active: true
            };
            socket.join(roomCode);
            socket.emit('join_success', { playerId: newPlayerId, roomCode, name });
        }

        io.to(roomCode).emit('update_player_list', session.players);
        io.to(roomCode).emit('update_scores', session.players);
    });

    socket.on('player_buzz', (data) => {
        const info = getSessionBySocketId(socket.id);
        if (!info || !info.isPlayer) return;
        const { session, code, playerId } = info;

        if (session.buzzersActive && playerId) {
            session.buzzersActive = false;
            session.currentBuzzWinnerId = playerId;
            
            io.to(code).emit('buzzers_locked');
            io.to(code).emit('player_won_buzz', { id: playerId, name: session.players[playerId].name });
            io.to(session.hostSocketId).emit('update_host_controls', { buzzWinnerId: playerId, buzzWinnerName: session.players[playerId].name });
        }
    });

    socket.on('host_score_answer', (data) => {
        const info = getSessionBySocketId(socket.id);
        if (!info) return;
        const { session, code } = info;
        
        const player = session.players[data.playerId];
        if (player) {
            if (data.action === 'correct') {
                player.score += session.activeQuestionPoints;
                io.to(code).emit('board_reveal_answer');
                io.to(session.hostSocketId).emit('update_host_controls', { buzzWinnerId: null });
            } else {
                player.score -= session.activeQuestionPoints;
                session.buzzersActive = true;
                io.to(code).emit('buzzers_unlocked');
                io.to(session.hostSocketId).emit('update_host_controls', { buzzWinnerId: null });
            }
            io.to(code).emit('update_scores', session.players);
        }
    });

    socket.on('host_pick_question', (data) => {
        const info = getSessionBySocketId(socket.id);
        if (!info) return;
        const { session, code } = info;
        
        session.activeQuestion = data.question;
        session.activeQuestionPoints = data.question.points;
        session.mapGuesses = {};

        if (data.question.type === 'map') {
            session.buzzersActive = false;
            io.to(session.hostSocketId).emit('update_host_controls', { mapMode: true, submittedCount: 0 });
            io.to(code).emit('player_start_map_guess', {
                questionText: data.question.questionText,
                location: data.question.location,
                points: data.question.points
            });
        } else {
            session.buzzersActive = true;
            io.to(session.hostSocketId).emit('update_host_controls', { buzzWinnerId: null, mapMode: false });
            io.to(code).emit('player_new_question', { text: data.question.questionText, points: data.question.points });
            io.to(code).emit('buzzers_unlocked');
        }
        io.to(code).emit('board_show_question', data);
    });

    socket.on('player_submit_map_guess', (coords) => {
        const info = getSessionBySocketId(socket.id);
        if (!info || !info.isPlayer || !info.playerId) return;
        const { session } = info;
        
        session.mapGuesses[info.playerId] = coords;
        const count = Object.keys(session.mapGuesses).length;
        io.to(session.hostSocketId).emit('host_update_map_status', { 
            submittedCount: count, 
            totalPlayers: Object.keys(session.players).length 
        });
    });

    socket.on('host_resolve_map', () => {
        const info = getSessionBySocketId(socket.id);
        if (!info) return;
        const { session, code } = info;
        
        if(!session.activeQuestion?.location) return;
        
        const target = session.activeQuestion.location;
        const guesses = session.mapGuesses;
        let results: any = {};
        let bestDist = Infinity;

        for (const pid in guesses) {
            const g = guesses[pid];
            const dist = calculateDistance(target.lat, target.lng, g.lat, g.lng, target.isCustomMap);
            results[pid] = { lat: g.lat, lng: g.lng, distance: dist, isWinner: false };
            if (dist < bestDist) bestDist = dist;
        }

        for (const pid in results) {
            if (Math.abs(results[pid].distance - bestDist) < 0.001) {
                results[pid].isWinner = true;
                if(session.players[pid]) session.players[pid].score += session.activeQuestionPoints;
            }
        }

        io.to(code).emit('board_reveal_map_results', { results, players: session.players, target });
        io.to(code).emit('update_scores', session.players);
    });

    // Weitere einfache Handler
    socket.on('host_toggle_qr', () => {
        const info = getSessionBySocketId(socket.id);
        if(info) io.to(info.code).emit('board_toggle_qr');
    });

    socket.on('host_unlock_buzzers', () => {
        const info = getSessionBySocketId(socket.id);
        if(info) {
            info.session.buzzersActive = true;
            info.session.currentBuzzWinnerId = null;
            io.to(info.code).emit('buzzers_unlocked');
            io.to(info.session.hostSocketId).emit('update_host_controls', { buzzWinnerId: null });
        }
    });

    socket.on('host_close_question', () => {
        const info = getSessionBySocketId(socket.id);
        if(info) {
            info.session.buzzersActive = false;
            io.to(info.code).emit('board_hide_question');
            io.to(info.session.hostSocketId).emit('update_host_controls', { buzzWinnerId: null });
        }
    });

    socket.on('host_end_session', () => {
        const info = getSessionBySocketId(socket.id);
        if(info) {
            io.to(info.code).emit('session_ended');
            delete sessions[info.code];
        }
    });

    socket.on('disconnect', () => {
        const info = getSessionBySocketId(socket.id);
        if (info && info.isPlayer && info.playerId) {
            info.session.players[info.playerId].active = false;
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
});