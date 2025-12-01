import { socket } from './socket';
import { IGame, IPlayer, IQuestion, ICategory } from '../../src/types';

// --- STATE ---
let roomCode: string | null = null;
let currentGame: IGame | null = null;
let players: Record<string, IPlayer> = {};
let activeQuestion: IQuestion | null = null;
let activePlayerId: string | null = null;
let isPlaying: boolean = false;

// --- DOM ELEMENTE ---
const controlsDiv = document.getElementById('controls') as HTMLDivElement;
const hostGrid = document.getElementById('host-grid') as HTMLDivElement;
const sidebar = document.getElementById('sidebar') as HTMLDivElement;
const roomCodeDisplay = document.getElementById('room-code-display') as HTMLParagraphElement;
const boardUrl = document.getElementById('board-url') as HTMLAnchorElement;
const playerCountSpan = document.getElementById('player-count') as HTMLSpanElement;
const playerListUl = document.getElementById('player-list') as HTMLUListElement;

const activeQSection = document.getElementById('active-question-section') as HTMLDivElement;
const qTitle = document.getElementById('question-title') as HTMLHeadingElement;
const qDisplay = document.getElementById('question-display') as HTMLDivElement;
const aDisplay = document.getElementById('answer-display') as HTMLDivElement;

const buzzWinnerSection = document.getElementById('buzz-winner-section') as HTMLDivElement;
const buzzWinnerName = document.getElementById('buzz-winner-name') as HTMLSpanElement;
const correctBtn = document.getElementById('correct-btn') as HTMLButtonElement;
const incorrectBtn = document.getElementById('incorrect-btn') as HTMLButtonElement;
const unlockBuzzersBtn = document.getElementById('unlock-buzzers-btn') as HTMLButtonElement;
const closeQuestionBtn = document.getElementById('close-question-btn') as HTMLButtonElement;
const toggleQRBtn = document.getElementById('toggle-qr-btn') as HTMLButtonElement;
const exitQuizBtn = document.getElementById('exit-quiz-btn') as HTMLButtonElement;

const mapModeControls = document.getElementById('map-mode-controls') as HTMLDivElement;
const mapSubmittedCount = document.getElementById('map-submitted-count') as HTMLSpanElement;
const resolveMapBtn = document.getElementById('resolve-map-btn') as HTMLButtonElement;
const themeToggleBtn = document.getElementById('theme-toggle-btn') as HTMLButtonElement;

// --- INIT & EVENT LISTENER (Statische Elemente) ---

document.addEventListener('DOMContentLoaded', () => {
    // 1. Prüfen auf gespeicherte Session
    const savedSession = localStorage.getItem('jeopardy_host_session');
    
    if (savedSession) {
        try {
            const data = JSON.parse(savedSession);
            // Rejoin versuchen statt neu erstellen
            socket.emit('host_rejoin_session', data.roomCode);
            return; 
        } catch (e) {
            localStorage.removeItem('jeopardy_host_session');
        }
    }

    // 2. Fallback: Neu erstellen
    const gameId = new URLSearchParams(window.location.search).get('gameId');
    if (gameId) {
        socket.emit('host_create_session', gameId);
    } else {
        window.location.href = '/create.html';
    }
});

// Steuerung Button Listener
correctBtn.addEventListener('click', () => activePlayerId && socket.emit('host_score_answer', { action: 'correct', playerId: activePlayerId }));
incorrectBtn.addEventListener('click', () => activePlayerId && socket.emit('host_score_answer', { action: 'incorrect', playerId: activePlayerId }));
unlockBuzzersBtn.addEventListener('click', () => socket.emit('host_unlock_buzzers'));
closeQuestionBtn.addEventListener('click', () => socket.emit('host_close_question'));
toggleQRBtn.addEventListener('click', () => socket.emit('host_toggle_qr'));
resolveMapBtn.addEventListener('click', () => socket.emit('host_resolve_map'));
themeToggleBtn.addEventListener('click', toggleTheme);

exitQuizBtn.addEventListener('click', () => {
    if(confirm("Session wirklich beenden?")) {
        socket.emit('host_end_session');
        window.location.href = '/create.html';
    }
});

toggleTheme();

// --- 1. SOCKET EVENTS (Server Antworten) ---

socket.on('session_created', (code) => {
    setupSessionUI(code);
    
    // In LocalStorage speichern
    const gameId = new URLSearchParams(window.location.search).get('gameId');
    if (gameId) {
        localStorage.setItem('jeopardy_host_session', JSON.stringify({ roomCode: code, gameId }));
        socket.emit('host_start_game', gameId);
    }
    
});

// B) Rejoin erfolgreich
socket.on('session_rejoined', (data: { roomCode: string, gameId: string }) => {
    console.log("Erfolgreich rejoined!");
    setupSessionUI(data.roomCode);
    
    // Sicherheitshalber Storage erneuern
    localStorage.setItem('jeopardy_host_session', JSON.stringify({ roomCode: data.roomCode, gameId: data.gameId }));
});

socket.on('host_session_restored', (data: any) => {
    console.log("Session wiederhergestellt:", data);

    // 1. Basis-Infos setzen
    roomCode = data.roomCode;
    currentGame = data.game;
    players = data.players;
    
    if(roomCodeDisplay) roomCodeDisplay.innerText = `Raum: ${roomCode}`;

    // 2. Grid neu aufbauen
    renderGameGrid(data.game);
    
    // 3. Spielerliste aktualisieren
    renderPlayerList();
    
    // 4. Aktive Frage wiederherstellen (falls gerade eine lief)
    if (data.activeQuestion) {
        activeQuestion = data.activeQuestion;
        renderActiveQuestion(data.activeQuestion);
        // Falls nötig: Buzzer-Status prüfen (das wäre der nächste Optimierungsschritt)
    }

    // 5. WICHTIG: Bereits gespielte Fragen ausgrauen
    if (data.usedQuestions && Array.isArray(data.usedQuestions)) {
        data.usedQuestions.forEach((item: {catIndex: number, qIndex: number}) => {
            markQuestionAsUsed(item.catIndex, item.qIndex);
        });
    }
    
    // 6. Musiksteuerung initialisieren
    initMusic(data.game);
});

// C) Rejoin fehlgeschlagen (z.B. Server Neustart)
socket.on('host_rejoin_error', () => {
    console.warn("Rejoin fehlgeschlagen - Session nicht gefunden.");
    localStorage.removeItem('jeopardy_host_session');
    
    // Versuche neu zu erstellen, falls wir noch auf der URL sind
    const gameId = new URLSearchParams(window.location.search).get('gameId');
    if (gameId) {
        socket.emit('host_create_session', gameId);
    } else {
        alert("Sitzung abgelaufen. Bitte neu starten.");
        window.location.href = '/create.html';
    }
});

socket.on('load_game_on_host', (game: IGame) => {
    currentGame = game;
    initMusic(game);
    renderGameGrid(game);
});

socket.on('update_player_list', (updatedPlayers) => {
    players = updatedPlayers;
    renderPlayerList();
});

socket.on('update_scores', (updatedPlayers) => {
    players = updatedPlayers;
    renderPlayerList();
});

socket.on('player_won_buzz', (data) => {
    activePlayerId = data.id;
    // JETZT funktioniert der Aufruf, weil die Funktion unten definiert ist
    updateHostControls({
        buzzWinnerId: data.id,
        buzzWinnerName: data.name,
        mapMode: false 
    });
});

// Wir nutzen die Funktion als Handler für das Server-Event
socket.on('update_host_controls', updateHostControls);

socket.on('host_update_map_status', (data) => {
    mapSubmittedCount.innerText = `${data.submittedCount}/${data.totalPlayers}`;
});

socket.on('host_restore_active_question', (data) => {
    console.log("Stelle aktive Frage wieder her:", data);
    
    // UI auf "Frage aktiv" schalten
    activeQuestion = data.question;
    activeQSection.style.display = 'block';
    qTitle.innerText = `${currentGame?.categories[data.catIndex]?.name || 'Frage'} - ${data.question.points} Punkte`;
    
    // Inhalte rendern
    qDisplay.innerHTML = renderQuestionContent(data.question, 'question');
    aDisplay.innerHTML = renderQuestionContent(data.question, 'answer');

    // Button als "used" markieren
    const btn = document.getElementById(`q-btn-${data.catIndex}-${data.qIndex}`);
    if (btn) btn.classList.add('used');

    // Map Modus Controls prüfen
    if (data.question.type === 'map') {
        buzzWinnerSection.style.display = 'none';
        mapModeControls.style.display = 'flex';
        unlockBuzzersBtn.style.display = 'none';
        
        // Zähler aktualisieren
        mapSubmittedCount.innerText = `${data.mapGuessesCount}/${Object.keys(players).length}`;
    } else {
        // Standard Modus
        buzzWinnerSection.style.display = 'none';
        mapModeControls.style.display = 'none';
        
        if (data.buzzersActive) {
            unlockBuzzersBtn.style.display = 'none'; // Läuft schon
        } else {
            unlockBuzzersBtn.style.display = 'block'; // Manuell freigeben
        }
    }
});


// --- HELPER FUNKTION (Die fehlte vorher als eigenständige Funktion) ---

function updateHostControls(data: { buzzWinnerId?: string | null, buzzWinnerName?: string, mapMode?: boolean, submittedCount?: number }) {
    
    // 1. Buzzer Gewinner Logik
    if (data.buzzWinnerId) {
        activePlayerId = data.buzzWinnerId;
        buzzWinnerName.innerText = data.buzzWinnerName || 'Spieler';
        buzzWinnerSection.style.display = 'block';
        unlockBuzzersBtn.style.display = 'none';
        mapModeControls.style.display = 'none';

    } else if (data.buzzWinnerId === null) {
        // Reset
        activePlayerId = null;
        buzzWinnerSection.style.display = 'none';
        unlockBuzzersBtn.style.display = 'block';
    }

    // 2. Map Modus Logik
    if (data.mapMode !== undefined) {
        activePlayerId = null; // Kein Buzzer-Gewinner im Map Modus
        buzzWinnerSection.style.display = 'none';
        mapModeControls.style.display = data.mapMode ? 'flex' : 'none';
        
        if (!data.mapMode) {
            unlockBuzzersBtn.style.display = 'none';
        }
    }

    // 3. Zähler Update
    if (data.submittedCount !== undefined) {
        mapSubmittedCount.innerText = `${data.submittedCount}/${Object.keys(players).length}`;
    }
}
// --- 2. RENDER FUNKTIONEN ---

function renderGameGrid(game: IGame) {
    hostGrid.innerHTML = '';
    
    // Grid Spalten (Kategorien)
    game.categories.forEach((cat, catIndex) => {
        const col = document.createElement('div');
        col.className = 'host-col';
        col.innerHTML = `<div class="host-cat-title">${cat.name}</div>`;

        // Fragen-Buttons
        cat.questions.forEach((q, qIndex) => {
            const btn = document.createElement('button');
            btn.className = `q-btn`;
            btn.innerText = q.points.toString();
            btn.id = `q-btn-${catIndex}-${qIndex}`;

            btn.addEventListener('click', () => handleQuestionClick(q, catIndex, qIndex));
            col.appendChild(btn);
        });

        hostGrid.appendChild(col);
    });
}

function handleQuestionClick(question: IQuestion, catIndex: number, qIndex: number) {
    if (!roomCode) return;
    
    // 1. Frage als aktiv setzen
    activeQuestion = question;
    activeQSection.style.display = 'block';
    qTitle.innerText = `${currentGame?.categories[catIndex].name} - ${question.points} Punkte`;
    qDisplay.innerHTML = renderQuestionContent(question, 'question');
    aDisplay.innerHTML = renderQuestionContent(question, 'answer');
    
    // 2. Zustand auf dem Board aktualisieren
    socket.emit('host_pick_question', { catIndex, qIndex, question });
    
    // 3. UI updaten (Map oder Buzzer)
    if (question.type === 'map') {
        buzzWinnerSection.style.display = 'none';
        mapModeControls.style.display = 'flex';
        mapSubmittedCount.innerText = `0/${Object.keys(players).length}`;
        unlockBuzzersBtn.style.display = 'none';
    } else {
        buzzWinnerSection.style.display = 'none';
        mapModeControls.style.display = 'none';
        // Buzzer Unlock erfolgt durch Server nach 'host_pick_question'
    }

    markQuestionAsUsed(catIndex, qIndex);
}

function renderPlayerList() {
    playerListUl.innerHTML = '';
    const activePlayers = Object.values(players).filter(p => p.active);
    playerCountSpan.innerText = activePlayers.length.toString();

    activePlayers.sort((a, b) => b.score - a.score).forEach(p => {
        const item = document.createElement('li');
        item.className = 'player-item';
        item.style.color = p.color; // Farbe anzeigen
        item.innerHTML = `
            <span>${p.name}</span>
            <span class="score">${p.score}</span>
        `;
        playerListUl.appendChild(item);
    });
}

function renderQuestionContent(q: IQuestion, part: 'question' | 'answer'): string {
    const text = part === 'question' ? q.questionText : q.answerText;
    const path = part === 'question' ? q.mediaPath : q.answerMediaPath;

    let html = `<p>${text}</p>`;

    if (path) {
        // Hier müsste man den Medientyp prüfen (Video, Audio, Image)
        // Vereinfacht für das Beispiel:
        html += `<img src="${path}" style="max-width: 100%; max-height: 200px; display: block; margin: 10px 0;">`;
    }
    
    if (part === 'answer') {
        html = `<p style="color: #28a745; font-weight: bold;">Lösung: ${text}</p>`;
        if (q.type === 'map' && q.location) {
            html += `<p style="font-style: italic;">Ziel: LAT ${q.location.lat.toFixed(4)}, LNG ${q.location.lng.toFixed(4)}</p>`;
        }
    }

    return html;
}

function setupSessionUI(code: string) {
    roomCode = code;
    roomCodeDisplay.innerText = `Raum: ${code}`;
    controlsDiv.style.display = 'flex';
    
    const boardUrlValue = `${window.location.origin}/board.html?room=${code}`;
    boardUrl.href = boardUrlValue;
    boardUrl.innerText = boardUrlValue;
}

function initTheme() {
    // Prüfen, ob schon eine Einstellung gespeichert ist
    const storedTheme = localStorage.getItem('quiz_theme');
    
    if (storedTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    if (newTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('quiz_theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('quiz_theme', 'light');
    }
}
async function initMusic(game: IGame) {

    if (!game.backgroundMusicPath) return;

    const toggleBtn = document.getElementById('btn-music-toggle');
    const volSlider = document.getElementById('music-volume') as HTMLInputElement;
    const gameId = game._id || ""; 
    let isPlaying = false; 

    if(controlsDiv) {
        controlsDiv.style.display = 'flex'; // Flexbox für unser neues Layout
    }

    if (game.backgroundMusicPath) {
        // Controls anzeigen
        const controlsDiv = document.getElementById('music-controls');
        if(controlsDiv) controlsDiv.style.display = 'flex';

        // 1. Play/Pause Button
        if(toggleBtn) {
            toggleBtn.onclick = () => {
                isPlaying = !isPlaying;
                
                // Icon wechseln
                toggleBtn.innerText = isPlaying ? "⏸" : "▶";
                toggleBtn.style.background = isPlaying ? "#e2e6ea" : "transparent";

                // Befehl an Server senden
                socket.emit('music_control', {
                    gameId: gameId, 
                    action: isPlaying ? 'play' : 'pause'
                });
            };
        }

        // 2. Lautstärke Slider
        if(volSlider) {
            volSlider.oninput = () => {
                const vol = parseFloat(volSlider.value);
                
                // Befehl an Server senden
                socket.emit('music_control', {
                    gameId: gameId,
                    action: 'volume',
                    value: vol
                });
            };
        }
    }
}

function markQuestionAsUsed(catIndex: number, qIndex: number) {
    const btn = document.getElementById(`q-btn-${catIndex}-${qIndex}`);
    if (btn) {
        btn.classList.add('used');
        //btn.disabled = true; // Optional: Button auch deaktivieren
    }
}

function renderActiveQuestion(q: IQuestion) {
    if (!q) return;

    // 1. Bereich sichtbar machen
    if (activeQSection) {
        activeQSection.style.display = 'block';
    }

    // 2. Titel setzen (Punkte)
    if (qTitle) {
        qTitle.innerText = `Frage um ${q.points} Punkte`;
    }

    // 3. Inhalt rendern (nutzt deine existierende renderQuestionContent Funktion)
    if (qDisplay) {
        qDisplay.innerHTML = renderQuestionContent(q, 'question');
    }
    if (aDisplay) {
        aDisplay.innerHTML = renderQuestionContent(q, 'answer');
    }

    // 4. Modus-Unterscheidung (Map vs. Standard/Buzzer)
    const mapControls = document.getElementById('map-mode-controls');
    const buzzControls = document.getElementById('buzz-winner-section');

    if (q.type === 'map') {
        // Map Modus: Zeige Map-Controls, verstecke Buzzer
        if (mapControls) mapControls.style.display = 'block';
        if (buzzControls) buzzControls.style.display = 'none';
        
        // Reset Map Counter Anzeige
        const mapCount = document.getElementById('map-submitted-count');
        if (mapCount) mapCount.innerText = "0/0"; // Wird später durch Events geupdated

    } else {
        // Standard Modus: Zeige Buzzer-Controls, verstecke Map
        if (mapControls) mapControls.style.display = 'none';
        if (buzzControls) buzzControls.style.display = 'block';
        
        // Reset Buzzer Name
        if (buzzWinnerName) buzzWinnerName.innerText = "";
    }
}