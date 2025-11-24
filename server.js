const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises'); // Dateisystem-Modul für asynchrone Operationen

// --- SETUP ---
const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = 3000;

// Middleware
app.use(express.static('public'));
app.use(express.json());

// --- MONGODB VERBINDUNG ---
const DB_URI = 'mongodb://localhost:27017/jeopardyquiz';
mongoose.connect(DB_URI)
    .then(() => console.log('MongoDB verbunden'))
    .catch(err => console.error('MongoDB Verbindungsfehler:', err));

// --- MODELL IMPORTIEREN ---
const Game = require('./models/Quiz');

// --- SESSION MANAGEMENT ---
// Hier speichern wir alle aktiven Räume.
// Struktur: { "1234": { players: {}, buzzersActive: false, activeQuestion: null, ... } }
const sessions = {};

// Hilfsfunktion: Zufälligen 4-stelligen Raumcode generieren
function generateRoomCode() {
    let code;
    do {
        code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (sessions[code]); // Sicherstellen, dass er einzigartig ist
    return code;
}

// Hilfsfunktion: Session anhand der Socket-ID finden (für Disconnects etc.)
function getSessionBySocketId(socketId) {
    for (const [code, session] of Object.entries(sessions)) {
        // Prüfen ob Host
        if (session.hostSocketId === socketId) return { code, session, isHost: true };
        // Prüfen ob Board
        if (session.boardSocketId === socketId) return { code, session, isBoard: true };
        // Prüfen ob Spieler
        for (const pId in session.players) {
            if (session.players[pId].socketId === socketId) {
                return { code, session, playerId: pId, isPlayer: true };
            }
        }
    }
    return null;
}

// --- NEUE HILFSFUNKTION ---
async function deleteMediaFile(filePath) {
    if (!filePath || filePath.startsWith('http')) return; // Keine Aktion bei leeren oder externen Pfaden

    // Baue den absoluten Pfad zum Löschen
    const absolutePath = path.join(__dirname, 'public', filePath);

    try {
        await fs.unlink(absolutePath);
        console.log(`Datei gelöscht: ${absolutePath}`);
        return true;
    } catch (error) {
        if (error.code === 'ENOENT') {
            // Datei existiert nicht, was OK ist
            console.log(`Datei existiert nicht, Löschvorgang übersprungen: ${absolutePath}`);
            return false;
        }
        console.error(`Fehler beim Löschen der Datei ${absolutePath}:`, error);
        return false;
    }
}

function calculateDistance(lat1, lng1, lat2, lng2, isCustom) {
    if (isCustom) {
        // Einfache Distanz für Bild-Karten (Pixel)
        const dx = lat1 - lat2;
        const dy = lng1 - lng2;
        return Math.sqrt(dx * dx + dy * dy);
    } else {
        // Haversine-Formel für echte Erdkarten (in km)
        const R = 6371;
        const dLat = (lat2 - lat1) * (Math.PI / 180);
        const dLng = (lng2 - lng1) * (Math.PI / 180);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }
}

// --- GLOBALE SPIELVARIABLEN ---
let players = {}; // { socketId: { name: 'PlayerName', score: 0 } }
let buzzersActive = false;
let buzzWinnerId = null;
let activeQuestionPoints = 0; // Neu: Speichert die Punkte der aktuell gespielten Frage
let currentBuzzWinnerId = null; // Neu: Speichert die Socket ID des Spielers, der gebuzzt hat
let currentLoadedGameId = null; // Neu: Speichert die aktuell geladene Spiel-ID
let currentMapGuesses = {};
let hostSocketId = null;
let activeQuestion = null;

// --- DATEI-UPLOAD (Multer) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/');
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, Date.now() + ext);
    }
});
const upload = multer({ storage: storage });

// API: Upload-Endpunkt
app.post('/api/upload', upload.single('mediaFile'), (req, res) => {
    if (req.file) {
        // Pfad relativ zum "public" Ordner zurückgeben
        const filePath = '/uploads/' + req.file.filename;
        res.json({ success: true, filePath: filePath });
    } else {
        res.status(400).json({ success: false, error: 'Keine Datei hochgeladen.' });
    }
});

// --- API ENDPUNKTE FÜR QUIZ VERWALTUNG ---

// API: Alle Spiele auflisten (für Host und Create)
app.get('/api/games', async (req, res) => {
    try {
        const games = await Game.find().select('_id title'); // Nur ID und Titel
        res.json(games);
    } catch (err) {
        res.status(500).json({ error: 'Fehler beim Laden der Spiele' });
    }
});

// API: Ein einzelnes Spiel anhand der ID laden (für Bearbeiten)
app.get('/api/games/:id', async (req, res) => {
    try {
        const game = await Game.findById(req.params.id);
        if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden' });
        res.json(game);
    } catch (err) {
        res.status(500).json({ error: 'Fehler beim Laden des Spiels' });
    }
});

// API: Spiel erstellen ODER aktualisieren
app.post('/api/create-game', async (req, res) => {
    try {
        const gameData = req.body;
        let savedGame;

        if (gameData._id) {
            // UPDATEN: Wenn eine ID vorhanden ist
            savedGame = await Game.findByIdAndUpdate(
                gameData._id,
                gameData,
                { new: true, runValidators: true } // runValidators stellt sicher, dass 'title' geprüft wird
            );
        } else {
            // ERSTELLEN: Wenn keine ID vorhanden ist
            const newGame = new Game(gameData);
            savedGame = await newGame.save();
        }

        return res.json({ success: true, gameId: savedGame._id });

    } catch (err) {
        console.error(err);

        // NEU: Bessere Fehlerbehandlung für Validierungsfehler (nur Titel)
        if (err.name === 'ValidationError') {
            const messages = [];
            for (const field in err.errors) {
                // Wir suchen nur nach dem 'title' Fehler, da die anderen entfernt wurden
                if (field === 'title') {
                    messages.push("Der Titel des Quiz ist erforderlich.");
                }
            }
            // Wenn der Titel fehlt, senden wir eine spezifische Meldung zurück
            if (messages.length > 0) {
                return res.status(400).json({ success: false, error: messages.join(' ') });
            }
        }

        res.status(500).json({ success: false, error: "Unbekannter Fehler beim Speichern." });
    }
});

app.post('/start-game/:gameId', async (req, res) => {
    const { gameId } = req.params;

    // Einfache Validierung, ob die GameId vorhanden ist
    if (!gameId) {
        return res.status(400).send("Fehlende Game ID.");
    }

    try {
        const game = await Game.findById(gameId).lean();
        if (!game) {
            return res.status(404).send("Quiz nicht gefunden.");
        }
        // Setze die aktuell geladene Spiel-ID (falls auf Serverseite benötigt)
        currentLoadedGameId = gameId;
        console.log(`Quiz mit ID ${gameId} gestartet.`);

        // Leitet zum Host-Bildschirm weiter. 
        // WICHTIG: Die gameId und der Titel werden als Query-Parameter übergeben, damit host.html weiß, welches Spiel geladen werden soll.
        const titleParam = encodeURIComponent(game.title || "");
        res.status(200).json({ redirectUrl: `/host.html?gameId=${gameId}&title=${titleParam}` });

    } catch (error) {
        console.error("Fehler beim Starten des Quiz:", error);
        res.status(500).send("Interner Serverfehler beim Laden des Quiz.");
    }
});

// API: Ein Spiel löschen (MIT ERWEITERTEM DATEI-CLEANUP)
app.delete('/api/games/:id', async (req, res) => {
    try {
        const id = req.params.id;

        // 1. Quiz laden, um Mediendateien zu finden
        const gameToDelete = await Game.findById(id);

        if (gameToDelete) {
            // 2. Alle Mediendateien sammeln und löschen
            const mediaFiles = [];

            if (gameToDelete.boardBackgroundPath) {
                mediaFiles.push(gameToDelete.boardBackgroundPath);
            }

            gameToDelete.categories.forEach(cat => {
                cat.questions.forEach(q => {
                    // Prüfe Question Media
                    if (q.mediaPath) {
                        mediaFiles.push(q.mediaPath);
                    }
                    // Prüfe Answer Media (NEU)
                    if (q.answerMediaPath) {
                        mediaFiles.push(q.answerMediaPath);
                    }
                });
            });

            console.log(`Lösche ${mediaFiles.length} Mediendateien für Quiz ID ${id}.`);

            // Alle Löschvorgänge parallel ausführen
            await Promise.all(mediaFiles.map(deleteMediaFile));
        }

        // 3. Quiz aus der Datenbank löschen
        await Game.findByIdAndDelete(id);

        res.json({ success: true });
        console.log(`Quiz mit ID ${id} wurde gelöscht.`);
    } catch (err) {
        res.status(500).json({ error: "Konnte Quiz nicht löschen" });
    }
});

// API: Dateien löschen (Wird vom Frontend beim Speichern aufgerufen)
app.post('/api/delete-files', async (req, res) => {
    const files = req.body.files || [];

    if (files.length === 0) {
        return res.json({ success: true, message: 'Keine Dateien zum Löschen übermittelt.' });
    }

    try {
        await Promise.all(files.map(deleteMediaFile));
        res.json({ success: true, deletedCount: files.length });
    } catch (error) {
        console.error('Fehler beim Löschen einer Dateigruppe:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Löschen der Dateien.' });
    }
});

// --- SOCKET.IO LOGIK ---

io.on('connection', socket => {
    console.log('Neuer Client verbunden:', socket.id);

    // Host erstellt eine neue Session
    socket.on('host_create_session', (gameId) => {
        const roomCode = generateRoomCode(); // Funktion muss definiert sein (siehe vorherige Antwort)

        sessions[roomCode] = {
            gameId: gameId,
            hostSocketId: socket.id,
            players: {},
            buzzersActive: false,
            currentBuzzWinnerId: null,
            activeQuestion: null,
            mapGuesses: {}
        };

        socket.join(roomCode);
        socket.emit('session_created', roomCode);
        console.log(`Session ${roomCode} gestartet.`);
    });

    // --- BOARD: BEITRETEN ---
    socket.on('board_join_session', async (roomCode) => {
        const session = sessions[roomCode];
        if (session) {
            session.boardSocketId = socket.id;
            socket.join(roomCode);
            socket.emit('board_connected_success');

            // NEU: Das Spiel aus der DB laden und an das Board senden!
            try {
                const gameData = await Game.findById(session.gameId);
                // Sende das komplette Spiel an das Board
                socket.emit('board_init_game', gameData);
            } catch (e) {
                console.error("Fehler beim Laden des Spiels für Board:", e);
            }

            // Aktuelle Scores senden
            io.to(session.boardSocketId).emit('update_scores', session.players);
            console.log(`Board ist Raum ${roomCode} beigetreten.`);

            session.buzzersActive = false;
            session.currentBuzzWinnerId = null;
            io.to(code).emit('board_hide_question');
            io.to(code).emit('update_host_controls', { buzzWinnerId: null });
        });

    // 7. Host schaltet QR Code um
    socket.on('host_toggle_qr', () => {
        const sessionInfo = getSessionBySocketId(socket.id);
        if (sessionInfo) io.to(sessionInfo.code).emit('board_toggle_qr');
    });

    // 8. SESSION BEENDEN
    socket.on('host_end_session', () => {
        const sessionInfo = getSessionBySocketId(socket.id);
        if (sessionInfo) {
            const { code } = sessionInfo;
            // Alle kicken oder informieren
            io.to(code).emit('session_ended');
            // Session löschen
            delete sessions[code];
            console.log(`Session ${code} beendet.`);
        }
    });

    // DISCONNECT
    socket.on('disconnect', () => {
        const info = getSessionBySocketId(socket.id);
        if (info) {
            const { session, code, playerId, isPlayer } = info;
            if (isPlayer) {
                console.log(`Spieler ${session.players[playerId].name} hat Verbindung verloren (Session ${code}).`);
                session.players[playerId].active = false;
                // Wir löschen ihn NICHT, damit er rejoinen kann!
                // Optional: UI Update, dass Spieler "offline" ist
            }
        }
    });

    // Host schaltet den QR-Code auf dem Board um
    socket.on('host_toggle_qr', () => {
        // Sendet das Signal an alle Clients (einschließlich des Boards)
        io.emit('board_toggle_qr');
        console.log('Server sendet Signal zum Umschalten des QR-Codes.');
    });

    // Host entsperrt Buzzer manuell
    socket.on('host_unlock_buzzers', () => {
        buzzersActive = true;
        currentBuzzWinnerId = null;
        io.emit('buzzers_unlocked');
        io.emit('update_host_controls', { buzzWinnerId: null });
    });

    // Host beendet Frage manuell (zurück zum Board)
    socket.on('host_close_question', () => {
        buzzersActive = false;
        buzzWinnerId = null;
        currentBuzzWinnerId = null;
        io.emit('board_hide_question');
        io.emit('update_host_controls', { buzzWinnerId: null });
    });

    // 2. NEU: Spieler sendet seinen Tipp
    socket.on('player_submit_map_guess', (coords) => {
        currentMapGuesses[socket.id] = coords; // { lat: ..., lng: ... }
        console.log(`Spieler ${socket.id} hat getippt.`);

        // Host informieren, wie viele abgegeben haben
        const count = Object.keys(currentMapGuesses).length;
        io.to(hostSocketId).emit('host_update_map_status', {
            submittedCount: count,
            totalPlayers: Object.keys(players).length
        });
    });
});

// --- SERVER START ---
server.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
    console.log(`Quiz erstellen: http://localhost:${PORT}/create`);
    console.log(`Host Steuerung: http://localhost:${PORT}/host`);
    console.log(`Board Ansicht: http://localhost:${PORT}/board`);
    console.log(`Spieler Buzzer: http://localhost:${PORT}/player`);
});