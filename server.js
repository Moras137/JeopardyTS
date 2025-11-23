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

function calculateDistance(lat1, lng1, lat2, lng2, isCustom) {
    // Bei Custom Maps (Bildern) nutzen wir einfache Pythagoras-Distanz auf Pixeln
    if (isCustom) {
        const dx = lat1 - lat2;
        const dy = lng1 - lng2;
        return Math.sqrt(dx * dx + dy * dy);
    }
    
    // Bei echten Karten: Haversine-Formel für km
    const R = 6371; // Erdradius km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLng = (lng2 - lng1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
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
    socket.on('host_start_game', async (gameid) => {
        hostSocketId = socket.id;
        try {
            const game = await Game.findById(gameid);
            if (game) {
                // Sende das volle Game-Objekt an alle Boards und den Host
                io.emit('load_game_on_board', game); 
            }
        } catch (error) {
            console.error('Fehler beim Laden des Spiels:', error);
        }
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
                
                // WICHTIG: Hier senden wir jetzt das Signal zum AUFDECKEN, 
                // anstatt die Frage zu schließen.
                // Das "board_hide_question" wurde entfernt.
                io.emit('board_reveal_answer'); 
                
                // Host-Buttons zurücksetzen (damit man nicht doppelt Punkte vergibt)
                currentBuzzWinnerId = null;
                // Sagt dem Host, dass der Buzzer-Kampf vorbei ist, aber die Frage noch offen (activeQuestionPicked bleibt im Host true)
                io.emit('update_host_controls', { buzzWinnerId: null });
                
            } else if (action === 'incorrect') {
                player.score -= activeQuestionPoints;
                
                // Bei falsch: Buzzer wieder freigeben
                currentBuzzWinnerId = null; 
                buzzersActive = true; 
                io.emit('buzzers_unlocked');
                io.emit('update_host_controls', { buzzWinnerId: null });
            }
            
            // Scores an alle senden
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

    //  host_pick_question
    socket.on('host_pick_question', (data) => {
        const { question } = data;
        activeQuestion = question; // <--- WICHTIG: Frage speichern für spätere Auswertung!
        activeQuestionPoints = question.points || 100;
        activeQuestionPicked = true;
        currentMapGuesses = {};
        
        // ... (Rest Ihrer host_pick_question Logik bleibt gleich) ...
        // (Map Mode Code, Buzzer Code, etc.)
         if (question.type === 'map') {
            buzzersActive = false; 
            io.emit('update_host_controls', { mapMode: true, submittedCount: 0 });
            io.emit('player_start_map_guess', {
                questionText: question.questionText,
                location: question.location, 
                points: question.points
            });
            io.emit('board_show_question', data);
        } else {
            // ... Standard Frage Logik ...
             buzzersActive = true;
             io.emit('update_host_controls', { buzzWinnerId: null, mapMode: false });
             io.emit('player_new_question', { text: question.questionText, points: question.points });
             io.emit('buzzers_unlocked');
             io.emit('board_show_question', data);
        }
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

    // 3. NEU: Host löst die Kartenfrage auf
    socket.on('host_resolve_map', () => {
        if (!activeQuestion || !activeQuestion.location) return;

        const targetLat = activeQuestion.location.lat;
        const targetLng = activeQuestion.location.lng;
        const isCustom = activeQuestion.location.isCustomMap;

        let bestDistance = Infinity;
        let results = {};

        // A) Abstände berechnen und Bestwert finden
        Object.keys(currentMapGuesses).forEach(playerId => {
            const guess = currentMapGuesses[playerId];
            const dist = calculateDistance(targetLat, targetLng, guess.lat, guess.lng, isCustom);
            
            results[playerId] = {
                lat: guess.lat,
                lng: guess.lng,
                distance: dist,
                scoreChange: 0 // Vorerst 0
            };

            if (dist < bestDistance) {
                bestDistance = dist;
            }
        });

        // B) Punkte an den/die Gewinner vergeben (Closest Guess)
        // Man könnte hier auch eine Toleranz einbauen, aber "Winner takes all" ist am spannendsten.
        Object.keys(results).forEach(playerId => {
            // Wer den besten Abstand hat (oder extrem nah dran ist) bekommt Punkte
            if (results[playerId].distance === bestDistance && bestDistance !== Infinity) {
                if (players[playerId]) {
                    players[playerId].score += activeQuestionPoints;
                    results[playerId].scoreChange = activeQuestionPoints;
                    results[playerId].isWinner = true;
                }
            }
        });

        // C) Daten an Clients senden
        
        // 1. Board: Zeige Karte mit allen Markern und Ergebnissen
        io.emit('board_reveal_map_results', {
            results: results, // Enthält Koordinaten + Distanz + ob gewonnen
            players: players,
            target: activeQuestion.location
        });

        // 2. Alle: Neue Punktestände sofort aktualisieren
        io.emit('update_scores', players);
        
        // 3. Host: Modus beenden
        // (Der Host kann dann manuell auf "Frage schließen" klicken)
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