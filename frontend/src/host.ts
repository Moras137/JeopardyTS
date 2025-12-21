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

const freetextModeControls = document.getElementById('freetext-mode-controls') as HTMLDivElement;
const freetextSubmittedCount = document.getElementById('freetext-submitted-count') as HTMLSpanElement;
const resolveFreetextBtn = document.getElementById('resolve-freetext-btn') as HTMLButtonElement;
const freetextGradingView = document.getElementById('freetext-grading-view') as HTMLDivElement;
const freetextList = document.getElementById('freetext-list') as HTMLDivElement;
const btnPodium = document.getElementById('btn-podium') as HTMLButtonElement;

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
if(correctBtn) correctBtn.addEventListener('click', () => {
    if (activePlayerId) {
        socket.emit('host_score_answer', { action: 'correct', playerId: activePlayerId });
        buzzWinnerSection.style.display = 'none'; 
    }
});

if(incorrectBtn) incorrectBtn.addEventListener('click', () => {
    if (activePlayerId) {
        socket.emit('host_score_answer', { action: 'incorrect', playerId: activePlayerId });
        buzzWinnerSection.style.display = 'none';
        
        if(unlockBuzzersBtn) unlockBuzzersBtn.style.display = 'block';
    }
});

if(unlockBuzzersBtn) unlockBuzzersBtn.addEventListener('click', () => socket.emit('host_unlock_buzzers'));

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
if(resolveFreetextBtn) {
    resolveFreetextBtn.addEventListener('click', () => {
        socket.emit('host_resolve_freetext');
    });
}
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

if(btnPodium) {
    btnPodium.addEventListener('click', () => {
        if(confirm("Siegerehrung auf dem Board starten?")) {
            socket.emit('host_show_podium');
        }
    });
}

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
    } else if (data.question.type === 'freetext') {
        buzzWinnerSection.style.display = 'none';
        mapModeControls.style.display = 'none';
        listModeControls.style.display = 'none';
        estimateModeControls.style.display = 'none';
        pixelModeControls.style.display = 'none';
        unlockBuzzersBtn.style.display = 'none';
        
        freetextModeControls.style.display = 'flex';
        // Falls wir Antworten schon haben, könnte man sie hier laden, 
        // aber meistens passiert das erst nach 'resolve'.
        // Der Server sendet 'submittedCount' oft separat.
    } else {
        buzzWinnerSection.style.display = 'none';
        mapModeControls.style.display = 'none';
        listModeControls.style.display = 'none'; 
        estimateModeControls.style.display = 'none';
        freetextModeControls.style.display = 'none';
        pixelModeControls.style.display = 'none';   
        unlockBuzzersBtn.style.display = data.buzzersActive ? 'none' : 'block';
    }

    if (freetextGradingView) freetextGradingView.style.display = 'none';
});

socket.on('board_hide_question', () => {
     activeQSection.style.display = 'none';
});

socket.on('host_update_estimate_status', (data) => {
    if(estimateSubmittedCount) estimateSubmittedCount.innerText = `${data.submittedCount}/${data.totalPlayers}`;
    if(freetextSubmittedCount) freetextSubmittedCount.innerText = `${data.submittedCount}/${data.totalPlayers}`;
});

socket.on('board_show_freetext_results', (data) => {
    renderFreetextGradingList(data.answers);
});

socket.on('host_freetext_grading_status', (data) => {
    renderFreetextGradingList(data.answers);
});

socket.on('host_update_freetext_buttons', (data) => {
    updateFreetextButtonStyles(data.playerId, data.status);
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
                btnIntroNext.innerText = data.nextIntroStep;
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
            unlockBuzzersBtn.style.display = 'block';
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

    if (data.freetextMode !== undefined) {
        activePlayerId = null;
        buzzWinnerSection.style.display = 'none';
        mapModeControls.style.display = 'none';
        listModeControls.style.display = 'none';
        estimateModeControls.style.display = 'none';
        unlockBuzzersBtn.style.display = 'none'; // Keine Buzzer

        freetextModeControls.style.display = data.freetextMode ? 'flex' : 'none';
        
        // Zähler nutzen wir denselben Generic Count oder ein eigenes Feld
        // Im Server hatten wir 'submittedCount' allgemein gesendet
        if (data.submittedCount !== undefined && data.freetextMode) {
             freetextSubmittedCount.innerText = `${data.submittedCount}/${Object.keys(players).length}`;
        }
    }
    
    if (data.submittedCount !== undefined && freetextModeControls.style.display === 'flex') {
        freetextSubmittedCount.innerText = `${data.submittedCount}/${Object.keys(players).length}`;
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

    setTimeout(adjustHeaderHeights, 50);
}

function handleQuestionClick(question: IQuestion, catIndex: number, qIndex: number) {
    if (!roomCode) return;
    
    activeQuestion = question;
    activeQSection.style.display = 'flex'; // Overlay zeigen
    qTitle.innerText = `${currentGame?.categories[catIndex].name} - ${question.points} Punkte`;
    qDisplay.innerHTML = renderQuestionContent(question, 'question');
    aDisplay.innerHTML = renderQuestionContent(question, 'answer');
    
    socket.emit('host_pick_question', { catIndex, qIndex, question });
    
    // --- RESET ALLER MODI ---
    mapModeControls.style.display = 'none';
    listModeControls.style.display = 'none';
    buzzWinnerSection.style.display = 'none';
    pixelModeControls.style.display = 'none';
    estimateModeControls.style.display = 'none';
    freetextModeControls.style.display = 'none'; 
    unlockBuzzersBtn.style.display = 'none';
    // -----------------------------------

    if (question.type === 'map') {
        mapModeControls.style.display = 'flex';
        mapSubmittedCount.innerText = `0/${Object.keys(players).length}`;
    
    } else if (question.type === 'list') {
        listModeControls.style.display = 'block';
        unlockBuzzersBtn.style.display = 'block'; 
        
        if (question.listItems) {
            updateListPreview(question.listItems, -1); 
        }

    } else if (question.type === 'pixel') {
        pixelModeControls.style.display = 'flex';
        unlockBuzzersBtn.style.display = 'block';
        qTitle.innerText += " (PIXEL PUZZLE)";
        
    } else if (question.type === 'estimate') {
        estimateModeControls.style.display = 'flex';
        estimateSubmittedCount.innerText = `0/${Object.keys(players).length}`;

    } else if (question.type === 'freetext') {
        freetextModeControls.style.display = 'flex';
        freetextSubmittedCount.innerText = `0/${Object.keys(players).length}`;

    } else {
        unlockBuzzersBtn.style.display = 'block';
    }

    markQuestionAsUsed(catIndex, qIndex);
}

function renderPlayerList() {
    playerListUl.innerHTML = '';
    
    // Alle Spieler holen (auch inaktive)
    const allPlayers = Object.values(players);
    if(playerCountSpan) playerCountSpan.innerText = allPlayers.length.toString();

    // Sortieren und anzeigen
    allPlayers.sort((a, b) => b.score - a.score).forEach(p => {
        const item = document.createElement('li');
        item.className = 'player-item';
        
        // Visuelles Feedback wenn offline
        if (!p.active) {
            item.style.opacity = '0.5';
            item.style.filter = 'grayscale(100%)';
        }

        // --- Linke Seite: Name ---
        const nameSpan = document.createElement('span');
        nameSpan.style.color = p.color;
        nameSpan.style.fontWeight = 'bold';
        nameSpan.innerHTML = `${p.name} ${!p.active ? '<small>(Offline)</small>' : ''}`;

        // --- Rechte Seite: Score + Edit Button ---
        const scoreContainer = document.createElement('div');
        scoreContainer.style.display = 'flex';
        scoreContainer.style.alignItems = 'center';
        scoreContainer.style.gap = '8px';

        const scoreSpan = document.createElement('span');
        scoreSpan.className = 'score';
        scoreSpan.innerText = p.score.toString();

        // Edit Button (Stift)
        const editBtn = document.createElement('button');
        editBtn.innerText = '✎';
        editBtn.title = 'Punkte korrigieren';
        editBtn.style.background = 'transparent';
        editBtn.style.border = '1px solid #ccc';
        editBtn.style.borderRadius = '4px';
        editBtn.style.cursor = 'pointer';
        editBtn.style.padding = '0px 5px';
        editBtn.style.fontSize = '0.8rem';
        editBtn.style.color = '#555';

        // Klick-Event für Korrektur
        editBtn.onclick = () => {
            const input = prompt(`Neue Punktzahl für ${p.name}:`, p.score.toString());
            if (input !== null) {
                const newScore = parseInt(input);
                if (!isNaN(newScore)) {
                    socket.emit('host_manual_score_update', { playerId: p.id, newScore });
                } else {
                    alert("Bitte eine gültige Zahl eingeben.");
                }
            }
        };

        scoreContainer.appendChild(scoreSpan);
        scoreContainer.appendChild(editBtn);

        item.appendChild(nameSpan);
        item.appendChild(scoreContainer);

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

function adjustHeaderHeights() {
    const titles = document.querySelectorAll('.host-cat-title') as NodeListOf<HTMLElement>;
    if (titles.length === 0) return;

    // 1. Höhe zurücksetzen (wichtig falls das Fenster kleiner gezogen wird)
    titles.forEach(t => t.style.height = 'auto');

    // 2. Maximale Höhe ermitteln
    let maxHeight = 0;
    titles.forEach(t => {
        if (t.offsetHeight > maxHeight) {
            maxHeight = t.offsetHeight;
        }
    });

    // 3. Allen Elementen die gleiche Höhe geben
    titles.forEach(t => {
        t.style.height = `${maxHeight}px`;
    });
}

function renderFreetextGradingList(answers: any[]) {
    if(!freetextGradingView || !freetextList) return;
    
    freetextGradingView.style.display = 'block';
    freetextList.innerHTML = '';

    answers.forEach((entry) => {
        const row = document.createElement('div');
        // Wir nutzen jetzt die CSS Klasse statt inline styles
        row.className = 'grading-row'; 
        row.id = `grading-row-${entry.playerId}`;

        row.innerHTML = `
            <div style="flex-grow:1; padding-right: 10px;">
                <div class="grading-name">${entry.name}</div>
                <div class="grading-text">${entry.text}</div>
            </div>
            <div style="display:flex; gap:8px; flex-shrink: 0;">
                <button class="host-btn btn-correct" id="btn-correct-${entry.playerId}" data-pid="${entry.playerId}" style="background:#e0e0e0; min-width: 40px;">✔</button>
                <button class="host-btn btn-incorrect" id="btn-incorrect-${entry.playerId}" data-pid="${entry.playerId}" style="background:#e0e0e0; min-width: 40px;">✘</button>
            </div>
        `;
        
        freetextList.appendChild(row);
        
        // Initialen Status setzen
        if (entry.status) {
            updateFreetextButtonStyles(entry.playerId, entry.status);
        }
    });

    // Event Listener für Buttons (wie gehabt)
    freetextList.querySelectorAll('.btn-correct').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const pid = (e.target as HTMLElement).dataset.pid;
            if(pid) socket.emit('host_score_answer', { action: 'correct', playerId: pid });
        });
    });

    freetextList.querySelectorAll('.btn-incorrect').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const pid = (e.target as HTMLElement).dataset.pid;
            if(pid) socket.emit('host_score_answer', { action: 'incorrect', playerId: pid });
        });
    });
}

function updateFreetextButtonStyles(playerId: string, status: 'correct' | 'incorrect' | undefined) {
    const row = document.getElementById(`grading-row-${playerId}`);
    const btnCor = document.getElementById(`btn-correct-${playerId}`);
    const btnInc = document.getElementById(`btn-incorrect-${playerId}`);

    if (!row || !btnCor || !btnInc) return;

    // 1. Reset: Alle Status-Klassen entfernen & Buttons grau machen
    row.classList.remove('correct', 'incorrect');
    
    btnCor.style.background = '#e0e0e0';
    btnCor.style.color = '#333';
    btnCor.style.border = '1px solid #ccc';
    
    btnInc.style.background = '#e0e0e0';
    btnInc.style.color = '#333';
    btnInc.style.border = '1px solid #ccc';

    // 2. Status anwenden (Klassen hinzufügen)
    if (status === 'correct') {
        row.classList.add('correct');
        
        // Button Highlight
        btnCor.style.background = '#28a745';
        btnCor.style.color = 'white';
        btnCor.style.border = '1px solid #1e7e34';

    } else if (status === 'incorrect') {
        row.classList.add('incorrect');
        
        // Button Highlight
        btnInc.style.background = '#dc3545';
        btnInc.style.color = 'white';
        btnInc.style.border = '1px solid #bd2130';
    }
}