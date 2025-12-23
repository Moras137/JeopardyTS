// src/server.ts
import express, { Request, Response } from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import mongoose from 'mongoose';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

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

const syncSessionState = (session: ISession, socketId: string, role: 'host' | 'board' | 'player') => {
        // Wenn keine Frage aktiv ist, gibt es nichts Spezielles zu tun (außer Scores, die eh gesendet werden)
        if (!session.activeQuestion) return;

    const q = session.activeQuestion;
    
    // A) BOARD SYNC
    if (role === 'board') {
        // Dem Board sagen, dass es die Frage anzeigen soll
        io.to(socketId).emit('board_show_question', {
            question: q,
            // Wir nutzen gespeicherte Indizes oder -1, falls wir sie nicht haben (siehe host_pick_question)
            catIndex: (session as any).activeCatIndex ?? -1,
            qIndex: (session as any).activeQIndex ?? -1
        });
        
        // Falls Maps-Auflösung schon passiert ist:
        if ((session as any).mapResolved) {
                // Hier müsste man theoretisch auch das Ergebnis nochmal senden, 
                // aber für den Anfang reicht es, die Frage wieder anzuzeigen.
        }
    }

    // B) PLAYER SYNC
    if (role === 'player') {
        if (q.type === 'map') {
            io.to(socketId).emit('player_start_map_guess', {
                questionText: q.questionText,
                location: q.location,
                points: q.points
            });
        } else {
                io.to(socketId).emit('player_new_question', { 
                    text: q.questionText, 
                    points: q.points 
                });
                // Buzzer Status prüfen
                if (session.buzzersActive) io.to(socketId).emit('buzzers_unlocked');
                else io.to(socketId).emit('buzzers_locked');
        }
    }

    // C) HOST SYNC
    if (role === 'host') {
        // Spezielles Event für den Host, um die UI wiederherzustellen
        io.to(socketId).emit('host_restore_active_question', {
            question: q,
            catIndex: (session as any).activeCatIndex,
            qIndex: (session as any).activeQIndex,
            buzzersActive: session.buzzersActive,
            mapGuessesCount: Object.keys(session.mapGuesses || {}).length
        });
    }
};

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

function getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] || []) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
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
    const R = 6371000; 
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLng = (lng2 - lng1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function isPointInPolygon(point: {lat: number, lng: number}, vs: {lat: number, lng: number}[]) {
    const x = point.lat, y = point.lng;
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const xi = vs[i].lat, yi = vs[i].lng;
        const xj = vs[j].lat, yj = vs[j].lng;

        const intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

async function cleanupUnusedFiles() {
    try {
        console.log("Starte Cleanup unbenutzter Dateien...");
        // 1. Alle Spiele aus der DB holen
        const allGames = await GameModel.find();

        // 2. Set mit allen Dateinamen erstellen, die noch gebraucht werden
        // Wir speichern nur den Dateinamen (z.B. "17234.png"), da der Pfad variieren kann
        const usedFiles = new Set<string>();

        allGames.forEach(game => {
            if (game.boardBackgroundPath) usedFiles.add(path.basename(game.boardBackgroundPath));
            if (game.backgroundMusicPath) usedFiles.add(path.basename(game.backgroundMusicPath));
            
            if (game.soundCorrectPath) usedFiles.add(path.basename(game.soundCorrectPath));
            if (game.soundIncorrectPath) usedFiles.add(path.basename(game.soundIncorrectPath));

            game.categories.forEach(cat => {
                cat.questions.forEach(q => {
                    if (q.mediaPath) usedFiles.add(path.basename(q.mediaPath));
                    if (q.answerMediaPath) usedFiles.add(path.basename(q.answerMediaPath));
                    // Falls Custom Maps genutzt werden:
                    if (q.location && q.location.customMapPath) usedFiles.add(path.basename(q.location.customMapPath));
                });
            });
        });
 
        // 3. Inhalt des Upload-Ordners lesen

        const uploadDir = path.join(__dirname, '../public/uploads');

        // Prüfen ob Ordner existiert
        try {
            await fs.access(uploadDir);
        } catch {
            return; // Ordner gibt es nicht, also nichts zu tun
        }

        const filesOnDisk = await fs.readdir(uploadDir);

        // 4. Vergleichen und löschen
        let deletedCount = 0;
        for (const file of filesOnDisk) {
            // .gitkeep oder ähnliches nicht löschen
            if (file.startsWith('.')) continue;

            // Wenn die Datei NICHT im Set der benutzten Dateien ist -> Weg damit
            if (!usedFiles.has(file)) {
                await fs.unlink(path.join(uploadDir, file));
                deletedCount++;
            }
        }
        if (deletedCount > 0) {
            console.log(`Cleanup fertig: ${deletedCount} verwaiste Dateien gelöscht.`);
        }
    } catch (err) {
        console.error("Fehler beim Cleanup:", err);
    }
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
        const games = await GameModel.find().select('_id title boardBackgroundPath');
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

        cleanupUnusedFiles();

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
                if (game.soundCorrectPath) files.push(game.soundCorrectPath);
                if (game.soundIncorrectPath) files.push(game.soundIncorrectPath);
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

    socket.on('host_create_session', async (gameId) => {

        const gameData = await GameModel.findById(gameId); // oder deine Lade-Logik
        
        if (!gameData) {
            alert("Spiel nicht gefunden.");
            return;
        }

        const roomCode = generateRoomCode();
        sessions[roomCode] = {
            gameId,
            game: gameData,
            hostSocketId: socket.id,
            players: {},
            buzzersActive: false,
            currentBuzzWinnerId: null,
            activeQuestion: null,
            activeQuestionPoints: 0,
            mapGuesses: {},
            estimateGuesses: {},
            listRevealedCount: -1, 
            usedQuestions: [],
            introIndex: -2,
            freetextAnswers: {},
            freetextGrading: {},
            lockedPlayers: []
        };
        socket.join(roomCode);
        socket.emit('session_created', roomCode);
    });

    socket.on('host_rejoin_session', (roomCode) => {
        const session = sessions[roomCode];
        if (!session) {
            socket.emit('host_rejoin_error');
            return;
        }

        // Host Socket ID aktualisieren
        session.hostSocketId = socket.id;
        socket.join(roomCode);

        // Daten für den Restore vorbereiten
        let submittedCount = 0;
        let listRevealedCount = 0;

        if (session.activeQuestion) {
            const qType = session.activeQuestion.type;

            // Zähler berechnen je nach Typ
            if (qType === 'map') {
                submittedCount = Object.keys(session.mapGuesses || {}).length;
            } else if (qType === 'estimate') {
                submittedCount = Object.keys(session.estimateGuesses || {}).length;
            } else if (qType === 'freetext') {
                submittedCount = Object.keys(session.freetextAnswers || {}).length;
            } else if (qType === 'list') {
                listRevealedCount = session.listRevealedCount || 0;
            }
        }

        // Event senden
        socket.emit('host_session_restored', {
            gameId: session.gameId,
            catIndex: (session as any).activeCatIndex, // Cast falls Index nicht im Interface definiert war
            qIndex: (session as any).activeQuestionIndex,
            question: session.activeQuestion!,
            players: session.players,
            buzzersActive: session.buzzersActive,
            buzzWinnerId: session.currentBuzzWinnerId,
            
            // Die neuen Felder:
            submittedCount: submittedCount,
            listRevealedCount: listRevealedCount
        });
        
        // Punktestand-Update sicherheitshalber hinterher
        socket.emit('update_scores', session.players);
    });
    
    // NEU: Host Start Game Handler, falls das Board-Update über Socket läuft
    socket.on('host_start_game', async (gameId) => {
        try {
            const game = await GameModel.findById(gameId);
            if(game) {
                // Sende das Spiel zurück an den Host zur Anzeige
                socket.emit('load_game_on_host', game ) ; 
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

            socket.emit('load_game_on_board', { 
                 game: session.game,
                 usedQuestions: session.usedQuestions || [] 
             });

            io.to(session.boardSocketId!).emit('update_scores', session.players);
            syncSessionState(session, socket.id, 'board');
            const localIp = getLocalIpAddress();
            socket.emit('server_network_info', { ip: localIp, port: 5173 });
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

        if (session) {
            syncSessionState(session, socket.id, 'player');
        }
    });

    socket.on('player_buzz', (data) => {
        const info = getSessionBySocketId(socket.id);
        if (!info || !info.isPlayer) return;
        const { session, code, playerId } = info;

        if (session.buzzersActive && playerId) {
            session.buzzersActive = false;
            session.currentBuzzWinnerId = playerId;
            
            if (!session.lockedPlayers.includes(playerId)) {
                session.lockedPlayers.push(playerId);
            }

            io.to(code).emit('buzzers_locked');
            io.to(code).emit('player_won_buzz', { id: playerId, name: session.players[playerId].name });
            io.to(session.hostSocketId).emit('update_host_controls', { buzzWinnerId: playerId, buzzWinnerName: session.players[playerId].name });

            if (session.activeQuestion?.type === 'pixel') {
                io.to(code).emit('board_control_pixel_puzzle', 'pause');
            }
        }
    });

    socket.on('host_score_answer', (data) => {
        const info = getSessionBySocketId(socket.id);
        if (!info) return;
        const { session, code } = info;
        
        const player = session.players[data.playerId];
        if (player) {
            const points = session.activeQuestionPoints;
            const newAction = data.action;
            
            if (!session.freetextGrading) session.freetextGrading = {};
            const previousStatus = session.freetextGrading[data.playerId];

            if (previousStatus === 'correct') {
                player.score -= points; 
            } 

            if (previousStatus === newAction) {
                delete session.freetextGrading[data.playerId];
                
                io.to(code).emit('board_freetext_update_state', { playerId: data.playerId, status: 'none' });
            } 
            else {
                session.freetextGrading[data.playerId] = newAction;

                if (newAction === 'correct') {
                    player.score += points;
                    io.to(code).emit('board_freetext_update_state', { playerId: data.playerId, status: 'correct' });
                    io.to(code).emit('board_play_sfx', 'correct');
                    if (session.activeQuestion?.type !== 'freetext') {
                        io.to(code).emit('board_reveal_answer');
                    }
                } else {
                    io.to(code).emit('board_freetext_update_state', { playerId: data.playerId, status: 'incorrect' });
                    io.to(code).emit('board_play_sfx', 'incorrect');
                }
            }

            // Scores und Host-Buttons aktualisieren
            io.to(code).emit('update_scores', session.players);
            io.to(session.hostSocketId).emit('host_update_freetext_buttons', { 
                playerId: data.playerId, 
                status: session.freetextGrading[data.playerId] 
            });
        }
    });

    socket.on('host_resolve_question', () => {
        const info = getSessionBySocketId(socket.id);
        if (info) {
             io.to(info.code).emit('board_reveal_answer');
        }
    });

    socket.on('host_pick_question', (data) => {
        const info = getSessionBySocketId(socket.id);
        if (!info) return;
        const { session, code } = info;
        
        session.activeQuestion = data.question;
        session.activeQuestionPoints = data.question.points;
        session.mapGuesses = {};
        session.lockedPlayers = [];
        session.freetextGrading = {};
        
        (session as any).activeCatIndex = data.catIndex;
        (session as any).activeQIndex = data.qIndex;
        (session as any).mapResolved = false;
        
        session.listRevealedCount = -1;

        if (!info.session.usedQuestions) {
            info.session.usedQuestions = [];
        }
        
        const alreadyUsed = info.session.usedQuestions.some(
            u => u.catIndex === data.catIndex && u.qIndex === data.qIndex
        );

        if (!alreadyUsed) {
            info.session.usedQuestions.push({ 
                catIndex: data.catIndex, 
                qIndex: data.qIndex 
            });
        }

        if (data.question.type === 'map') {
            session.buzzersActive = false;
            io.to(session.hostSocketId).emit('update_host_controls', { mapMode: true, submittedCount: 0 });
            io.to(code).emit('player_start_map_guess', {
                questionText: data.question.questionText,
                location: data.question.location,
                points: data.question.points
            });
        
        } else if (data.question.type === 'list') {
            // NEU: Liste
            session.buzzersActive = true; // Bei Listen darf man meist sofort buzzern
            io.to(session.hostSocketId).emit('update_host_controls', { 
                buzzWinnerId: null, 
                mapMode: false,
                listMode: true,           // Flag für Host UI
                listRevealedCount: -1 
            });
            // Spieler bekommen nur "Neue Frage" (Text)
            io.to(code).emit('player_new_question', { text: data.question.questionText, points: data.question.points });
            io.to(code).emit('buzzers_unlocked');
        } else if (data.question.type === 'estimate') {
            // NEU: Schätzfrage Initialisierung
            session.buzzersActive = false;
            session.estimateGuesses = {}; // Reset
            
            io.to(session.hostSocketId).emit('update_host_controls', { 
                buzzWinnerId: null, 
                mapMode: false, 
                listMode: false,
                estimateMode: true, // Flag für Host UI
                submittedCount: 0
            });

            // Spieler erhalten Eingabemaske
            io.to(code).emit('player_start_estimate', { 
                text: data.question.questionText, 
                points: data.question.points 
            });
        } else if (data.question.type === 'freetext') {
            session.buzzersActive = false;
            session.freetextAnswers = {}; // Reset
            
            // Host UI Update
            io.to(session.hostSocketId).emit('update_host_controls', { 
                buzzWinnerId: null, 
                mapMode: false, 
                listMode: false,
                estimateMode: false,
                freetextMode: true, // Flag für Host UI (dass er "Antworten zeigen" Button sieht)
                submittedCount: 0
            });

            // Spieler erhalten Eingabefeld
            io.to(code).emit('player_start_freetext', { 
                text: data.question.questionText, 
                points: data.question.points 
            });
        } 
        else {
            session.buzzersActive = true;
            io.to(session.hostSocketId).emit('update_host_controls', { buzzWinnerId: null, mapMode: false });
            io.to(code).emit('player_new_question', { text: data.question.questionText, points: data.question.points });
            io.to(code).emit('buzzers_unlocked');
        }
        io.to(code).emit('board_show_question', { ...data, currentListIndex: session.listRevealedCount });
    });

    socket.on('host_reveal_next_list_item', () => {
        const info = getSessionBySocketId(socket.id);
        if (!info || !info.isHost) return;
        const { session, code } = info;

        // Prüfen, ob wir gerade wirklich eine Listen-Frage spielen
        if (session.activeQuestion?.type === 'list') {
            session.listRevealedCount++;
            
            // 1. Befehl an das Board: "Zeige Item X"
            io.to(code).emit('board_reveal_list_item', session.listRevealedCount);
            
            // 2. Bestätigung an Host: "Wir sind bei Item X" (damit der Button Status updatet)
            socket.emit('update_host_controls', { listRevealedCount: session.listRevealedCount });
        }
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
        const radius = target.radius || 0;
        let anyWinnerFound = false;
        let results: any = {};
        let bestDist = Infinity;

        for (const pid in guesses) {
            const g = guesses[pid];
            const dist = calculateDistance(target.lat, target.lng, g.lat, g.lng, target.isCustomMap);
            results[pid] = { lat: g.lat, lng: g.lng, distance: dist, isWinner: false };
            if (dist < bestDist) bestDist = dist;
        }

        for (const pid in results) {
            
            const playerRes = results[pid];

            if (target.zone && target.zone.length > 2) {
                // Prüfen ob Punkt im Polygon liegt
                if (isPointInPolygon({lat: playerRes.lat, lng: playerRes.lng}, target.zone)) {
                    playerRes.isWinner = true;
                    anyWinnerFound = true;
                    if(session.players[pid]) session.players[pid].score += session.activeQuestionPoints;
                }
            } else if (radius > 0) {
                if (playerRes.distance <= radius) {
                    playerRes.isWinner = true;
                    anyWinnerFound = true;
                    if(session.players[pid]) session.players[pid].score += session.activeQuestionPoints;
                }
            } 

            else {
                if (Math.abs(playerRes.distance - bestDist) < 0.001) {
                    playerRes.isWinner = true;
                    if(session.players[pid]) session.players[pid].score += session.activeQuestionPoints;
                }
            }
        }

        io.to(code).emit('board_reveal_map_results', { results, players: session.players, target });
        io.to(code).emit('update_scores', session.players);
    });

    socket.on('player_submit_freetext', (text) => {
        const info = getSessionBySocketId(socket.id);
        if (!info || !info.isPlayer || !info.playerId) return;
        const { session } = info;

        // Speichern
        if (!session.freetextAnswers) session.freetextAnswers = {};
        session.freetextAnswers[info.playerId] = text;

        // Host updaten (Anzahl eingegangen)
        const count = Object.keys(session.freetextAnswers).length;
        const total = Object.keys(session.players).length;
        
        // Wir nutzen einfach das existierende Event für Estimates oder Maps auch hier
        // oder ein generisches update
        io.to(session.hostSocketId).emit('host_update_estimate_status', { submittedCount: count, totalPlayers: total });
    });

    socket.on('host_resolve_freetext', () => {
        const info = getSessionBySocketId(socket.id);
        if (!info || !info.isHost) return;
        const { session, code } = info;

        // Daten für Board aufbereiten
        const answers = [];
        for (const pid in session.freetextAnswers) {
            const player = session.players[pid];
            if (player) {
                answers.push({
                    playerId: pid,
                    name: player.name,
                    text: session.freetextAnswers[pid],
                    status: session.freetextGrading ? session.freetextGrading[pid] : undefined
                });
            }
        }

        // An Board senden
        io.to(code).emit('board_show_freetext_results', { answers });
    });

    // Weitere einfache Handler
    socket.on('host_toggle_qr', () => {
        const info = getSessionBySocketId(socket.id);
        if(info) io.to(info.code).emit('board_toggle_qr');
    });

    socket.on('host_control_pixel_puzzle', (action) => {
        const info = getSessionBySocketId(socket.id);
        if (info) {
            io.to(info.code).emit('board_control_pixel_puzzle', action);
        }
    });

    socket.on('host_unlock_buzzers', () => {
        const info = getSessionBySocketId(socket.id);
        if(info) {
            info.session.buzzersActive = true;
            info.session.currentBuzzWinnerId = null;
            io.to(info.code).emit('buzzers_unlocked', info.session.lockedPlayers);
            io.to(info.session.hostSocketId).emit('update_host_controls', { buzzWinnerId: null });
        }
    });

    socket.on('music_control', (data) => {
        const info = getSessionBySocketId(socket.id);
        
        if (info) {
            io.to(info.code).emit('music_control', data);
        }
    });

    socket.on('host_close_question', () => {
        const info = getSessionBySocketId(socket.id);
        if(info) {
            info.session.buzzersActive = false;
            
            info.session.activeQuestion = null;
            (info.session as any).activeCatIndex = -1;
            (info.session as any).activeQIndex = -1;

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
            io.to(info.code).emit('update_player_list', info.session.players);
        }
    });

    socket.on('host_next_intro', () => {
        const info = getSessionBySocketId(socket.id);
        if (!info || !info.isHost) return;
        const { session, code } = info;

        // Status weiterschalten
        session.introIndex++;

        // 1. Titel anzeigen (Index -1)
        if (session.introIndex === -1) {
            io.to(code).emit('board_show_intro', { 
                text: session.game.title, 
                subtext: "Willkommen zum Quiz!",
                type: 'title' 
            });
            // Host Button Update
            socket.emit('update_host_controls', { nextIntroStep: `Kategorie 1: ${session.game.categories[0]?.name || 'Ende'}` });
        }
        // 2. Kategorien anzeigen (Index 0 bis n)
        else if (session.introIndex >= 0 && session.introIndex < session.game.categories.length) {
            const cat = session.game.categories[session.introIndex];
            io.to(code).emit('board_show_intro', { 
                text: cat.name, 
                subtext: `Kategorie ${session.introIndex + 1}`,
                type: 'category' 
            });
            
            // Vorschau für den Host Button für den NÄCHSTEN Klick
            const nextCat = session.game.categories[session.introIndex + 1];
            const nextLabel = nextCat ? `Kategorie ${session.introIndex + 2}: ${nextCat.name}` : "Zum Spielbrett";
            socket.emit('update_host_controls', { nextIntroStep: nextLabel });
        }
        // 3. Intro Ende -> Grid zeigen
        else {
            io.to(code).emit('board_show_intro', { text: '', type: 'end' }); // Overlay weg
            // Reset intro index damit man es nicht aus Versehen nochmal startet, oder Logik anpassen
            socket.emit('update_host_controls', { nextIntroStep: null }); // Button ausblenden
        }
    });
    socket.on('player_submit_estimate', (val) => {
        const info = getSessionBySocketId(socket.id);
        if (!info || !info.isPlayer || !info.playerId) return;
        const { session } = info;

        // Speichern
        session.estimateGuesses[info.playerId] = val;

        // Host updaten
        const count = Object.keys(session.estimateGuesses).length;
        const total = Object.keys(session.players).length;
        io.to(session.hostSocketId).emit('host_update_estimate_status', { submittedCount: count, totalPlayers: total });
    });

    socket.on('host_resolve_estimate', () => {
        const info = getSessionBySocketId(socket.id);
        if (!info || !info.isHost) return;
        const { session, code } = info;

        const correctAnswer = session.activeQuestion?.estimationAnswer;
        if (correctAnswer === undefined || correctAnswer === null) return;

        // Berechnen
        const results = [];
        let minDiff = Infinity;

        for (const pid in session.estimateGuesses) {
            const guess = session.estimateGuesses[pid];
            const diff = Math.abs(guess - correctAnswer);
            const player = session.players[pid];
            
            if (diff < minDiff) minDiff = diff;

            results.push({
                playerId: pid,
                name: player.name,
                value: guess,
                diff: diff,
                isWinner: false
            });
        }

        // Gewinner markieren & Punkte vergeben
        results.forEach(r => {
            if (Math.abs(r.diff - minDiff) < 0.0001) { // Floating point safe check
                r.isWinner = true;
                if (session.players[r.playerId]) {
                    session.players[r.playerId].score += session.activeQuestionPoints;
                }
            }
        });

        // Sortieren: Beste zuerst
        results.sort((a, b) => a.diff - b.diff);

        // An Board senden
        io.to(code).emit('board_reveal_estimate_results', { correctAnswer, guesses: results });
        
        // Scores updaten
        io.to(code).emit('update_scores', session.players);
    });

    socket.on('host_manual_score_update', (data: { playerId: string, newScore: number }) => {
        const info = getSessionBySocketId(socket.id);
        if (!info || !info.isHost) return;
        
        const { session, code } = info;
        const player = session.players[data.playerId];
        
        if (player) {
            console.log(`Manuelle Korrektur: ${player.name} von ${player.score} auf ${data.newScore}`);
            player.score = data.newScore;
            
            // Allen Bescheid sagen (Host Liste, Board Leiste)
            io.to(code).emit('update_scores', session.players);
        }
    });

    socket.on('host_show_podium', () => {
        const info = getSessionBySocketId(socket.id);
        if (!info || !info.isHost) return;

        const { session, code } = info;
        
        // Spieler nach Punkten sortieren (Höchste zuerst)
        const sortedPlayers = Object.values(session.players).sort((a, b) => b.score - a.score);

        // An das Board senden
        io.to(code).emit('board_show_podium', sortedPlayers);
    });

    socket.on('host_media_control', (data) => {
        const info = getSessionBySocketId(socket.id);
        if (info) {
            // Leite den Befehl an alle Clients im Raum (also das Board) weiter
            io.to(info.code).emit('board_media_control', data);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
});