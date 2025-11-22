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

// --- GLOBALE SPIELVARIABLEN ---
let players = {}; // { socketId: { name: 'PlayerName', score: 0 } }
let buzzersActive = false;
let buzzWinnerId = null;
let activeQuestionPoints = 0; // Neu: Speichert die Punkte der aktuell gespielten Frage
let currentBuzzWinnerId = null; // Neu: Speichert die Socket ID des Spielers, der gebuzzt hat


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
    const id = req.params.id;
    const game = await Game.findById(id);
    if (!game) {
      return res.status(404).json({ error: 'Spiel nicht gefunden' });
    }
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

    // Spieler tritt bei
    socket.on('player_join', (name) => {
        // Wenn der Name schon existiert, keine Duplikate zulassen
        for (const id in players) {
            if (players[id].name === name) {
                socket.emit('name_taken');
                return;
            }
        }
        
        // Spieler mit Score 0 hinzufügen
        players[socket.id] = { name: name, score: 0 }; 
        socket.emit('joined', socket.id);
        io.emit('update_player_list', players);
        io.emit('update_scores', players); // Initial Score senden
    });

    // Host wählt Spiel aus
    socket.on('host_start_game', async (gameShort) => {
        try {
            const game = await Game.findById(gameShort._id);
            if (game) {
                // Sende das volle Game-Objekt an alle Boards und den Host
                io.emit('load_game_on_board', game); 
            }
        } catch (error) {
            console.error('Fehler beim Laden des Spiels:', error);
        }
    });

    // Host wählt Frage
    socket.on('host_pick_question', (data) => {
        buzzersActive = true;
        buzzWinnerId = null;
        activeQuestionPoints = data.question.points;
        currentBuzzWinnerId = null;
        
        io.emit('buzzers_unlocked');
        io.emit('board_show_question', data);
        io.emit('update_host_controls', { buzzWinnerId: null }); // Host-Buttons zurücksetzen
    });

    // Spieler buzzt
    socket.on('player_buzz', (data) => {
        if (buzzersActive && !buzzWinnerId) {
            buzzWinnerId = data.id; 
            currentBuzzWinnerId = data.id; 
            buzzersActive = false;
            
            // Sperren für alle anderen
            io.emit('buzzers_locked'); 
            
            // Gewinner an alle senden, inklusive ID für den Host
            io.emit('player_won_buzz', { 
                name: players[data.id].name, 
                id: data.id, 
                points: activeQuestionPoints
            });
            
            // Host-Steuerung aktualisieren, um Scoring-Buttons anzuzeigen
            io.emit('update_host_controls', { 
                buzzWinnerId: data.id, 
                buzzWinnerName: players[data.id].name,
                points: activeQuestionPoints
            });
        }
    });

    // HOST: Entscheidet über die Antwort (NEU: Scoring)
    socket.on('host_score_answer', (data) => {
        const { action, playerId } = data;
        const player = players[playerId];
        
        if (player) {
            if (action === 'correct') {
                player.score += activeQuestionPoints;
                // Nach richtiger Antwort: Runde beenden
                io.emit('board_hide_question');
                
                // Host-Buttons zurücksetzen
                currentBuzzWinnerId = null;
                io.emit('update_host_controls', { buzzWinnerId: null });
                
            } else if (action === 'incorrect') {
                player.score -= activeQuestionPoints;
                // Nach falscher Antwort: Buzzers für die anderen entsperren
                currentBuzzWinnerId = null; 
                buzzersActive = true; // explizit wieder aktivieren
                io.emit('buzzers_unlocked');
                io.emit('update_host_controls', { buzzWinnerId: null });
            }
            
            // Scores an alle Clients senden
            io.emit('update_scores', players);
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

    // Trennung
    socket.on('disconnect', () => {
        console.log('Client getrennt:', socket.id);
        delete players[socket.id];
        io.emit('update_player_list', players);
        io.emit('update_scores', players);
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