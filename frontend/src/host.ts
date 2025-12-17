import { socket } from './socket';
import { IGame, IPlayer, IQuestion, ICategory } from '../../src/types';

// --- STATE ---
let roomCode: string | null = null;
let currentGame: IGame | null = null;
let players: Record<string, IPlayer> = {};
let activeQuestion: IQuestion | null = null;
let activePlayerId: string | null = null;

// --- DOM ELEMENTE ---
// Sidebar & Info
const roomCodeDisplay = document.getElementById('room-code-display') as HTMLParagraphElement;
const boardUrl = document.getElementById('board-url') as HTMLAnchorElement;
const playerCountSpan = document.getElementById('player-count') as HTMLSpanElement;
const playerListUl = document.getElementById('player-list') as HTMLUListElement;

// Buttons in Sidebar
const btnIntroNext = document.getElementById('btn-intro-next') as HTMLButtonElement; // NEU: Intro
const toggleQRBtn = document.getElementById('toggle-qr-btn') as HTMLButtonElement;
const themeToggleBtn = document.getElementById('theme-toggle-btn') as HTMLButtonElement;
const exitQuizBtn = document.getElementById('exit-quiz-btn') as HTMLButtonElement;

// Main Area
const hostGrid = document.getElementById('host-grid') as HTMLDivElement;

// Overlay / Modal Elemente
const activeQSection = document.getElementById('active-question-section') as HTMLDivElement;
const qTitle = document.getElementById('question-title') as HTMLHeadingElement;
const qDisplay = document.getElementById('question-display') as HTMLDivElement;
const aDisplay = document.getElementById('answer-display') as HTMLDivElement;
const btnCloseModalTop = document.getElementById('btn-close-modal-top') as HTMLButtonElement; 

// Controls im Modal
const buzzWinnerSection = document.getElementById('buzz-winner-section') as HTMLDivElement;
const buzzWinnerName = document.getElementById('buzz-winner-name') as HTMLSpanElement;
const correctBtn = document.getElementById('correct-btn') as HTMLButtonElement;
const incorrectBtn = document.getElementById('incorrect-btn') as HTMLButtonElement;
const unlockBuzzersBtn = document.getElementById('unlock-buzzers-btn') as HTMLButtonElement;
const closeQuestionBtn = document.getElementById('close-question-btn') as HTMLButtonElement;

const mapModeControls = document.getElementById('map-mode-controls') as HTMLDivElement;
const mapSubmittedCount = document.getElementById('map-submitted-count') as HTMLSpanElement;
const resolveMapBtn = document.getElementById('resolve-map-btn') as HTMLButtonElement;

const listModeControls = document.getElementById('list-mode-controls') as HTMLDivElement;
const listItemsPreview = document.getElementById('list-items-preview') as HTMLDivElement;
const btnRevealList = document.getElementById('btn-reveal-list') as HTMLButtonElement;

const pixelModeControls = document.getElementById('pixel-mode-controls') as HTMLDivElement;
const btnPixelPause = document.getElementById('btn-pixel-pause') as HTMLButtonElement;
const btnPixelResume = document.getElementById('btn-pixel-resume') as HTMLButtonElement;

const estimateModeControls = document.getElementById('estimate-mode-controls') as HTMLDivElement;
const estimateSubmittedCount = document.getElementById('estimate-submitted-count') as HTMLSpanElement;
const resolveEstimateBtn = document.getElementById('resolve-estimate-btn') as HTMLButtonElement;

// --- INIT & EVENT LISTENER ---

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

// Event Listener
if(correctBtn) correctBtn.addEventListener('click', () => activePlayerId && socket.emit('host_score_answer', { action: 'correct', playerId: activePlayerId }));
if(incorrectBtn) incorrectBtn.addEventListener('click', () => activePlayerId && socket.emit('host_score_answer', { action: 'incorrect', playerId: activePlayerId }));
if(unlockBuzzersBtn) unlockBuzzersBtn.addEventListener('click', () => socket.emit('host_unlock_buzzers'));

// Schließen der Frage
const handleClose = () => socket.emit('host_close_question');
if(closeQuestionBtn) closeQuestionBtn.addEventListener('click', handleClose);
if(btnCloseModalTop) btnCloseModalTop.addEventListener('click', handleClose);

// Sidebar Actions
if(toggleQRBtn) toggleQRBtn.addEventListener('click', () => socket.emit('host_toggle_qr'));
if(resolveMapBtn) resolveMapBtn.addEventListener('click', () => socket.emit('host_resolve_map'));
if(themeToggleBtn) themeToggleBtn.addEventListener('click', toggleTheme);
if(btnRevealList) btnRevealList.addEventListener('click', () => {socket.emit('host_reveal_next_list_item');});

if(btnPixelPause) btnPixelPause.addEventListener('click', () => socket.emit('host_control_pixel_puzzle', 'pause'));
if(btnPixelResume) btnPixelResume.addEventListener('click', () => socket.emit('host_control_pixel_puzzle', 'resume'));

if(resolveEstimateBtn) resolveEstimateBtn.addEventListener('click', () => socket.emit('host_resolve_estimate'));

// NEU: Intro Button
if(btnIntroNext) {
    btnIntroNext.addEventListener('click', () => {
        socket.emit('host_next_intro');
    });
}

if(exitQuizBtn) exitQuizBtn.addEventListener('click', () => {
    if(confirm("Session wirklich beenden?")) {
        socket.emit('host_end_session');
        window.location.href = '/create.html';
    }
});

toggleTheme(); // Theme init

// --- SOCKET EVENTS ---

socket.on('session_created', (code) => {
    setupSessionUI(code);
    const gameId = new URLSearchParams(window.location.search).get('gameId');
    if (gameId) {
        localStorage.setItem('jeopardy_host_session', JSON.stringify({ roomCode: code, gameId }));
        socket.emit('host_start_game', gameId);
    }
});

socket.on('session_rejoined', (data) => {
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
    
    // Frage wiederherstellen
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

// WICHTIG: Hier kommt auch das Update für den Intro-Button an
socket.on('update_host_controls', updateHostControls);

socket.on('host_update_map_status', (data) => {
    mapSubmittedCount.innerText = `${data.submittedCount}/${data.totalPlayers}`;
});

socket.on('host_restore_active_question', (data) => {
    activeQuestion = data.question;
    activeQSection.style.display = 'flex'; // Overlay zeigen
    
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
    } else if (data.question.type === 'list') {
        listModeControls.style.display = 'block';
        mapModeControls.style.display = 'none';
        
        if (data.question.listItems) {
            const idx = (data as any).listRevealedCount ?? -1;
            updateListPreview(data.question.listItems, idx);
        }
    } else if (data.question.type === 'pixel') {
        listModeControls.style.display = 'none';
        mapModeControls.style.display = 'none';
        unlockBuzzersBtn.style.display = data.buzzersActive ? 'none' : 'block';
    } else if (data.question.type === 'estimate') {
         buzzWinnerSection.style.display = 'none';
         mapModeControls.style.display = 'none';
         listModeControls.style.display = 'none';
         unlockBuzzersBtn.style.display = 'none';
         estimateModeControls.style.display = 'flex';
         // Count müsste man eigentlich mitsenden, hier Default 0 oder aus data nehmen wenn du es im Server ergänzt
    } else {
        buzzWinnerSection.style.display = 'none';
        mapModeControls.style.display = 'none';
        unlockBuzzersBtn.style.display = data.buzzersActive ? 'none' : 'block';
    }
});

socket.on('board_hide_question', () => {
     activeQSection.style.display = 'none';
});

socket.on('host_update_estimate_status', (data) => {
    if(estimateSubmittedCount) estimateSubmittedCount.innerText = `${data.submittedCount}/${data.totalPlayers}`;
});
// --- HELPER FUNKTIONEN ---

function updateHostControls(data: any) {
    
    // 1. INTRO LOGIK
    if (data.nextIntroStep !== undefined) {
        if (data.nextIntroStep === null) {
            if(btnIntroNext) btnIntroNext.style.display = 'none';
        } else {
            if(btnIntroNext) {
                btnIntroNext.style.display = 'block';
                btnIntroNext.innerText = "▶ " + data.nextIntroStep;
                // Farbe ändern wenn es "Zum Spielbrett" ist
                if(data.nextIntroStep.includes('Spielbrett')) {
                     btnIntroNext.className = "host-btn btn-success btn-full";
                } else {
                     btnIntroNext.className = "host-btn btn-warning btn-full";
                     // Style für Border zurücksetzen falls nötig
                     btnIntroNext.style.border = "2px solid white";
                }
            }
        }
    }

    // 2. BUZZER LOGIK
    if (data.buzzWinnerId !== undefined) {
        if (data.buzzWinnerId) {
            activePlayerId = data.buzzWinnerId;
            buzzWinnerName.innerText = data.buzzWinnerName || 'Spieler';
            buzzWinnerSection.style.display = 'block';
            unlockBuzzersBtn.style.display = 'none';
            mapModeControls.style.display = 'none';
        } else {
            activePlayerId = null;
            buzzWinnerSection.style.display = 'none';
            // Nur anzeigen, wenn NICHT MapMode und Frage offen
            if(activeQSection.style.display === 'flex' && mapModeControls.style.display === 'none') {
                unlockBuzzersBtn.style.display = 'block';
            }
        }
    }

    if (data.listMode !== undefined) {
        // Umschalten der Ansicht
        listModeControls.style.display = data.listMode ? 'block' : 'none';
        mapModeControls.style.display = 'none';
        
        // Wenn Liste aktiv, Buzzer Buttons meist anzeigen (da parallel gebuzzert wird)
        if (data.listMode && !activePlayerId) {
            unlockBuzzersBtn.style.display = 'block';
            buzzWinnerSection.style.display = 'none';
        }
    }

    // Wenn ein Update zum Zähler kommt (oder beim Restore)
    if (data.listRevealedCount !== undefined && activeQuestion?.listItems) {
        updateListPreview(activeQuestion.listItems, data.listRevealedCount);
    }

    // 3. MAP LOGIK
    if (data.mapMode !== undefined) {
        activePlayerId = null; 
        buzzWinnerSection.style.display = 'none';
        mapModeControls.style.display = data.mapMode ? 'flex' : 'none';
        
        if (data.mapMode) {
            unlockBuzzersBtn.style.display = 'none';
        }
    }

    // 4. MAP COUNTS
    if (data.submittedCount !== undefined) {
        mapSubmittedCount.innerText = `${data.submittedCount}/${Object.keys(players).length}`;
    }

    if (data.estimateMode !== undefined) {
        activePlayerId = null;
        buzzWinnerSection.style.display = 'none';
        mapModeControls.style.display = 'none';
        listModeControls.style.display = 'none';
        unlockBuzzersBtn.style.display = 'none'; // Keine Buzzer bei Schätzfragen
        
        estimateModeControls.style.display = data.estimateMode ? 'flex' : 'none';
    }
}

function updateListPreview(items: string[], revealedIndex: number) {
    if (!listItemsPreview) return;
    let html = '<ol style="padding-left:20px; margin:0;">';
    items.forEach((item, idx) => {
        // Styles: Aufgedeckt = Fett/Schwarz, Verdeckt = Grau
        const style = idx <= revealedIndex ? 'font-weight:bold; color:black;' : 'color:#999;';
        const status = idx === revealedIndex ? ' (AKTUELL)' : '';
        html += `<li style="${style}">${item}${status}</li>`;
    });
    html += '</ol>';
    
    // Button Text anpassen
    if (revealedIndex >= items.length - 1) {
        btnRevealList.innerText = "Alle aufgedeckt";
        btnRevealList.disabled = true;
        btnRevealList.classList.add('used');
    } else {
        btnRevealList.innerText = "Nächsten Hinweis zeigen";
        btnRevealList.disabled = false;
        btnRevealList.classList.remove('used');
    }
    
    listItemsPreview.innerHTML = html;
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
    
    mapModeControls.style.display = 'none';
    listModeControls.style.display = 'none';
    buzzWinnerSection.style.display = 'none';

    if (question.type === 'map') {
        buzzWinnerSection.style.display = 'none';
        mapModeControls.style.display = 'flex';
        mapSubmittedCount.innerText = `0/${Object.keys(players).length}`;
        unlockBuzzersBtn.style.display = 'none';
        pixelModeControls.style.display = 'none';
    } else if (question.type === 'list') {
        listModeControls.style.display = 'block';
        unlockBuzzersBtn.style.display = 'block'; // Buzzer sind an
        
        if (question.listItems) {
            updateListPreview(question.listItems, -1); // Noch nichts aufgedeckt
        }
        pixelModeControls.style.display = 'none';
    } else if (question.type === 'pixel') {
        // NEU: Pixel Puzzle Handling
        buzzWinnerSection.style.display = 'none';
        mapModeControls.style.display = 'none';
        listModeControls.style.display = 'none';
        pixelModeControls.style.display = 'flex';
        
        // Buzzer sind aktiv!
        unlockBuzzersBtn.style.display = 'block';
        
        // Optional: Hinweis im Titel ergänzen
        qTitle.innerText += " (PIXEL PUZZLE)";
        
    } else {
        buzzWinnerSection.style.display = 'none';
        mapModeControls.style.display = 'none';
        unlockBuzzersBtn.style.display = 'none';
        pixelModeControls.style.display = 'none';
    }

    markQuestionAsUsed(catIndex, qIndex);
}

function renderPlayerList() {
    playerListUl.innerHTML = '';
    const activePlayers = Object.values(players).filter(p => p.active);
    if(playerCountSpan) playerCountSpan.innerText = activePlayers.length.toString();

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
    if(roomCodeDisplay) roomCodeDisplay.innerText = code;
    
    const boardUrlValue = `${window.location.origin}/board.html?room=${code}`;
    if(boardUrl) boardUrl.href = boardUrlValue;
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