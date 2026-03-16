// src/server.ts
import express, { Request, Response } from 'express';
import http from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import multer from 'multer';
import path from 'path';
import fsSync from 'fs';
import fs from 'fs/promises';
import os from 'os';
import crypto from 'crypto';
import AdmZip from 'adm-zip';

// Typen importieren
import { ISession, ServerToClientEvents, ClientToServerEvents } from './types';
import { GameModel } from './models/Quiz';

// --- SETUP ---
const app = express();
const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server);
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.resolve(process.cwd(), 'output/public');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');

if (!fsSync.existsSync(UPLOADS_DIR)) {
    fsSync.mkdirSync(UPLOADS_DIR, { recursive: true });
}

app.use(express.static(PUBLIC_DIR));
app.use(express.json());

// --- MONGODB ---
const DB_URI = process.env.DB_URI || 'mongodb://localhost:27017/jeopardyquiz';

async function connectDatabase(uri: string = DB_URI) {
    if (mongoose.connection.readyState === 1) return;
    await mongoose.connect(uri);
    console.log('MongoDB verbunden');
}

// --- STATE MANAGEMENT ---
const sessions: Record<string, ISession> = {};
let cleanupInProgress = false;
let cleanupRerunRequested = false;

async function runCleanupUnusedFilesSafely(cleanupFn: () => Promise<void> = cleanupUnusedFiles) {
    if (cleanupInProgress) {
        cleanupRerunRequested = true;
        return;
    }

    cleanupInProgress = true;
    try {
        do {
            cleanupRerunRequested = false;
            await cleanupFn();
        } while (cleanupRerunRequested);
    } finally {
        cleanupInProgress = false;
    }
}

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
            catIndex: session.activeCatIndex,
            qIndex: session.activeQIndex,
            eleminationRevealedIndices: q.type === 'elemination' ? [...session.eleminationRevealedIndices] : undefined
        });
        
        // Falls Maps-Auflösung schon passiert ist:
        if (session.mapResolved) {
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
                if (session.currentBuzzWinnerId && session.players[session.currentBuzzWinnerId]) {
                    io.to(socketId).emit('player_won_buzz', {
                        id: session.currentBuzzWinnerId,
                        name: session.players[session.currentBuzzWinnerId].name
                    });
                }
        }
    }

    // C) HOST SYNC
    if (role === 'host') {
        // Spezielles Event für den Host, um die UI wiederherzustellen
        io.to(socketId).emit('host_restore_active_question', {
            question: q,
            catIndex: session.activeCatIndex,
            qIndex: session.activeQIndex,
            buzzersActive: session.buzzersActive,
            mapGuessesCount: Object.keys(session.mapGuesses || {}).length,
            eleminationRevealedIndices: q.type === 'elemination' ? [...session.eleminationRevealedIndices] : undefined,
            eleminationEliminatedPlayerIds: q.type === 'elemination' ? [...session.eleminationEliminatedPlayerIds] : undefined,
            eleminationRoundResolved: q.type === 'elemination' ? !!session.eleminationRoundResolved : undefined
        });
        if (session.currentTurnPlayerId && session.players[session.currentTurnPlayerId]) {
            io.to(socketId).emit('update_host_controls', {
                buzzWinnerId: session.currentTurnPlayerId,
                buzzWinnerName: session.players[session.currentTurnPlayerId].name,
                chooserPlayerId: session.currentTurnPlayerId,
                chooserPlayerName: session.players[session.currentTurnPlayerId].name
            });
        }
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

function normalizeMediaWebPath(rawPath: string | undefined | null): string {
    if (!rawPath) return '';

    let p = String(rawPath).trim().replace(/\\/g, '/');
    if (!p) return '';
    if (/^https?:\/\//i.test(p) || p.startsWith('data:')) return p;

    const lower = p.toLowerCase();
    const uploadsIdx = lower.lastIndexOf('/uploads/');
    if (uploadsIdx >= 0) {
        p = p.slice(uploadsIdx);
    }

    if (!p.startsWith('/')) p = `/${p}`;
    return p;
}

function collectGameMediaPaths(gameData: any): string[] {
    const result = new Set<string>();
    if (!gameData || typeof gameData !== 'object') return [];

    const topLevelPaths = [
        gameData.boardBackgroundPath,
        gameData.backgroundMusicPath,
        gameData.soundCorrectPath,
        gameData.soundIncorrectPath
    ];

    topLevelPaths.forEach((value) => {
        const normalized = normalizeMediaWebPath(value);
        if (normalized && normalized.startsWith('/uploads/')) result.add(normalized);
    });

    if (Array.isArray(gameData.categories)) {
        gameData.categories.forEach((cat: any) => {
            if (!Array.isArray(cat?.questions)) return;
            cat.questions.forEach((q: any) => {
                [q?.mediaPath, q?.answerMediaPath, q?.location?.customMapPath].forEach((value) => {
                    const normalized = normalizeMediaWebPath(value);
                    if (normalized && normalized.startsWith('/uploads/')) result.add(normalized);
                });
            });
        });
    }

    return [...result];
}

function remapGameMediaPaths(gameData: any, pathMap: Record<string, string>) {
    const mapPath = (value: any): any => {
        const normalized = normalizeMediaWebPath(value);
        return pathMap[normalized] || value;
    };

    gameData.boardBackgroundPath = mapPath(gameData.boardBackgroundPath);
    gameData.backgroundMusicPath = mapPath(gameData.backgroundMusicPath);
    gameData.soundCorrectPath = mapPath(gameData.soundCorrectPath);
    gameData.soundIncorrectPath = mapPath(gameData.soundIncorrectPath);

    if (!Array.isArray(gameData.categories)) return;
    gameData.categories.forEach((cat: any) => {
        if (!Array.isArray(cat?.questions)) return;
        cat.questions.forEach((q: any) => {
            q.mediaPath = mapPath(q.mediaPath);
            q.answerMediaPath = mapPath(q.answerMediaPath);
            if (q.location) {
                q.location.customMapPath = mapPath(q.location.customMapPath);
            }
        });
    });
}

function makeStoredUploadFileName(extension: string): string {
    const safeExt = extension.startsWith('.') ? extension : `.${extension}`;
    return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExt}`;
}

async function deleteMediaFile(filePath: string) {
    if (!filePath || filePath.startsWith('http')) return;
    const relativePath = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const absolutePath = path.resolve(PUBLIC_DIR, relativePath);
    const relativeToPublic = path.relative(PUBLIC_DIR, absolutePath);

    if (relativeToPublic.startsWith('..') || path.isAbsolute(relativeToPublic)) {
        console.warn(`Unsicherer Dateipfad verworfen: ${filePath}`);
        return;
    }
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

function getEleminationRemainingPlayerIds(session: ISession): string[] {
    if (!session.eleminationEliminatedPlayerIds) session.eleminationEliminatedPlayerIds = [];
    return Object.values(session.players)
    .filter((p) => !p.excluded && !session.eleminationEliminatedPlayerIds.includes(p.id))
        .map((p) => p.id);
}

function isPlayerInQuiz(session: ISession, playerId: string): boolean {
    const p = session.players[playerId];
    return !!p && !p.excluded;
}

function getInQuizPlayerCount(session: ISession): number {
    return Object.values(session.players).filter((p) => !p.excluded).length;
}

function getGamePayloadValidationError(gameData: any): string | null {
    const hasNonEmptyStringArray = (value: unknown): boolean => {
        return Array.isArray(value) && value.some((item) => typeof item === 'string' && item.trim().length > 0);
    };

    if (!gameData || typeof gameData !== 'object') return 'Payload ist leer oder kein Objekt';
    if (typeof gameData.title !== 'string' || gameData.title.trim().length === 0) return 'Titel fehlt';
    if (!Array.isArray(gameData.categories) || gameData.categories.length === 0) return 'Keine Kategorien vorhanden';

    for (let catIndex = 0; catIndex < gameData.categories.length; catIndex++) {
        const category = gameData.categories[catIndex];
        if (!category || typeof category !== 'object') return `Kategorie ${catIndex + 1} ist ungueltig`;
        if (typeof category.name !== 'string') return `Kategorie ${catIndex + 1}: Name ist kein String`;
        if (!Array.isArray(category.questions) || category.questions.length === 0) return `Kategorie ${catIndex + 1}: keine Fragen vorhanden`;

        for (let qIndex = 0; qIndex < category.questions.length; qIndex++) {
            const question = category.questions[qIndex];
            if (!question || typeof question !== 'object') return `Kategorie ${catIndex + 1}, Frage ${qIndex + 1}: ungueltiges Objekt`;
            if (typeof question.type !== 'string' || question.type.trim().length === 0) return `Kategorie ${catIndex + 1}, Frage ${qIndex + 1}: Typ fehlt`;
            if (typeof question.questionText !== 'string' || question.questionText.trim().length === 0) return `Kategorie ${catIndex + 1}, Frage ${qIndex + 1}: Fragetext fehlt`;
            if (typeof question.points !== 'number' || Number.isNaN(question.points)) return `Kategorie ${catIndex + 1}, Frage ${qIndex + 1}: Punkte ungueltig`;
            if (question.negativePoints !== undefined && typeof question.negativePoints !== 'number') return `Kategorie ${catIndex + 1}, Frage ${qIndex + 1}: Minuspunkte ungueltig`;

            const qType = question.type as string;
            switch (qType) {
                case 'estimate': {
                    if (typeof question.estimationAnswer !== 'number' || Number.isNaN(question.estimationAnswer)) return `Kategorie ${catIndex + 1}, Frage ${qIndex + 1}: Schaetzantwort fehlt/ungueltig`;
                    break;
                }
                case 'map': {
                    // Map questions can be solved by coordinates/custom map/zone and therefore do not require answerText.
                    const loc = question.location;
                    const hasZone = Array.isArray(loc?.zone) && loc.zone.length > 0;
                    const hasCoords = typeof loc?.lat === 'number' && !Number.isNaN(loc.lat)
                        && typeof loc?.lng === 'number' && !Number.isNaN(loc.lng);
                    const hasCustomMap = !!loc?.isCustomMap && typeof loc?.customMapPath === 'string' && loc.customMapPath.trim().length > 0;
                    if (!hasZone && !hasCoords && !hasCustomMap) return `Kategorie ${catIndex + 1}, Frage ${qIndex + 1}: Karte ohne Zielposition/Zonen/Custom-Map`;
                    break;
                }
                case 'elemination': {
                    const hasListItems = hasNonEmptyStringArray(question.listItems);
                    const hasLegacyAnswerText = typeof question.answerText === 'string' && question.answerText.trim().length > 0;
                    if (!hasListItems && !hasLegacyAnswerText) return `Kategorie ${catIndex + 1}, Frage ${qIndex + 1}: Elimination ohne Antwortoptionen`;
                    break;
                }
                case 'list': {
                    // List questions are valid with hint items; answerText is optional in existing quizzes.
                    if (!hasNonEmptyStringArray(question.listItems)) return `Kategorie ${catIndex + 1}, Frage ${qIndex + 1}: Liste ohne Eintraege`;
                    break;
                }
                case 'standard':
                case 'pixel':
                case 'freetext': {
                    if (typeof question.answerText !== 'string' || question.answerText.trim().length === 0) return `Kategorie ${catIndex + 1}, Frage ${qIndex + 1}: Antwort fehlt`;
                    break;
                }
                default: {
                    // Unknown/legacy types fall back to permissive checks to avoid blocking save for old data.
                    if (question.answerText !== undefined && typeof question.answerText !== 'string') return `Kategorie ${catIndex + 1}, Frage ${qIndex + 1}: Antwortformat ungueltig`;
                    break;
                }
            }
        }
    }

    return null;
}

function isValidGamePayload(gameData: any): boolean {
    return getGamePayloadValidationError(gameData) === null;
}

function ensurePlayerOrder(session: ISession) {
    if (!session.playerOrder) session.playerOrder = [];

    const existingIds = new Set(Object.keys(session.players));
    session.playerOrder = session.playerOrder.filter((pid) => existingIds.has(pid));

    Object.keys(session.players).forEach((pid) => {
        if (!session.playerOrder.includes(pid)) {
            session.playerOrder.push(pid);
        }
    });

    if (session.currentTurnPlayerId && (!session.playerOrder.includes(session.currentTurnPlayerId) || !isPlayerInQuiz(session, session.currentTurnPlayerId))) {
        session.currentTurnPlayerId = null;
    }
}

function setRandomTurnPlayerIfNeeded(session: ISession) {
    ensurePlayerOrder(session);
    if (session.currentTurnPlayerId) return;

    const availablePlayers = session.playerOrder.filter((pid) => isPlayerInQuiz(session, pid));
    if (availablePlayers.length === 0) {
        session.currentTurnPlayerId = null;
        return;
    }

    const idx = Math.floor(Math.random() * availablePlayers.length);
    session.currentTurnPlayerId = availablePlayers[idx];
}

function setTurnPlayer(session: ISession, playerId: string | null) {
    ensurePlayerOrder(session);
    if (!playerId || !session.playerOrder.includes(playerId) || !isPlayerInQuiz(session, playerId)) {
        session.currentTurnPlayerId = null;
        return;
    }
    session.currentTurnPlayerId = playerId;
}

function advanceTurnPlayer(session: ISession, options?: { skipEleminated?: boolean }) {
    ensurePlayerOrder(session);
    if (session.playerOrder.length === 0) {
        session.currentTurnPlayerId = null;
        return;
    }

    const skipEleminated = !!options?.skipEleminated;
    const blocked = skipEleminated ? new Set(session.eleminationEliminatedPlayerIds || []) : new Set<string>();

    let startIndex = session.currentTurnPlayerId ? session.playerOrder.indexOf(session.currentTurnPlayerId) : -1;
    if (startIndex < 0) startIndex = 0;

    for (let step = 1; step <= session.playerOrder.length; step++) {
        const idx = (startIndex + step) % session.playerOrder.length;
        const candidate = session.playerOrder[idx];
        if (!blocked.has(candidate) && isPlayerInQuiz(session, candidate)) {
            session.currentTurnPlayerId = candidate;
            return;
        }
    }

    session.currentTurnPlayerId = null;
}

function emitCurrentTurn(session: ISession, code: string) {
    if (!session.currentTurnPlayerId || !session.players[session.currentTurnPlayerId] || !isPlayerInQuiz(session, session.currentTurnPlayerId)) return;
    const p = session.players[session.currentTurnPlayerId];
    io.to(code).emit('player_won_buzz', { id: p.id, name: p.name });
    io.to(session.hostSocketId).emit('update_host_controls', {
        buzzWinnerId: p.id,
        buzzWinnerName: p.name,
        chooserPlayerId: p.id,
        chooserPlayerName: p.name
    });
}

function awardPointsToPlayers(session: ISession, playerIds: string[], points: number) {
    playerIds.forEach((pid) => {
        if (session.players[pid]) {
            session.players[pid].score += points;
        }
    });
}

function getActivePlayerIds(session: ISession): string[] {
    return Object.values(session.players)
    .filter((p) => !p.excluded)
        .map((p) => p.id);
}

function resolveEleminationByAllRevealedIfNeeded(session: ISession, code: string) {
    const q = session.activeQuestion;
    if (!q || q.type !== 'elemination' || !Array.isArray(q.listItems)) return;
    if (session.eleminationRoundResolved) return;

    const total = q.listItems.length;
    const revealed = session.eleminationRevealedIndices?.length || 0;
    if (total === 0 || revealed < total) return;

    session.eleminationRoundResolved = true;
    session.currentBuzzWinnerId = null;

    // Wenn alle Antworten offen sind und die Runde noch nicht vorher entschieden wurde,
    // erhalten alle aktiven Spieler Punkte.
    const activePlayerIds = getActivePlayerIds(session);
    awardPointsToPlayers(session, activePlayerIds, session.activeQuestionPoints);

    io.to(code).emit('update_scores', session.players);
    io.to(session.hostSocketId).emit('update_host_controls', {
        buzzWinnerId: null,
        eleminationRevealedIndices: [...(session.eleminationRevealedIndices || [])],
        eleminationEliminatedPlayerIds: [...(session.eleminationEliminatedPlayerIds || [])],
        eleminationRoundResolved: true
    });
}

function closeActiveQuestion(session: ISession, code: string) {
    session.buzzersActive = false;
    session.currentBuzzWinnerId = null;
    session.activeQuestion = null;
    session.activeCatIndex = -1;
    session.activeQIndex = -1;

    io.to(code).emit('board_hide_question');
    io.to(session.hostSocketId).emit('update_host_controls', {
        buzzWinnerId: null,
        eleminationMode: false,
        eleminationRevealedIndices: [],
        eleminationEliminatedPlayerIds: [],
        chooserPlayerId: session.currentTurnPlayerId,
        chooserPlayerName: session.currentTurnPlayerId && session.players[session.currentTurnPlayerId]
            ? session.players[session.currentTurnPlayerId].name
            : undefined
    });
}

function revealRemainingEleminationAnswersThenClose(session: ISession, code: string) {
    if (!session.eleminationRevealedIndices) session.eleminationRevealedIndices = [];
    if (!session.eleminationEliminatedPlayerIds) session.eleminationEliminatedPlayerIds = [];
    const question = session.activeQuestion;
    const total = question?.listItems?.length || 0;

    if (!question || question.type !== 'elemination' || total === 0) {
        closeActiveQuestion(session, code);
        return;
    }

    const remaining = [] as number[];
    for (let i = 0; i < total; i++) {
        if (!session.eleminationRevealedIndices.includes(i)) {
            remaining.push(i);
        }
    }

    if (remaining.length === 0) {
        closeActiveQuestion(session, code);
        return;
    }

    session.buzzersActive = false;
    io.to(code).emit('buzzers_locked');

    let pos = 0;
    const timer = setInterval(() => {
        const idx = remaining[pos];
        if (idx === undefined) {
            clearInterval(timer);
            closeActiveQuestion(session, code);
            return;
        }

        if (!session.eleminationRevealedIndices.includes(idx)) {
            session.eleminationRevealedIndices.push(idx);
            io.to(code).emit('board_reveal_elemination_answer', idx);
            io.to(session.hostSocketId).emit('update_host_controls', {
                eleminationRevealedIndices: [...session.eleminationRevealedIndices]
            });
        }

        pos++;
        if (pos >= remaining.length) {
            clearInterval(timer);
            setTimeout(() => {
                if (session.lastEleminationRevealerId) {
                    setTurnPlayer(session, session.lastEleminationRevealerId);
                }
                closeActiveQuestion(session, code);
            }, 700);
        }
    }, 900);
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

        const uploadDir = UPLOADS_DIR;

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
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage: storage });
const importBundleUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 200 * 1024 * 1024 }
});

app.post('/api/upload', upload.single('mediaFile'), (req: Request, res: Response) => {
    if (req.file) {
        res.json({ success: true, filePath: '/uploads/' + req.file.filename });
    } else {
        res.status(400).json({ success: false, error: 'Keine Datei.' });
    }
});

// --- API ROUTES ---
app.get('/api/games', async (_req, res) => {
    try {
        const games = await GameModel.find().select('_id title boardBackgroundPath');
        res.json(games);
    } catch (err) {
        res.status(500).json({ error: 'Fehler beim Laden' });
    }
});

app.get('/api/games/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Ungültige ID' });
        }
        const game = await GameModel.findById(req.params.id);
        if (!game) return res.status(404).json({ error: 'Nicht gefunden' });
        res.json(game);
    } catch (err) {
        res.status(500).json({ error: 'Fehler' });
    }
});

app.get('/api/games/:id/export', async (req, res) => {
    try {
        const id = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: 'Ungültige ID' });
        }

        const gameDoc = await GameModel.findById(id);
        if (!gameDoc) {
            return res.status(404).json({ success: false, error: 'Quiz nicht gefunden' });
        }

        const gameData = JSON.parse(JSON.stringify(gameDoc));
        const mediaPaths = collectGameMediaPaths(gameData);

        const zip = new AdmZip();
        const assets: Array<{ originalPath: string; bundlePath: string; fileName: string }> = [];

        const usedBundleNames = new Set<string>();
        for (const mediaPath of mediaPaths) {
            const normalized = normalizeMediaWebPath(mediaPath);
            const fileName = path.basename(normalized);
            const absolutePath = path.join(UPLOADS_DIR, fileName);

            try {
                await fs.access(absolutePath);
            } catch {
                continue;
            }

            let bundleName = fileName;
            let counter = 1;
            while (usedBundleNames.has(bundleName)) {
                const parsed = path.parse(fileName);
                bundleName = `${parsed.name}-${counter}${parsed.ext}`;
                counter++;
            }
            usedBundleNames.add(bundleName);

            zip.addLocalFile(absolutePath, 'assets', bundleName);
            assets.push({
                originalPath: normalized,
                bundlePath: `assets/${bundleName}`,
                fileName: bundleName
            });
        }

        const manifest = {
            type: 'jeopardy-quiz-bundle',
            version: 1,
            exportedAt: new Date().toISOString(),
            quiz: {
                id: String(gameDoc._id),
                title: gameDoc.title,
                file: 'quiz.json'
            },
            assets
        };

        zip.addFile('quiz.json', Buffer.from(JSON.stringify(gameData, null, 2), 'utf-8'));
        zip.addFile('quiz-import-manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'));

        const safeTitle = (gameDoc.title || 'quiz').replace(/[^a-zA-Z0-9-_]+/g, '_');
        const fileName = `${safeTitle || 'quiz'}-export.zip`;

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        return res.send(zip.toBuffer());
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err?.message || 'Export fehlgeschlagen' });
    }
});

app.post('/api/games/import', importBundleUpload.single('importBundle'), async (req, res) => {
    try {
        if (!req.file?.buffer) {
            return res.status(400).json({ success: false, error: 'Keine Import-Datei empfangen' });
        }

        const zip = new AdmZip(req.file.buffer);
        const entries = zip.getEntries();
        const findEntry = (entryPath: string) => entries.find((entry) => entry.entryName === entryPath);

        const manifestEntry = findEntry('quiz-import-manifest.json');
        if (!manifestEntry) {
            return res.status(400).json({ success: false, error: 'Manifest fehlt (quiz-import-manifest.json)' });
        }

        let manifest: any;
        try {
            manifest = JSON.parse(manifestEntry.getData().toString('utf-8'));
        } catch {
            return res.status(400).json({ success: false, error: 'Manifest ist kein gültiges JSON' });
        }

        if (manifest?.type !== 'jeopardy-quiz-bundle') {
            return res.status(400).json({ success: false, error: 'Unbekanntes Bundle-Format' });
        }

        const quizPath = manifest?.quiz?.file || 'quiz.json';
        const quizEntry = findEntry(quizPath);
        if (!quizEntry) {
            return res.status(400).json({ success: false, error: `Quiz-Datei fehlt (${quizPath})` });
        }

        let importedGame: any;
        try {
            importedGame = JSON.parse(quizEntry.getData().toString('utf-8'));
        } catch {
            return res.status(400).json({ success: false, error: 'Quiz-Datei ist kein gültiges JSON' });
        }

        const pathMap: Record<string, string> = {};
        const assets = Array.isArray(manifest.assets) ? manifest.assets : [];

        for (const asset of assets) {
            const originalPath = normalizeMediaWebPath(asset?.originalPath || '');
            const bundlePath = String(asset?.bundlePath || '');
            if (!originalPath || !bundlePath) continue;

            const assetEntry = findEntry(bundlePath);
            if (!assetEntry || assetEntry.isDirectory) continue;

            const ext = path.extname(assetEntry.entryName) || '.bin';
            const storedFileName = makeStoredUploadFileName(ext);
            const absolutePath = path.join(UPLOADS_DIR, storedFileName);
            await fs.writeFile(absolutePath, assetEntry.getData());
            pathMap[originalPath] = `/uploads/${storedFileName}`;
        }

        remapGameMediaPaths(importedGame, pathMap);
        delete importedGame._id;

        const validationError = getGamePayloadValidationError(importedGame);
        if (validationError) {
            return res.status(400).json({ success: false, error: `Import ungültig: ${validationError}` });
        }

        const savedGame = await new GameModel(importedGame).save();

        if (process.env.NODE_ENV !== 'test') {
            void runCleanupUnusedFilesSafely();
        }

        return res.json({ success: true, gameId: savedGame._id, title: savedGame.title });
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err?.message || 'Import fehlgeschlagen' });
    }
});

app.post('/api/create-game', async (req, res) => {
    try {
        const gameData = req.body;
        const validationError = getGamePayloadValidationError(gameData);

        if (validationError) {
            const showDetails = process.env.NODE_ENV !== 'production';
            const message = showDetails
                ? `Ungültige Spieldaten: ${validationError}`
                : 'Ungültige Spieldaten';
            return res.status(400).json({ success: false, error: message });
        }

        let savedGame;
        if (gameData._id) {
            if (!mongoose.Types.ObjectId.isValid(gameData._id)) {
                return res.status(400).json({ success: false, error: 'Ungültige ID' });
            }
            savedGame = await GameModel.findByIdAndUpdate(gameData._id, gameData, { new: true, runValidators: true });
            if (!savedGame) {
                return res.status(404).json({ success: false, error: 'Nicht gefunden' });
            }
        } else {
            savedGame = await new GameModel(gameData).save();
        }

        if (process.env.NODE_ENV !== 'test') {
            void runCleanupUnusedFilesSafely();
        }

        return res.json({ success: true, gameId: savedGame?._id });
    } catch (err: any) {
        if (err?.name === 'ValidationError' || err?.name === 'CastError') {
            return res.status(400).json({ success: false, error: err.message });
        }
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/games/:id', async (req, res) => {
    try {
        const id = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Ungültige ID' });
        }
        const game = await GameModel.findById(id);
        if (game) {
            const files: string[] = [];
            if (game.boardBackgroundPath) files.push(game.boardBackgroundPath);
            if (game.soundCorrectPath) files.push(game.soundCorrectPath);
            if (game.soundIncorrectPath) files.push(game.soundIncorrectPath);
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

    socket.on('host_create_session', async (gameId) => {

        const gameData = await GameModel.findById(gameId); // oder deine Lade-Logik
        
        if (!gameData) {
            socket.emit('error_message', 'Spiel nicht gefunden.');
            return;
        }

        const roomCode = generateRoomCode();
        sessions[roomCode] = {
            gameId,
            game: gameData,
            hostSocketId: socket.id,
            players: {},
            playerOrder: [],
            currentTurnPlayerId: null,
            lastEleminationRevealerId: null,
            buzzersActive: false,
            currentBuzzWinnerId: null,
            activeQuestion: null,
            activeQuestionPoints: 0,
            activeCatIndex: -1,
            activeQIndex: -1,
            mapResolved: false,
            mapGuesses: {},
            estimateGuesses: {},
            listRevealedCount: -1, 
            eleminationRevealedIndices: [],
            eleminationEliminatedPlayerIds: [],
            eleminationRoundResolved: false,
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
        let eleminationRevealedIndices: number[] = [];
        let eleminationEliminatedPlayerIds: string[] = [];

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
            } else if (qType === 'elemination') {
                eleminationRevealedIndices = [...(session.eleminationRevealedIndices || [])];
                eleminationEliminatedPlayerIds = [...(session.eleminationEliminatedPlayerIds || [])];
            }
        }

        // Event senden
        socket.emit('host_session_restored', {
            gameId: session.gameId,
            catIndex: session.activeCatIndex,
            qIndex: session.activeQIndex,
            question: session.activeQuestion!,
            players: session.players,
            buzzersActive: session.buzzersActive,
            buzzWinnerId: session.currentBuzzWinnerId,
            isResolved: session.mapResolved,
            
            // Die neuen Felder:
            submittedCount: submittedCount,
            listRevealedCount: listRevealedCount,
            eleminationRevealedIndices,
            eleminationEliminatedPlayerIds,
            eleminationRoundResolved: session.activeQuestion?.type === 'elemination' ? !!session.eleminationRoundResolved : undefined
        });
        
        // Punktestand-Update sicherheitshalber hinterher
        socket.emit('update_scores', session.players);
    });
    
    // NEU: Host Start Game Handler, falls das Board-Update über Socket läuft
    socket.on('host_start_game', async (gameId) => {
        try {
            const info = getSessionBySocketId(socket.id);
            if (!info || !info.isHost) return;

            const game = await GameModel.findById(gameId);
            if(game) {
                // Sende das Spiel zurück an den Host zur Anzeige
                socket.emit('load_game_on_host', game ) ; 

                setRandomTurnPlayerIfNeeded(info.session);
                io.to(info.session.hostSocketId).emit('update_host_controls', {
                    chooserPlayerId: info.session.currentTurnPlayerId,
                    chooserPlayerName: info.session.currentTurnPlayerId && info.session.players[info.session.currentTurnPlayerId]
                        ? info.session.players[info.session.currentTurnPlayerId].name
                        : undefined
                });
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
            ensurePlayerOrder(session);
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
                active: true,
                excluded: false
            };
            ensurePlayerOrder(session);
            socket.join(roomCode);
            socket.emit('join_success', { playerId: newPlayerId, roomCode, name });
        }

        if (!session.activeQuestion && (session.usedQuestions?.length ?? 0) === 0) {
            ensurePlayerOrder(session);
            const turnCandidates = session.playerOrder.filter((pid) => isPlayerInQuiz(session, pid));
            session.currentTurnPlayerId = turnCandidates.length > 0
                ? turnCandidates[Math.floor(Math.random() * turnCandidates.length)]
                : null;
        } else {
            setRandomTurnPlayerIfNeeded(session);
        }
        
        io.to(roomCode).emit('update_player_list', session.players);
        io.to(roomCode).emit('update_scores', session.players);
        io.to(session.hostSocketId).emit('update_host_controls', {
            chooserPlayerId: session.currentTurnPlayerId,
            chooserPlayerName: session.currentTurnPlayerId && session.players[session.currentTurnPlayerId]
                ? session.players[session.currentTurnPlayerId].name
                : undefined
        });

        if (session) {
            syncSessionState(session, socket.id, 'player');
        }
    });

    socket.on('player_buzz', () => {
        const info = getSessionBySocketId(socket.id);
        if (!info || !info.isPlayer || !info.playerId) return;

        const { session, code, playerId } = info;
        if (!isPlayerInQuiz(session, playerId)) return;

        const qType = session.activeQuestion?.type;
        if (!qType) return;

        // Elimination läuft bewusst im Reihum-/Ausscheidungsmodus.
        if (qType === 'elemination') return;

        // Nur klassische Buzz-Fragen reagieren auf Buzz-Events.
        const supportsBuzz = qType === 'standard' || qType === 'pixel' || qType === 'list';
        if (!supportsBuzz) return;

        if (!session.buzzersActive || session.currentBuzzWinnerId) return;

        session.currentBuzzWinnerId = playerId;
        session.buzzersActive = false;

        const p = session.players[playerId];
        if (!p) return;

        io.to(code).emit('buzzers_locked');
        io.to(code).emit('player_won_buzz', { id: p.id, name: p.name });
        io.to(session.hostSocketId).emit('player_won_buzz', { id: p.id, name: p.name });
        io.to(session.hostSocketId).emit('update_host_controls', {
            buzzWinnerId: p.id,
            buzzWinnerName: p.name
        });
    });

    socket.on('host_score_answer', (data) => {
        const info = getSessionBySocketId(socket.id);
        if (!info || !info.isHost) return;
        const { session, code } = info;
        
        const player = session.players[data.playerId];
        if (player) {
            if (player.excluded) return;
            if (session.activeQuestion?.type === 'elemination') {
                if (!session.eleminationEliminatedPlayerIds) session.eleminationEliminatedPlayerIds = [];
                if (!session.eleminationRevealedIndices) session.eleminationRevealedIndices = [];
                if (data.action === 'correct') {
                    io.to(code).emit('board_play_sfx', 'correct');

                    advanceTurnPlayer(session, { skipEleminated: true });
                    session.currentBuzzWinnerId = session.currentTurnPlayerId;
                    emitCurrentTurn(session, code);

                    io.to(session.hostSocketId).emit('update_host_controls', {
                        eleminationRevealedIndices: [...session.eleminationRevealedIndices],
                        eleminationEliminatedPlayerIds: [...session.eleminationEliminatedPlayerIds]
                    });
                    return;
                }
                if (data.action === 'incorrect') {
                    if (!session.eleminationEliminatedPlayerIds.includes(data.playerId)) {
                        session.eleminationEliminatedPlayerIds.push(data.playerId);
                    }

                    session.lockedPlayers = [...session.eleminationEliminatedPlayerIds];
                    session.currentBuzzWinnerId = null;

                    io.to(code).emit('board_play_sfx', 'incorrect');
                    io.to(session.hostSocketId).emit('update_host_controls', {
                        buzzWinnerId: null,
                        eleminationEliminatedPlayerIds: [...session.eleminationEliminatedPlayerIds]
                    });

                    const remaining = getEleminationRemainingPlayerIds(session);
                    if (remaining.length <= 1 && !session.eleminationRoundResolved) {
                        session.eleminationRoundResolved = true;
                        if (remaining.length === 1) {
                            awardPointsToPlayers(session, remaining, session.activeQuestionPoints);
                            io.to(code).emit('board_play_sfx', 'correct');
                        }
                        io.to(code).emit('update_scores', session.players);
                        session.currentBuzzWinnerId = null;
                        io.to(session.hostSocketId).emit('update_host_controls', {
                            buzzWinnerId: null,
                            eleminationRevealedIndices: [...session.eleminationRevealedIndices],
                            eleminationEliminatedPlayerIds: [...session.eleminationEliminatedPlayerIds],
                            eleminationRoundResolved: true
                        });
                    } else {
                        advanceTurnPlayer(session, { skipEleminated: true });
                        session.currentBuzzWinnerId = session.currentTurnPlayerId;
                        emitCurrentTurn(session, code);
                    }
                }

                io.to(code).emit('update_scores', session.players);
                return;
            }

            const points = session.activeQuestionPoints;
            const qType = session.activeQuestion?.type;

            if (qType === 'freetext') {
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
                    } else {
                        io.to(code).emit('board_freetext_update_state', { playerId: data.playerId, status: 'incorrect' });
                        io.to(code).emit('board_play_sfx', 'incorrect');
                    }
                }

                io.to(code).emit('update_scores', session.players);
                io.to(session.hostSocketId).emit('host_update_freetext_buttons', {
                    playerId: data.playerId,
                    status: session.freetextGrading[data.playerId]
                });
                return;
            }

            if (qType === 'standard' || qType === 'pixel' || qType === 'list') {
                if (data.action === 'correct') {
                    player.score += points;
                    io.to(code).emit('board_reveal_answer');
                    io.to(code).emit('board_play_sfx', 'correct');
                } else {
                    const penalty = session.activeQuestion?.negativePoints ?? points;
                    player.score -= penalty;
                    session.currentBuzzWinnerId = null;
                    session.buzzersActive = false;
                    io.to(code).emit('buzzers_locked');
                    io.to(code).emit('board_play_sfx', 'incorrect');
                    io.to(session.hostSocketId).emit('update_host_controls', {
                        buzzWinnerId: null,
                        buzzWinnerName: null
                    });
                }

                io.to(code).emit('update_scores', session.players);
                return;
            }

            if (data.action === 'correct') {
                player.score += points;
                io.to(code).emit('board_play_sfx', 'correct');
            } else {
                const penalty = session.activeQuestion?.negativePoints ?? points;
                player.score -= penalty;
                io.to(code).emit('board_play_sfx', 'incorrect');
            }
            io.to(code).emit('update_scores', session.players);
        }
    });

    socket.on('host_resolve_question', () => {
        const info = getSessionBySocketId(socket.id);
        if (!info || !info.isHost) return;
        if (info.session.activeQuestion?.type === 'elemination') {
            closeActiveQuestion(info.session, info.code);
            return;
        }
        io.to(info.code).emit('board_reveal_answer');
    });

    socket.on('host_pick_question', (data) => {
        const info = getSessionBySocketId(socket.id);
        if (!info || !info.isHost) return;
        const { session, code } = info;
        
        session.activeQuestion = data.question;
        session.activeQuestionPoints = data.question.points;
        setRandomTurnPlayerIfNeeded(session);
        session.mapGuesses = {};
        session.lockedPlayers = [];
        session.freetextGrading = {};
        session.eleminationRevealedIndices = [];
        session.eleminationEliminatedPlayerIds = [];
        session.eleminationRoundResolved = false;
        session.lastEleminationRevealerId = null;
        
        session.activeCatIndex = data.catIndex;
        session.activeQIndex = data.qIndex;
        session.mapResolved = false;
        
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
            session.buzzersActive = true;
            session.currentBuzzWinnerId = null;
            io.to(session.hostSocketId).emit('update_host_controls', { 
                buzzWinnerId: null,
                buzzWinnerName: null,
                mapMode: false,
                listMode: true,           // Flag für Host UI
                listRevealedCount: -1 
            });
            io.to(code).emit('player_new_question', { text: data.question.questionText, points: data.question.points });
            io.to(code).emit('buzzers_unlocked', []);
        } else if (data.question.type === 'elemination') {
            session.buzzersActive = false;
            session.lockedPlayers = [];
            const remainingAtStart = getEleminationRemainingPlayerIds(session);
            const autoResolved = remainingAtStart.length === 1;

            if (autoResolved) {
                session.eleminationRoundResolved = true;
                session.currentBuzzWinnerId = null;
                awardPointsToPlayers(session, remainingAtStart, session.activeQuestionPoints);
                io.to(code).emit('update_scores', session.players);
            } else {
                session.currentBuzzWinnerId = session.currentTurnPlayerId;
            }

            io.to(session.hostSocketId).emit('update_host_controls', {
                buzzWinnerId: autoResolved ? null : session.currentTurnPlayerId,
                buzzWinnerName: !autoResolved && session.currentTurnPlayerId && session.players[session.currentTurnPlayerId]
                    ? session.players[session.currentTurnPlayerId].name
                    : undefined,
                mapMode: false,
                listMode: false,
                estimateMode: false,
                freetextMode: false,
                eleminationMode: true,
                eleminationRevealedIndices: [],
                eleminationEliminatedPlayerIds: [],
                eleminationRoundResolved: autoResolved
            });

            io.to(code).emit('player_new_question', {
                text: data.question.questionText,
                points: data.question.points
            });
            if (!autoResolved) {
                emitCurrentTurn(session, code);
            }
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
            session.currentBuzzWinnerId = null;
            io.to(session.hostSocketId).emit('update_host_controls', {
                buzzWinnerId: null,
                buzzWinnerName: null,
                mapMode: false
            });
            io.to(code).emit('player_new_question', { text: data.question.questionText, points: data.question.points });
            io.to(code).emit('buzzers_unlocked', []);
        }
        io.to(code).emit('board_show_question', {
            ...data,
            currentListIndex: session.listRevealedCount,
            eleminationRevealedIndices: data.question.type === 'elemination' ? [] : undefined
        });
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

    socket.on('host_reveal_elemination_answer', (index) => {
        const info = getSessionBySocketId(socket.id);
        if (!info || !info.isHost) return;

        const { session, code } = info;
        const q = session.activeQuestion;
        if (!session.eleminationRevealedIndices) session.eleminationRevealedIndices = [];
        if (!session.eleminationEliminatedPlayerIds) session.eleminationEliminatedPlayerIds = [];
        if (!q || q.type !== 'elemination' || !Array.isArray(q.listItems)) return;
        const revealingPlayerId = session.currentBuzzWinnerId;
        if (!revealingPlayerId && !session.eleminationRoundResolved) return;
        if (index < 0 || index >= q.listItems.length) return;

        if (session.eleminationRevealedIndices.includes(index)) return;

        session.eleminationRevealedIndices.push(index);
        io.to(code).emit('board_reveal_elemination_answer', index);
        io.to(code).emit('board_play_sfx', 'correct');
        if (revealingPlayerId) {
            session.lastEleminationRevealerId = revealingPlayerId;
        }

        io.to(session.hostSocketId).emit('update_host_controls', {
            buzzWinnerId: session.eleminationRoundResolved ? null : session.currentBuzzWinnerId,
            buzzWinnerName: !session.eleminationRoundResolved && session.currentBuzzWinnerId && session.players[session.currentBuzzWinnerId]
                ? session.players[session.currentBuzzWinnerId].name
                : undefined,
            eleminationRevealedIndices: [...session.eleminationRevealedIndices],
            eleminationEliminatedPlayerIds: [...session.eleminationEliminatedPlayerIds],
            eleminationRoundResolved: !!session.eleminationRoundResolved
        });

        resolveEleminationByAllRevealedIfNeeded(session, code);
    });

    socket.on('host_reveal_all_elemination_answers', () => {
        const info = getSessionBySocketId(socket.id);
        if (!info || !info.isHost) return;

        const { session, code } = info;
        const q = session.activeQuestion;
        if (!q || q.type !== 'elemination' || !Array.isArray(q.listItems)) return;
        if (!session.eleminationRevealedIndices) session.eleminationRevealedIndices = [];

        for (let idx = 0; idx < q.listItems.length; idx++) {
            if (!session.eleminationRevealedIndices.includes(idx)) {
                session.eleminationRevealedIndices.push(idx);
                io.to(code).emit('board_reveal_elemination_answer', idx);
            }
        }

        io.to(session.hostSocketId).emit('update_host_controls', {
            eleminationRevealedIndices: [...session.eleminationRevealedIndices],
            eleminationEliminatedPlayerIds: [...(session.eleminationEliminatedPlayerIds || [])],
            eleminationRoundResolved: !!session.eleminationRoundResolved
        });

        resolveEleminationByAllRevealedIfNeeded(session, code);
    });

    socket.on('player_submit_map_guess', (coords) => {
        const info = getSessionBySocketId(socket.id);
        if (!info || !info.isPlayer || !info.playerId) return;
        const { session } = info;
        if (!isPlayerInQuiz(session, info.playerId)) return;
        
        session.mapGuesses[info.playerId] = coords;
        const count = Object.keys(session.mapGuesses).length;
        io.to(session.hostSocketId).emit('host_update_map_status', { 
            submittedCount: count, 
            totalPlayers: getInQuizPlayerCount(session)
        });
    });

    socket.on('host_resolve_map', () => {
        const info = getSessionBySocketId(socket.id);
        if (!info || !info.isHost) return;
        const { session, code } = info;
        
        if(!session.activeQuestion?.location) return;
        
        const target = session.activeQuestion.location;
        const guesses = session.mapGuesses;
        const radius = target.radius || 0;
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
                    if(session.players[pid]) session.players[pid].score += session.activeQuestionPoints;
                }
            } else if (radius > 0) {
                if (playerRes.distance <= radius) {
                    playerRes.isWinner = true;
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

        session.mapResolved = true;

        io.to(code).emit('board_reveal_map_results', { results, players: session.players, target });
        io.to(code).emit('update_scores', session.players);
    });

    socket.on('player_submit_freetext', (text) => {
        const info = getSessionBySocketId(socket.id);
        if (!info || !info.isPlayer || !info.playerId) return;
        const { session } = info;
        if (!isPlayerInQuiz(session, info.playerId)) return;

        // Speichern
        if (!session.freetextAnswers) session.freetextAnswers = {};
        session.freetextAnswers[info.playerId] = text;

        // Host updaten (Anzahl eingegangen)
        const count = Object.keys(session.freetextAnswers).length;
        const total = getInQuizPlayerCount(session);
        
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
        if (!info || !info.isHost) return;
        io.to(info.code).emit('board_toggle_qr');
    });

    socket.on('host_control_pixel_puzzle', (action) => {
        const info = getSessionBySocketId(socket.id);
        if (!info || !info.isHost) return;
        io.to(info.code).emit('board_control_pixel_puzzle', action);
    });

    socket.on('host_set_current_player', (playerId) => {
        const info = getSessionBySocketId(socket.id);
        if (!info || !info.isHost) return;

        const { session, code } = info;
        if (!playerId || !session.players[playerId] || !isPlayerInQuiz(session, playerId)) return;

        setTurnPlayer(session, playerId);
        session.currentBuzzWinnerId = session.currentTurnPlayerId;

        if (!session.currentTurnPlayerId) return;
        emitCurrentTurn(session, code);
    });

    socket.on('host_toggle_player_excluded', (data) => {
        const info = getSessionBySocketId(socket.id);
        if (!info || !info.isHost) return;

        const { session, code } = info;
        const player = session.players[data.playerId];
        if (!player) return;

        player.excluded = !!data.excluded;

        if (player.excluded) {
            session.lockedPlayers = (session.lockedPlayers || []).filter((pid) => pid !== player.id);
            session.eleminationEliminatedPlayerIds = (session.eleminationEliminatedPlayerIds || []).filter((pid) => pid !== player.id);
            delete session.mapGuesses[player.id];
            delete session.estimateGuesses[player.id];
            delete session.freetextAnswers[player.id];

            if (session.currentTurnPlayerId === player.id || session.currentBuzzWinnerId === player.id) {
                advanceTurnPlayer(session, { skipEleminated: session.activeQuestion?.type === 'elemination' });
                session.currentBuzzWinnerId = session.currentTurnPlayerId;
            }
        }

        io.to(code).emit('update_player_list', session.players);
        io.to(session.hostSocketId).emit('update_host_controls', {
            buzzWinnerId: session.currentBuzzWinnerId,
            buzzWinnerName: session.currentBuzzWinnerId && session.players[session.currentBuzzWinnerId]
                ? session.players[session.currentBuzzWinnerId].name
                : undefined,
            chooserPlayerId: session.currentTurnPlayerId,
            chooserPlayerName: session.currentTurnPlayerId && session.players[session.currentTurnPlayerId]
                ? session.players[session.currentTurnPlayerId].name
                : undefined,
            eleminationEliminatedPlayerIds: [...(session.eleminationEliminatedPlayerIds || [])]
        });
        io.to(code).emit('update_scores', session.players);

        if (session.currentTurnPlayerId) {
            emitCurrentTurn(session, code);
        }
    });

    socket.on('host_unlock_buzzers', () => {
        const info = getSessionBySocketId(socket.id);
        if (!info || !info.isHost) return;

        const { session, code } = info;
        const qType = session.activeQuestion?.type;
        if (!qType) return;
        if (qType === 'elemination' || qType === 'map' || qType === 'estimate' || qType === 'freetext') return;

        session.currentBuzzWinnerId = null;
        session.buzzersActive = true;
        io.to(code).emit('buzzers_unlocked', []);
        io.to(session.hostSocketId).emit('update_host_controls', {
            buzzWinnerId: null,
            buzzWinnerName: null
        });
    });

    socket.on('music_control', (data) => {
        const info = getSessionBySocketId(socket.id);
        
        if (info) {
            io.to(info.code).emit('music_control', data);
        }
    });

    socket.on('host_close_question', () => {
        const info = getSessionBySocketId(socket.id);
        if (!info || !info.isHost) return;
        closeActiveQuestion(info.session, info.code);
    });

    socket.on('host_end_session', () => {
        const info = getSessionBySocketId(socket.id);
        if (!info || !info.isHost) return;
        io.to(info.code).emit('session_ended');
        delete sessions[info.code];
    });

    socket.on('disconnect', () => {
        const info = getSessionBySocketId(socket.id);
        if (info && info.isPlayer && info.playerId) {
            info.session.players[info.playerId].active = false;
            io.to(info.session.hostSocketId).emit('update_host_controls', {
                chooserPlayerId: info.session.currentTurnPlayerId,
                chooserPlayerName: info.session.currentTurnPlayerId && info.session.players[info.session.currentTurnPlayerId]
                    ? info.session.players[info.session.currentTurnPlayerId].name
                    : undefined,
                buzzWinnerId: info.session.currentBuzzWinnerId,
                buzzWinnerName: info.session.currentBuzzWinnerId && info.session.players[info.session.currentBuzzWinnerId]
                    ? info.session.players[info.session.currentBuzzWinnerId].name
                    : undefined
            });
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
        if (!isPlayerInQuiz(session, info.playerId)) return;

        // Speichern
        session.estimateGuesses[info.playerId] = val;

        // Host updaten
        const count = Object.keys(session.estimateGuesses).length;
        const total = getInQuizPlayerCount(session);
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
        if (info && info.isHost) {
            // Leite den Befehl an alle Clients im Raum (also das Board) weiter
            io.to(info.code).emit('board_media_control', data);
        }
    });
});

function startServer(port: number = PORT) {
    const onError = (err: NodeJS.ErrnoException) => {
        if (err?.code === 'EADDRINUSE') {
            console.warn(`Port ${port} ist bereits belegt. Wahrscheinlich laeuft bereits ein Server-Prozess.`);
            if (process.env.NODE_ENV !== 'test') {
                process.exit(0);
            }
            return;
        }
        console.error('Server-Startfehler:', err);
        if (process.env.NODE_ENV !== 'test') {
            process.exit(1);
        }
    };

    server.once('error', onError);
    server.listen(port, () => {
        server.off('error', onError);
        console.log(`Server läuft auf http://localhost:${port}`);
    });
}

function bootstrapServer(
    nodeEnv: string | undefined = process.env.NODE_ENV,
    connectFn: () => Promise<void> = () => connectDatabase(),
    startFn: () => void = () => startServer()
) {
    if (nodeEnv !== 'test') {
        connectFn().catch(err => console.error('MongoDB Fehler:', err));
        startFn();
    }
}

bootstrapServer();

export { app, server, io, sessions, connectDatabase, startServer, PUBLIC_DIR, UPLOADS_DIR };
export {
    generateRoomCode,
    getLocalIpAddress,
    deleteMediaFile,
    calculateDistance,
    isPointInPolygon,
    getEleminationRemainingPlayerIds,
    isValidGamePayload,
    runCleanupUnusedFilesSafely,
    bootstrapServer,
};