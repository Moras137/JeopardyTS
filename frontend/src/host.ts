import { socket } from './socket';
import { IGame, IPlayer, IQuestion, ICategory } from '../../src/types';

// --- STATE ---
let roomCode: string | null = null;
let currentGame: IGame | null = null;
let players: Record<string, IPlayer> = {};
let activeQuestion: IQuestion | null = null;
let activePlayerId: string | null = null;

// --- DOM ELEMENTE ---
const hostGrid = document.getElementById('host-grid') as HTMLDivElement;
const roomCodeDisplay = document.getElementById('room-code-display') as HTMLParagraphElement;
const boardUrl = document.getElementById('board-url') as HTMLAnchorElement;
const playerCountSpan = document.getElementById('player-count') as HTMLSpanElement;
const playerListUl = document.getElementById('player-list') as HTMLUListElement;

// Overlay / Modal Elemente
const activeQSection = document.getElementById('active-question-section') as HTMLDivElement;
const qTitle = document.getElementById('question-title') as HTMLHeadingElement;
const qDisplay = document.getElementById('question-display') as HTMLDivElement;
const aDisplay = document.getElementById('answer-display') as HTMLDivElement;
const btnCloseModalTop = document.getElementById('btn-close-modal-top') as HTMLButtonElement; // NEU

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
if(correctBtn) correctBtn.addEventListener('click', () => activePlayerId && socket.emit('host_score_answer', { action: 'correct', playerId: activePlayerId }));
if(incorrectBtn) incorrectBtn.addEventListener('click', () => activePlayerId && socket.emit('host_score_answer', { action: 'incorrect', playerId: activePlayerId }));
if(unlockBuzzersBtn) unlockBuzzersBtn.addEventListener('click', () => socket.emit('host_unlock_buzzers'));

// Beide Schließen-Buttons machen das Gleiche
const handleClose = () => socket.emit('host_close_question');
if(closeQuestionBtn) closeQuestionBtn.addEventListener('click', handleClose);
if(btnCloseModalTop) btnCloseModalTop.addEventListener('click', handleClose);

if(toggleQRBtn) toggleQRBtn.addEventListener('click', () => socket.emit('host_toggle_qr'));
if(resolveMapBtn) resolveMapBtn.addEventListener('click', () => socket.emit('host_resolve_map'));
if(themeToggleBtn) themeToggleBtn.addEventListener('click', toggleTheme);

if(exitQuizBtn) exitQuizBtn.addEventListener('click', () => {
    if(confirm("Session wirklich beenden?")) {
        socket.emit('host_end_session');
        window.location.href = '/create.html';
    }
});

toggleTheme();

// --- 1. SOCKET EVENTS (Server Antworten) ---

socket.on('session_created', (code) => {
    setupSessionUI(code);
    const gameId = new URLSearchParams(window.location.search).get('gameId');
    if (gameId) {
        localStorage.setItem('jeopardy_host_session', JSON.stringify({ roomCode: code, gameId }));
        socket.emit('host_start_game', gameId);
    }
});

socket.on('session_rejoined', (data: { roomCode: string, gameId: string }) => {
    setupSessionUI(data.roomCode);
    localStorage.setItem('jeopardy_host_session', JSON.stringify({ roomCode: data.roomCode, gameId: data.gameId }));
});

socket.on('host_session_restored', (data: any) => {
    roomCode = data.roomCode;
    currentGame = data.game;
    players = data.players;
    
    if(roomCodeDisplay) roomCodeDisplay.innerText = roomCode || '--';

    renderGameGrid(data.game);
    renderPlayerList();
    
    if (data.activeQuestion) {
        activeQuestion = data.activeQuestion;
        
        // CSS Change: Flex für Overlay
        activeQSection.style.display = 'flex'; 
        
        qTitle.innerText = `${currentGame?.categories[data.catIndex]?.name || 'Frage'} - ${data.question.points} Punkte`;
        qDisplay.innerHTML = renderQuestionContent(data.question, 'question');
        aDisplay.innerHTML = renderQuestionContent(data.question, 'answer');

        const btn = document.getElementById(`q-btn-${data.catIndex}-${data.qIndex}`);
        if (btn) btn.classList.add('used');

        if (data.question.type === 'map') {
            buzzWinnerSection.style.display = 'none';
            mapModeControls.style.display = 'flex';
            unlockBuzzersBtn.style.display = 'none';
            mapSubmittedCount.innerText = `${data.mapGuessesCount}/${Object.keys(players).length}`;
        } else {
            buzzWinnerSection.style.display = 'none';
            mapModeControls.style.display = 'none';
            // Logik ob Buzzer aktiv oder nicht
            unlockBuzzersBtn.style.display = data.buzzersActive ? 'none' : 'block';
            
            if (data.buzzWinnerId) {
                 buzzWinnerName.innerText = players[data.buzzWinnerId]?.name || 'Spieler';
                 buzzWinnerSection.style.display = 'block';
            }
        }
        
    } else {
        activeQSection.style.display = 'none';
    }

    if (data.usedQuestions && Array.isArray(data.usedQuestions)) {
        data.usedQuestions.forEach((item: {catIndex: number, qIndex: number}) => {
            markQuestionAsUsed(item.catIndex, item.qIndex);
        });
    }
    
    initMusic(data.game);
});

socket.on('host_rejoin_error', () => {
    localStorage.removeItem('jeopardy_host_session');
    const gameId = new URLSearchParams(window.location.search).get('gameId');
    if (gameId) {
        socket.emit('host_create_session', gameId);
    } else {
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
    updateHostControls({
        buzzWinnerId: data.id,
        buzzWinnerName: data.name,
        mapMode: false 
    });
});

socket.on('update_host_controls', updateHostControls);

socket.on('host_update_map_status', (data) => {
    mapSubmittedCount.innerText = `${data.submittedCount}/${data.totalPlayers}`;
});

socket.on('host_restore_active_question', (data) => {
    activeQuestion = data.question;
    // CSS Change: Flex für Overlay
    activeQSection.style.display = 'flex';
    
    qTitle.innerText = `${currentGame?.categories[data.catIndex]?.name || 'Frage'} - ${data.question.points} Punkte`;
    qDisplay.innerHTML = renderQuestionContent(data.question, 'question');
    aDisplay.innerHTML = renderQuestionContent(data.question, 'answer');

    const btn = document.getElementById(`q-btn-${data.catIndex}-${data.qIndex}`);
    if (btn) btn.classList.add('used');

    if (data.question.type === 'map') {
        buzzWinnerSection.style.display = 'none';
        mapModeControls.style.display = 'flex';
        unlockBuzzersBtn.style.display = 'none';
        mapSubmittedCount.innerText = `${data.mapGuessesCount}/${Object.keys(players).length}`;
    } else {
        buzzWinnerSection.style.display = 'none';
        mapModeControls.style.display = 'none';
        unlockBuzzersBtn.style.display = data.buzzersActive ? 'none' : 'block';
    }
});

socket.on('board_hide_question', () => {
     activeQSection.style.display = 'none';
});

// --- HELPER FUNKTION ---

function updateHostControls(data: { buzzWinnerId?: string | null, buzzWinnerName?: string, mapMode?: boolean, submittedCount?: number }) {
    
    if (data.buzzWinnerId) {
        activePlayerId = data.buzzWinnerId;
        buzzWinnerName.innerText = data.buzzWinnerName || 'Spieler';
        buzzWinnerSection.style.display = 'block';
        unlockBuzzersBtn.style.display = 'none';
        mapModeControls.style.display = 'none';

    } else if (data.buzzWinnerId === null) {
        activePlayerId = null;
        buzzWinnerSection.style.display = 'none';
        // Wenn Map Modus AUS ist und KEIN Gewinner da ist -> Zeige "Buzzer freigeben" 
        // (außer wir sind gerade im Map Modus, aber das prüft der Block unten)
        unlockBuzzersBtn.style.display = 'block';
    }

    if (data.mapMode !== undefined) {
        activePlayerId = null; 
        buzzWinnerSection.style.display = 'none';
        mapModeControls.style.display = data.mapMode ? 'flex' : 'none';
        
        if (data.mapMode) {
            unlockBuzzersBtn.style.display = 'none';
        }
    }

    if (data.submittedCount !== undefined) {
        mapSubmittedCount.innerText = `${data.submittedCount}/${Object.keys(players).length}`;
    }
}

function renderGameGrid(game: IGame) {
    hostGrid.innerHTML = '';
    
    game.categories.forEach((cat, catIndex) => {
        const col = document.createElement('div');
        col.className = 'host-col';
        col.innerHTML = `<div class="host-cat-title">${cat.name}</div>`;

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
    
    activeQuestion = question;
    activeQSection.style.display = 'flex'; // Overlay zeigen
    qTitle.innerText = `${currentGame?.categories[catIndex].name} - ${question.points} Punkte`;
    qDisplay.innerHTML = renderQuestionContent(question, 'question');
    aDisplay.innerHTML = renderQuestionContent(question, 'answer');
    
    socket.emit('host_pick_question', { catIndex, qIndex, question });
    
    if (question.type === 'map') {
        buzzWinnerSection.style.display = 'none';
        mapModeControls.style.display = 'flex';
        mapSubmittedCount.innerText = `0/${Object.keys(players).length}`;
        unlockBuzzersBtn.style.display = 'none';
    } else {
        buzzWinnerSection.style.display = 'none';
        mapModeControls.style.display = 'none';
        unlockBuzzersBtn.style.display = 'none'; // Server unlockt automatisch
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
        item.innerHTML = `
            <span style="color:${p.color}; font-weight:bold;">${p.name}</span>
            <span class="score">${p.score}</span>
        `;
        playerListUl.appendChild(item);
    });
}

function renderQuestionContent(q: IQuestion, part: 'question' | 'answer'): string {
    const text = part === 'question' ? q.questionText : q.answerText;
    const path = part === 'question' ? q.mediaPath : q.answerMediaPath;

    let html = `<p>${text || ''}</p>`;

    if (path) {
        const lowerPath = path.toLowerCase();
        let mediaHtml = '';

        if (lowerPath.endsWith('.mp3') || lowerPath.endsWith('.wav') || lowerPath.endsWith('.ogg') || lowerPath.endsWith('.m4a')) {
            mediaHtml = `<audio controls src="${path}" style="width: 100%;">Dein Browser unterstützt kein Audio.</audio>`;
        } else if (lowerPath.endsWith('.mp4') || lowerPath.endsWith('.webm') || lowerPath.endsWith('.mov')) {
            mediaHtml = `<video controls src="${path}" style="max-height: 300px; width:100%; object-fit:contain;">Dein Browser unterstützt kein Video.</video>`;
        } else {
            mediaHtml = `<img src="${path}" style="max-height: 300px; width:100%; object-fit:contain;" alt="Medien">`;
        }
        
        html += mediaHtml;
    }
    
    if (part === 'answer') {
        html = `<p style="color: var(--color-success); font-weight: bold;">Lösung: ${text}</p>` + html;
        if (q.type === 'map' && q.location) {
            html += `<p style="font-style: italic; font-size: 0.9rem; color: var(--text-muted);">Ziel: LAT ${q.location.lat.toFixed(4)}, LNG ${q.location.lng.toFixed(4)}</p>`;
        }
    }

    return html;
}

function setupSessionUI(code: string) {
    roomCode = code;
    roomCodeDisplay.innerText = code;
    
    const boardUrlValue = `${window.location.origin}/board.html?room=${code}`;
    boardUrl.href = boardUrlValue;
}

function initTheme() {
    const storedTheme = localStorage.getItem('quiz_theme');
    if (storedTheme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
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

    const controlsDiv = document.getElementById('music-controls');
    if(controlsDiv) controlsDiv.style.display = 'flex';

    const toggleBtn = document.getElementById('btn-music-toggle');
    const volSlider = document.getElementById('music-volume') as HTMLInputElement;
    const gameId = game._id || ""; 
    let isPlaying = false; 

    if(toggleBtn) {
        toggleBtn.onclick = () => {
            isPlaying = !isPlaying;
            toggleBtn.innerText = isPlaying ? "⏸" : "▶";
            socket.emit('music_control', { gameId: gameId, action: isPlaying ? 'play' : 'pause' });
        };
    }
    if(volSlider) {
        volSlider.oninput = () => {
            socket.emit('music_control', { gameId: gameId, action: 'volume', value: parseFloat(volSlider.value) });
        };
    }
}

function markQuestionAsUsed(catIndex: number, qIndex: number) {
    const btn = document.getElementById(`q-btn-${catIndex}-${qIndex}`);
    if (btn) btn.classList.add('used');
}