import { socket } from './socket';
import { IGame, IPlayer, IQuestion, ICategory } from '../../src/types';

// --- STATE ---
let roomCode: string | null = null;
let currentGame: IGame | null = null;
let players: Record<string, IPlayer> = {};
let activeQuestion: IQuestion | null = null;
let activePlayerId: string | null = null;
let currentChooserPlayerId: string | null = null;
let eleminationRevealedIndices: number[] = [];
let eleminationEliminatedPlayerIds: string[] = [];
let eleminationRoundResolved = false;

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
const answerSeparator = document.getElementById('answer-separator') as HTMLHRElement;
const btnCloseModalTop = document.getElementById('btn-close-modal-top') as HTMLButtonElement; 

// Controls im Modal
const buzzWinnerSection = document.getElementById('buzz-winner-section') as HTMLDivElement;
const buzzWinnerName = document.getElementById('buzz-winner-name') as HTMLSpanElement;
const correctBtn = document.getElementById('correct-btn') as HTMLButtonElement;
const incorrectBtn = document.getElementById('incorrect-btn') as HTMLButtonElement;
const unlockBuzzersBtn = document.getElementById('unlock-buzzers-btn') as HTMLButtonElement;

const mapModeControls = document.getElementById('map-mode-controls') as HTMLDivElement;
const mapSubmittedCount = document.getElementById('map-submitted-count') as HTMLSpanElement;
const resolveMapBtn = document.getElementById('resolve-map-btn') as HTMLButtonElement;

const listModeControls = document.getElementById('list-mode-controls') as HTMLDivElement;
const listItemsPreview = document.getElementById('list-items-preview') as HTMLDivElement;
const btnRevealList = document.getElementById('btn-reveal-list') as HTMLButtonElement;
const eleminationModeControls = document.getElementById('elemination-mode-controls') as HTMLDivElement;
const eleminationStatus = document.getElementById('elemination-status') as HTMLDivElement;
const eleminationAnswerButtons = document.getElementById('elemination-answer-buttons') as HTMLDivElement;
const btnRevealAllElemination = document.getElementById('btn-reveal-all-elemination') as HTMLButtonElement;

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
const resolveQuestionBtn = document.getElementById('resolve-question-btn') as HTMLButtonElement;

// --- INIT & EVENT LISTENER ---

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlGameId = urlParams.get('gameId');
    const savedSessionStr = localStorage.getItem('jeopardy_host_session');
    
    let shouldRejoin = false;

    // 1. Pr�fen, ob wir rejoinen k�nnen
    if (savedSessionStr) {
        try {
            const savedData = JSON.parse(savedSessionStr);

            if (!urlGameId || (savedData.gameId === urlGameId)) {
                shouldRejoin = true;
                console.log("Versuche Rejoin mit existierender Session...");
                socket.emit('host_rejoin_session', savedData.roomCode);
            }
        } catch (e) {
            localStorage.removeItem('jeopardy_host_session');
        }
    }

    // 2. Fallback: Neue Session erstellen, wenn kein Rejoin stattfindet
    if (!shouldRejoin) {
        // Falls wir hier sind, wollen wir ein NEUES Spiel starten -> Alten Cache l�schen
        localStorage.removeItem('jeopardy_host_session');

        if (urlGameId) {
            console.log("Starte neue Session f�r GameID:", urlGameId);
            socket.emit('host_create_session', urlGameId);
        } else {
            // Keine ID vorhanden -> Zur�ck zur Auswahl
            window.location.href = '/create.html';
        }
    }
});

// Event Listener
if(correctBtn) correctBtn.addEventListener('click', () => {
    if (activePlayerId) {
        socket.emit('host_score_answer', { action: 'correct', playerId: activePlayerId });
        activePlayerId = null;
        buzzWinnerSection.style.display = 'none';
    }
});

if(incorrectBtn) incorrectBtn.addEventListener('click', () => {
    if (activePlayerId) {
        socket.emit('host_score_answer', { action: 'incorrect', playerId: activePlayerId });
        activePlayerId = null;
        buzzWinnerSection.style.display = 'none';
    }
});

if(unlockBuzzersBtn) unlockBuzzersBtn.addEventListener('click', () => socket.emit('host_unlock_buzzers'));

const handleClose = () => socket.emit('host_close_question');
if(btnCloseModalTop) btnCloseModalTop.addEventListener('click', handleClose);

// Sidebar Actions
if(toggleQRBtn) toggleQRBtn.addEventListener('click', () => socket.emit('host_toggle_qr'));
if(resolveMapBtn) resolveMapBtn.addEventListener('click', () => {
    socket.emit('host_resolve_map');
    resolveMapBtn.style.display = 'none';
});
if(themeToggleBtn) themeToggleBtn.addEventListener('click', toggleTheme);
if(btnRevealList) btnRevealList.addEventListener('click', () => {socket.emit('host_reveal_next_list_item');});
if(btnRevealAllElemination) btnRevealAllElemination.addEventListener('click', () => {
    socket.emit('host_reveal_all_elemination_answers');
});

if(btnPixelPause) btnPixelPause.addEventListener('click', () => socket.emit('host_control_pixel_puzzle', 'pause'));
if(btnPixelResume) btnPixelResume.addEventListener('click', () => socket.emit('host_control_pixel_puzzle', 'resume'));

if(resolveEstimateBtn) resolveEstimateBtn.addEventListener('click', () => {
    socket.emit('host_resolve_estimate');
    resolveEstimateBtn.style.display = 'none';
});
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

if(resolveQuestionBtn) resolveQuestionBtn.addEventListener('click', () => {
    if(confirm("Frage wirklich aufl�sen?")) {
        socket.emit('host_resolve_question');
        // UI Update: Buttons verstecken, da aufgel�st
        resolveQuestionBtn.style.display = 'none';
        if(unlockBuzzersBtn) unlockBuzzersBtn.style.display = 'none';
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

socket.on('host_session_restored', (data) => {
    console.log("Session restored:", data);

    // 1. UI RESET: Alles auf Anfangszustand
    hostGrid.style.display = 'flex'; // Grid zeigen
    activeQSection.style.display = 'none'; // Overlay erst aus, gleich an wenn n�tig
    
    // Alle Buttons verstecken
    if(unlockBuzzersBtn) unlockBuzzersBtn.style.display = 'none';
    if(resolveQuestionBtn) resolveQuestionBtn.style.display = 'none';
    if(resolveMapBtn) resolveMapBtn.style.display = 'none';
    if(resolveEstimateBtn) resolveEstimateBtn.style.display = 'none';
    eleminationRevealedIndices = [];
    eleminationEliminatedPlayerIds = [];
    eleminationRoundResolved = false;

    // Alle Modi-Controls verstecken
    mapModeControls.style.display = 'none';
    estimateModeControls.style.display = 'none';
    freetextModeControls.style.display = 'none';
    pixelModeControls.style.display = 'none';
    listModeControls.style.display = 'none';
    eleminationModeControls.style.display = 'none';
    buzzWinnerSection.style.display = 'none';

    // 2. AKTIVE FRAGE WIEDERHERSTELLEN
    if (data.question) {
        activeQSection.style.display = 'flex'; // Overlay an
        const q = data.question;

        // Titel und Texte setzen
        const catName = currentGame?.categories[data.catIndex]?.name || 'Frage';
        applyQuestionLayout(q, catName);

        // Medien-Sync wieder aktivieren (WICHTIG!)
        // (Setzt voraus, dass die Hilfsfunktion attachMediaSyncListeners existiert)
        attachMediaSyncListeners('question-display');
        attachMediaSyncListeners('answer-display');

        // Grid-Button als "aktiv" markieren
        const btn = document.getElementById(`q-btn-${data.catIndex}-${data.qIndex}`);
        if (btn) btn.classList.add('active');

        // 3. TYP-SPEZIFISCHE LOGIK
        const totalPlayers = Object.keys(data.players || {}).length;
        const currentCount = data.submittedCount || 0;

        switch (q.type) {
            case 'map':
                mapModeControls.style.display = 'flex';
                mapSubmittedCount.innerText = `${currentCount}/${totalPlayers}`;
                
                // Button wieder anzeigen (sofern noch nicht aufgel�st - Status m�sste man theoretisch auch tracken, 
                // aber hier gehen wir davon aus: Frage offen -> Button da)
                if(resolveMapBtn) resolveMapBtn.style.display = 'block';
                break;

            case 'estimate':
                estimateModeControls.style.display = 'flex';
                estimateSubmittedCount.innerText = `${currentCount}/${totalPlayers}`;
                
                if(resolveEstimateBtn) resolveEstimateBtn.style.display = 'block';
                break;

            case 'freetext':
                freetextModeControls.style.display = 'flex';
                freetextSubmittedCount.innerText = `${currentCount}/${totalPlayers}`;
                // Bei Freitext gibt es meist keinen globalen "Aufl�sen" Button, da einzeln bewertet wird
                break;

            case 'pixel':
                pixelModeControls.style.display = 'flex';
                qTitle.innerText += " (PIXEL PUZZLE)";
                
                // Pixel hat Buzzer + Aufl�sen
                if(unlockBuzzersBtn) unlockBuzzersBtn.style.display = data.buzzWinnerId ? 'none' : 'block';
                if(resolveQuestionBtn) resolveQuestionBtn.style.display = 'block';
                break;

            case 'list':
                listModeControls.style.display = 'block';
                
                // Liste hat Buzzer + Aufl�sen
                if(unlockBuzzersBtn) unlockBuzzersBtn.style.display = data.buzzWinnerId ? 'none' : 'block';
                if(resolveQuestionBtn) resolveQuestionBtn.style.display = 'block';

                // Listen-Fortschritt wiederherstellen
                if (q.listItems) {
                    updateListPreview(q.listItems, data.listRevealedCount || 0);
                }
                break;

            case 'elemination':
                eleminationModeControls.style.display = 'block';
                eleminationRevealedIndices = data.eleminationRevealedIndices || [];
                eleminationEliminatedPlayerIds = data.eleminationEliminatedPlayerIds || [];
                eleminationRoundResolved = !!data.eleminationRoundResolved;
                renderEleminationControls();
                if(unlockBuzzersBtn) unlockBuzzersBtn.style.display = 'none';
                if(resolveQuestionBtn) resolveQuestionBtn.style.display = 'none';
                break;

            default: // 'standard'
                // Standard Frage
                if(unlockBuzzersBtn) unlockBuzzersBtn.style.display = data.buzzWinnerId ? 'none' : 'block';
                if(resolveQuestionBtn) resolveQuestionBtn.style.display = 'block';
                break;
        }

        // 4. BUZZER GEWINNER (falls vorhanden)
        if (data.buzzWinnerId) {
            // Wenn jemand gebuzzert hat:
            activePlayerId = data.buzzWinnerId;
            const winnerName = data.players[data.buzzWinnerId]?.name || 'Spieler';
            
            buzzWinnerName.innerText = winnerName;
            buzzWinnerSection.style.display = 'flex';

            // Buttons anpassen: 
            // Unlock Button zeigen wir oft trotzdem an (um zu resetten), 
            // Aufl�sen blenden wir oft aus, um Verwirrung zu vermeiden.
            if(unlockBuzzersBtn) unlockBuzzersBtn.style.display = 'none'; 
            if(resolveQuestionBtn) resolveQuestionBtn.style.display = 'none'; 
            
            // Map/Estimate Controls ausblenden, falls sie an waren (sollte bei Standard nicht passieren, aber sicher ist sicher)
            mapModeControls.style.display = 'none';

        }
    }

    // 5. Spielerliste & Punktestand aktualisieren
    players = data.players;
    renderPlayerList();
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
    showBuzzWinner(data.id, data.name);
});

// WICHTIG: Hier kommt auch das Update f�r den Intro-Button an
socket.on('update_host_controls', updateHostControls);

socket.on('host_update_map_status', (data) => {
    mapSubmittedCount.innerText = `${data.submittedCount}/${data.totalPlayers}`;
});

socket.on('host_restore_active_question', (data) => {
    activeQuestion = data.question;
    activeQSection.style.display = 'flex'; // Overlay zeigen

    const catName = currentGame?.categories[data.catIndex]?.name || 'Frage';
    applyQuestionLayout(data.question, catName);

    attachMediaSyncListeners('question-display');
    attachMediaSyncListeners('answer-display');

    const btn = document.getElementById(`q-btn-${data.catIndex}-${data.qIndex}`);
    if (btn) btn.classList.add('used');

    if (data.question.type === 'map') {
        buzzWinnerSection.style.display = 'none';
        mapModeControls.style.display = 'flex';
        unlockBuzzersBtn.style.display = 'none';
        mapSubmittedCount.innerText = `${data.mapGuessesCount}/${getInQuizPlayerCount()}`;
        eleminationModeControls.style.display = 'none';
    } else if (data.question.type === 'list') {
        listModeControls.style.display = 'block';
        mapModeControls.style.display = 'none';
        eleminationModeControls.style.display = 'none';
        
        if (data.question.listItems) {
            const idx = (data as any).listRevealedCount ?? -1;
            updateListPreview(data.question.listItems, idx);
        }
    } else if (data.question.type === 'elemination') {
        buzzWinnerSection.style.display = 'none';
        mapModeControls.style.display = 'none';
        listModeControls.style.display = 'none';
        estimateModeControls.style.display = 'none';
        freetextModeControls.style.display = 'none';
        pixelModeControls.style.display = 'none';
        eleminationModeControls.style.display = 'block';
        eleminationRevealedIndices = data.eleminationRevealedIndices || [];
        eleminationEliminatedPlayerIds = data.eleminationEliminatedPlayerIds || [];
        eleminationRoundResolved = !!data.eleminationRoundResolved;
        renderEleminationControls();
        unlockBuzzersBtn.style.display = 'none';
    } else if (data.question.type === 'pixel') {
        listModeControls.style.display = 'none';
        mapModeControls.style.display = 'none';
        eleminationModeControls.style.display = 'none';
        unlockBuzzersBtn.style.display = data.buzzersActive ? 'none' : 'block';
    } else if (data.question.type === 'estimate') {
         buzzWinnerSection.style.display = 'none';
         mapModeControls.style.display = 'none';
         listModeControls.style.display = 'none';
         eleminationModeControls.style.display = 'none';
         unlockBuzzersBtn.style.display = 'none';
         estimateModeControls.style.display = 'flex';
    } else if (data.question.type === 'freetext') {
        buzzWinnerSection.style.display = 'none';
        mapModeControls.style.display = 'none';
        listModeControls.style.display = 'none';
        eleminationModeControls.style.display = 'none';
        estimateModeControls.style.display = 'none';
        pixelModeControls.style.display = 'none';
        unlockBuzzersBtn.style.display = 'none';
        
        freetextModeControls.style.display = 'flex';
    } else {
        buzzWinnerSection.style.display = 'none';
        mapModeControls.style.display = 'none';
        listModeControls.style.display = 'none'; 
        eleminationModeControls.style.display = 'none';
        estimateModeControls.style.display = 'none';
        freetextModeControls.style.display = 'none';
        pixelModeControls.style.display = 'none';   
        unlockBuzzersBtn.style.display = data.buzzersActive ? 'none' : 'block';
    }

    if (freetextGradingView) freetextGradingView.style.display = 'none';
});

socket.on('board_hide_question', () => {
    eleminationRoundResolved = false;
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
                // Farbe �ndern wenn es "Zum Spielbrett" ist
                if(data.nextIntroStep.includes('Spielbrett')) {
                     btnIntroNext.className = "host-btn btn-success btn-full";
                } else {
                     btnIntroNext.className = "host-btn btn-warning btn-full";
                }
            }
        }
    }

    // 2. BUZZER LOGIK
    if (data.buzzWinnerId !== undefined) {
        if (data.buzzWinnerId) {
            showBuzzWinner(data.buzzWinnerId, data.buzzWinnerName);
            if (resolveQuestionBtn && activeQuestion && isClassicBuzzQuestion(activeQuestion)) {
                resolveQuestionBtn.style.display = 'block';
            }
            //if(resolveQuestionBtn) resolveQuestionBtn.style.display = 'none';
        } else {
            activePlayerId = null;
            buzzWinnerSection.style.display = 'none';
            if (correctBtn) correctBtn.style.display = activeQuestion?.type === 'elemination' ? 'none' : 'inline-flex';
            unlockBuzzersBtn.style.display = isClassicBuzzQuestion(activeQuestion) ? 'block' : 'none';
            if (resolveQuestionBtn && activeQuestion && isClassicBuzzQuestion(activeQuestion)) {
                resolveQuestionBtn.style.display = 'block';
            }
            // if(unlockBuzzersBtn && unlockBuzzersBtn.style.display === 'block') {
            //      if(resolveQuestionBtn) resolveQuestionBtn.style.display = 'block';
            // }
        }
    }

    if (data.listMode !== undefined) {
        // Umschalten der Ansicht
        listModeControls.style.display = data.listMode ? 'block' : 'none';
        mapModeControls.style.display = 'none';
        eleminationModeControls.style.display = 'none';
        
        // Im Reihum-Modus bleibt der Unlock-Button immer ausgeblendet
        if (data.listMode && !activePlayerId) {
            unlockBuzzersBtn.style.display = 'block';
            buzzWinnerSection.style.display = 'none';
        }
    }

    // Wenn ein Update zum Z�hler kommt (oder beim Restore)
    if (data.listRevealedCount !== undefined && activeQuestion?.listItems) {
        updateListPreview(activeQuestion.listItems, data.listRevealedCount);
    }

    // 3. MAP LOGIK
    if (data.mapMode !== undefined) {
        mapModeControls.style.display = data.mapMode ? 'flex' : 'none';
        if (data.mapMode) {
            eleminationModeControls.style.display = 'none';
            activePlayerId = null;
            buzzWinnerSection.style.display = 'none';
        }
        
        if (data.mapMode) {
            unlockBuzzersBtn.style.display = 'none';
        }
    }

    // 4. MAP COUNTS
    if (data.submittedCount !== undefined) {
        mapSubmittedCount.innerText = `${data.submittedCount}/${getInQuizPlayerCount()}`;
    }

    if (data.estimateMode !== undefined) {
        activePlayerId = null;
        buzzWinnerSection.style.display = 'none';
        mapModeControls.style.display = 'none';
        listModeControls.style.display = 'none';
        eleminationModeControls.style.display = 'none';
        unlockBuzzersBtn.style.display = 'none'; // Keine Buzzer bei Sch�tzfragen
        
        estimateModeControls.style.display = data.estimateMode ? 'flex' : 'none';
    }

    if (data.freetextMode !== undefined) {
        activePlayerId = null;
        buzzWinnerSection.style.display = 'none';
        mapModeControls.style.display = 'none';
        listModeControls.style.display = 'none';
        eleminationModeControls.style.display = 'none';
        estimateModeControls.style.display = 'none';
        unlockBuzzersBtn.style.display = 'none'; // Keine Buzzer

        freetextModeControls.style.display = data.freetextMode ? 'flex' : 'none';
        
        // Z�hler nutzen wir denselben Generic Count oder ein eigenes Feld
        // Im Server hatten wir 'submittedCount' allgemein gesendet
        if (data.submittedCount !== undefined && data.freetextMode) {
             freetextSubmittedCount.innerText = `${data.submittedCount}/${getInQuizPlayerCount()}`;
        }
    }
    
    if (data.submittedCount !== undefined && freetextModeControls.style.display === 'flex') {
        freetextSubmittedCount.innerText = `${data.submittedCount}/${getInQuizPlayerCount()}`;
    }

    if (data.eleminationMode !== undefined) {
        mapModeControls.style.display = 'none';
        listModeControls.style.display = 'none';
        estimateModeControls.style.display = 'none';
        freetextModeControls.style.display = 'none';
        eleminationModeControls.style.display = data.eleminationMode ? 'block' : 'none';
        if (!data.eleminationMode) eleminationRoundResolved = false;
        unlockBuzzersBtn.style.display = 'none';
    }

    if (data.eleminationRevealedIndices !== undefined) {
        eleminationRevealedIndices = data.eleminationRevealedIndices;
        renderEleminationControls();
    }

    if (data.eleminationRoundResolved !== undefined) {
        eleminationRoundResolved = !!data.eleminationRoundResolved;
        if (eleminationModeControls.style.display === 'block') {
            renderEleminationControls();
        }
    }

    if (data.eleminationEliminatedPlayerIds !== undefined) {
        eleminationEliminatedPlayerIds = data.eleminationEliminatedPlayerIds;
        renderEleminationStatus();
    }

    if (data.chooserPlayerId !== undefined) {
        currentChooserPlayerId = data.chooserPlayerId || null;
        renderPlayerList();
    }
}

function showBuzzWinner(playerId: string, playerName?: string) {
    activePlayerId = playerId;
    if (activeQuestion && isClassicBuzzQuestion(activeQuestion)) {
        activeQSection.style.display = 'flex';
    }
    buzzWinnerName.innerText = playerName || 'Spieler';
    buzzWinnerSection.style.display = 'flex';
    unlockBuzzersBtn.style.display = 'none';
    mapModeControls.style.display = 'none';
    if (correctBtn) {
        correctBtn.style.display = activeQuestion?.type === 'elemination' ? 'none' : 'inline-flex';
    }
    if (incorrectBtn) {
        incorrectBtn.style.display = 'inline-flex';
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
        btnRevealList.innerText = "N�chsten Hinweis zeigen";
        btnRevealList.disabled = false;
        btnRevealList.classList.remove('used');
    }
    
    listItemsPreview.innerHTML = html;
}

function isClassicBuzzQuestion(question: IQuestion | null): boolean {
    return !!question && (question.type === 'standard' || question.type === 'list' || question.type === 'pixel');
}

function getInQuizPlayerCount(): number {
    return Object.values(players).filter((p) => !p.excluded).length;
}

function renderEleminationStatus() {
    if (!eleminationStatus || !activeQuestion || activeQuestion.type !== 'elemination') return;
    const total = activeQuestion.listItems?.length || 0;
    const remaining = Math.max(0, getInQuizPlayerCount() - eleminationEliminatedPlayerIds.length);
    const resolvedText = eleminationRoundResolved ? ' | Runde beendet' : '';
    eleminationStatus.innerText = `Aufgedeckt: ${eleminationRevealedIndices.length}/${total} | Im Rennen: ${remaining}${resolvedText}`;
}

function renderEleminationControls() {
    if (!eleminationAnswerButtons || !activeQuestion || activeQuestion.type !== 'elemination') return;
    const answers = activeQuestion.listItems || [];
    eleminationModeControls.classList.toggle('compact', answers.length > 10);

    if (btnRevealAllElemination) {
        const allRevealed = answers.length > 0 && eleminationRevealedIndices.length >= answers.length;
        btnRevealAllElemination.disabled = allRevealed;
        btnRevealAllElemination.innerText = allRevealed ? 'Alle aufgedeckt' : 'Alle aufdecken';
    }

    eleminationAnswerButtons.innerHTML = '';
    answers.forEach((ans, idx) => {
        const btn = document.createElement('button');
        const isRevealed = eleminationRevealedIndices.includes(idx);
        btn.className = `host-btn${isRevealed ? ' revealed' : ''}`;
        btn.disabled = isRevealed;
        btn.innerText = `${idx + 1}. ${ans}`;
        btn.addEventListener('click', () => {
            if (activePlayerId && !eleminationRoundResolved) {
                socket.emit('host_score_answer', { action: 'correct', playerId: activePlayerId });
                buzzWinnerSection.style.display = 'none';
                activePlayerId = null;
            }
            socket.emit('host_reveal_elemination_answer', idx);
        });
        eleminationAnswerButtons.appendChild(btn);
    });

    renderEleminationStatus();
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
    eleminationRevealedIndices = [];
    eleminationEliminatedPlayerIds = [];
    eleminationRoundResolved = false;
    activeQSection.style.display = 'flex'; // Overlay zeigen
    const catName = currentGame?.categories[catIndex].name || 'Frage';
    applyQuestionLayout(question, catName);

    attachMediaSyncListeners('question-display');
    attachMediaSyncListeners('answer-display');
    
    socket.emit('host_pick_question', { catIndex, qIndex, question });
    
    // --- RESET ALLER MODI ---
    mapModeControls.style.display = 'none';
    listModeControls.style.display = 'none';
    buzzWinnerSection.style.display = 'none';
    pixelModeControls.style.display = 'none';
    estimateModeControls.style.display = 'none';
    freetextModeControls.style.display = 'none'; 
    eleminationModeControls.style.display = 'none';
    unlockBuzzersBtn.style.display = 'none';
    if(resolveQuestionBtn) resolveQuestionBtn.style.display = 'none';
    // -----------------------------------

    if (question.type === 'map') {
        mapModeControls.style.display = 'flex';
        mapSubmittedCount.innerText = `0/${getInQuizPlayerCount()}`;
        if(resolveMapBtn) resolveMapBtn.style.display = 'block';
    
    } else if (question.type === 'list') {
        listModeControls.style.display = 'block';
        unlockBuzzersBtn.style.display = 'block'; 
        if(resolveQuestionBtn) resolveQuestionBtn.style.display = 'block';
        
        if (question.listItems) {
            updateListPreview(question.listItems, -1); 
        }

    } else if (question.type === 'elemination') {
        eleminationModeControls.style.display = 'block';
        unlockBuzzersBtn.style.display = 'none';
        if(resolveQuestionBtn) resolveQuestionBtn.style.display = 'none';
        renderEleminationControls();

    } else if (question.type === 'pixel') {
        pixelModeControls.style.display = 'flex';
        unlockBuzzersBtn.style.display = 'block';
        if(resolveQuestionBtn) resolveQuestionBtn.style.display = 'block';
        qTitle.innerText += " (PIXEL PUZZLE)";
        
    } else if (question.type === 'estimate') {
        estimateModeControls.style.display = 'flex';
        estimateSubmittedCount.innerText = `0/${getInQuizPlayerCount()}`;
        if(resolveEstimateBtn) resolveEstimateBtn.style.display = 'block';

    } else if (question.type === 'freetext') {
        freetextModeControls.style.display = 'flex';
        freetextSubmittedCount.innerText = `0/${getInQuizPlayerCount()}`;

    } else {
        if(resolveQuestionBtn) resolveQuestionBtn.style.display = 'block';
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
        item.title = 'Doppelklick: als aktuellen Spieler setzen';
        const isExcluded = !!p.excluded;
        const isCurrentChooser = !!currentChooserPlayerId && p.id === currentChooserPlayerId;
        
        // Visuelles Feedback wenn offline / ausgeschlossen
        if (isExcluded) {
            item.style.opacity = '0.55';
            item.style.filter = 'grayscale(100%)';
            item.style.borderStyle = 'dashed';
            item.title = 'Ausgeschlossen';
        } else if (!p.active) {
            item.style.opacity = '0.5';
            item.style.filter = 'grayscale(100%)';
            item.title = 'Offline';
        }

        if (!isExcluded) {
            item.style.cursor = 'pointer';
            item.ondblclick = () => {
                socket.emit('host_set_current_player', p.id);
            };
        } else {
            item.style.cursor = 'default';
        }

        if (!isExcluded && isCurrentChooser) {
            item.style.border = '2px solid #007bff';
            item.style.boxShadow = '0 0 0 2px rgba(0,123,255,0.2) inset';
            item.title = 'Aktuell dran';
        }

        // --- Linke Seite: Name ---
        const nameSpan = document.createElement('span');
        nameSpan.style.color = p.color;
        nameSpan.style.fontWeight = 'bold';
        nameSpan.textContent = p.name;

        const statusIcons = document.createElement('span');
        statusIcons.style.marginLeft = '8px';
        statusIcons.style.display = 'inline-flex';
        statusIcons.style.gap = '6px';
        statusIcons.style.verticalAlign = 'middle';

        if (isCurrentChooser && !isExcluded) {
            const currentIcon = document.createElement('span');
            currentIcon.textContent = '◉';
            currentIcon.title = 'Aktuell dran';
            currentIcon.style.color = '#007bff';
            currentIcon.style.fontSize = '0.75rem';
            statusIcons.appendChild(currentIcon);
        }

        if (isExcluded) {
            const excludedIcon = document.createElement('span');
            excludedIcon.textContent = '⛔';
            excludedIcon.title = 'Ausgeschlossen';
            excludedIcon.style.color = '#888';
            excludedIcon.style.fontSize = '0.8rem';
            statusIcons.appendChild(excludedIcon);
        } else if (!p.active) {
            const offlineIcon = document.createElement('span');
            offlineIcon.textContent = '○';
            offlineIcon.title = 'Offline';
            offlineIcon.style.color = '#999';
            offlineIcon.style.fontSize = '0.8rem';
            statusIcons.appendChild(offlineIcon);
        }

        if (statusIcons.childElementCount > 0) {
            nameSpan.appendChild(statusIcons);
        }

        // --- Rechte Seite: Score + Edit Button ---
        const scoreContainer = document.createElement('div');
        scoreContainer.style.display = 'flex';
        scoreContainer.style.alignItems = 'center';
        scoreContainer.style.gap = '2px';

        const scoreSpan = document.createElement('span');
        scoreSpan.className = 'score';
        scoreSpan.innerText = p.score.toString();
        scoreSpan.style.marginRight = '6px';

        // Edit Button (Stift)
        const editBtn = document.createElement('button');
        editBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="3" width="18" height="18" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"></rect><path d="M8 16l1.5-4.5L16.8 4.2a1.6 1.6 0 0 1 2.3 0l.7.7a1.6 1.6 0 0 1 0 2.3l-7.3 7.3L8 16z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path><path d="M14.7 6.3l3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>';
        editBtn.title = 'Punkte korrigieren';
        editBtn.setAttribute('aria-label', 'Punkte korrigieren');
        editBtn.style.background = 'transparent';
        editBtn.style.border = 'none';
        editBtn.style.cursor = 'pointer';
        editBtn.style.padding = '0 4px';
        editBtn.style.width = '24px';
        editBtn.style.height = '24px';
        editBtn.style.display = 'inline-flex';
        editBtn.style.alignItems = 'center';
        editBtn.style.justifyContent = 'center';
        editBtn.style.lineHeight = '1';
        editBtn.style.fontSize = '1rem';
        editBtn.style.color = '#5aa9ff';
        editBtn.style.transition = 'transform 0.1s, color 0.2s';
        editBtn.onmouseenter = () => {
            editBtn.style.color = '#8fc4ff';
            editBtn.style.transform = 'scale(1.15)';
        };
        editBtn.onmouseleave = () => {
            editBtn.style.color = '#5aa9ff';
            editBtn.style.transform = 'scale(1)';
        };

        // Klick-Event f�r Korrektur
        editBtn.onclick = () => {
            const input = prompt(`Neue Punktzahl fuer ${p.name}:`, p.score.toString());
            if (input !== null) {
                const newScore = parseInt(input);
                if (!isNaN(newScore)) {
                    socket.emit('host_manual_score_update', { playerId: p.id, newScore });
                } else {
                    alert("Bitte eine g�ltige Zahl eingeben.");
                }
            }
        };

        const toggleExcludeBtn = document.createElement('button');
        toggleExcludeBtn.innerHTML = isExcluded
            ? '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7v5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M7 12a7 7 0 1 0 2-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path></svg>';
        toggleExcludeBtn.title = isExcluded ? 'Spieler wieder ins Quiz aufnehmen' : 'Spieler aus dem Quiz ausschließen';
        toggleExcludeBtn.style.background = 'transparent';
        toggleExcludeBtn.style.border = 'none';
        toggleExcludeBtn.style.cursor = 'pointer';
        toggleExcludeBtn.style.padding = '0 4px';
        toggleExcludeBtn.style.width = '24px';
        toggleExcludeBtn.style.height = '24px';
        toggleExcludeBtn.style.display = 'inline-flex';
        toggleExcludeBtn.style.alignItems = 'center';
        toggleExcludeBtn.style.justifyContent = 'center';
        toggleExcludeBtn.style.lineHeight = '1';
        toggleExcludeBtn.style.fontSize = '1rem';
        toggleExcludeBtn.style.color = isExcluded ? '#28a745' : '#dc3545';
        toggleExcludeBtn.style.transition = 'transform 0.1s, color 0.2s';
        toggleExcludeBtn.onmouseenter = () => {
            toggleExcludeBtn.style.color = isExcluded ? '#1e7e34' : '#b02a37';
            toggleExcludeBtn.style.transform = 'scale(1.15)';
        };
        toggleExcludeBtn.onmouseleave = () => {
            toggleExcludeBtn.style.color = isExcluded ? '#28a745' : '#dc3545';
            toggleExcludeBtn.style.transform = 'scale(1)';
        };
        toggleExcludeBtn.onclick = () => {
            socket.emit('host_toggle_player_excluded', { playerId: p.id, excluded: !isExcluded });
        };

        scoreContainer.appendChild(scoreSpan);
        scoreContainer.appendChild(editBtn);
        scoreContainer.appendChild(toggleExcludeBtn);

        item.appendChild(nameSpan);
        item.appendChild(scoreContainer);

        playerListUl.appendChild(item);
    });
}

function renderQuestionContent(q: IQuestion, part: 'question' | 'answer'): string {
    if (part === 'answer' && q.type === 'elemination') {
        return '';
    }

    const text = part === 'question' ? q.questionText : q.answerText;
    const path = part === 'question' ? q.mediaPath : q.answerMediaPath;

    let html = `<p>${text || ''}</p>`;

    if (path) {
        const lowerPath = path.toLowerCase();
        let mediaHtml = '';

        if (lowerPath.endsWith('.mp3') || lowerPath.endsWith('.wav') || lowerPath.endsWith('.ogg') || lowerPath.endsWith('.m4a')) {
            mediaHtml = `<audio controls muted src="${path}" style="width: 100%;">Dein Browser unterstuetzt kein Audio.</audio>`;
        } else if (lowerPath.endsWith('.mp4') || lowerPath.endsWith('.webm') || lowerPath.endsWith('.mov')) {
            mediaHtml = `<video controls muted src="${path}" style="max-height: 300px; width:100%; object-fit:contain;">Dein Browser unterstuetzt kein Video.</video>`;
        } else {
            mediaHtml = `<img src="${path}" style="max-height: 300px; width:100%; object-fit:contain;" alt="Medien">`;
        }
        
        html += mediaHtml;
    }
    
    if (part === 'answer') {
        html = `<p style="color: var(--color-success); font-weight: bold;">Loesung: ${text}</p>` + html;
        if (q.type === 'map' && q.location) {
            html += `<p style="font-style: italic; font-size: 0.9rem; color: var(--text-muted);">Ziel: LAT ${q.location.lat.toFixed(4)}, LNG ${q.location.lng.toFixed(4)}</p>`;
        }
    }

    return html;
}

function applyQuestionLayout(question: IQuestion, categoryName: string) {
    const titleBase = `${categoryName} - ${question.points} Punkte`;
    const isElemination = question.type === 'elemination';
    activeQSection.classList.toggle('elemination-active', isElemination);

    if (correctBtn) {
        correctBtn.style.display = isElemination ? 'none' : 'inline-flex';
    }
    if (incorrectBtn) {
        incorrectBtn.style.display = 'inline-flex';
    }

    if (isElemination) {
        const questionTitle = (question.questionText || '').trim();
        qTitle.innerText = questionTitle ? `${titleBase} | ${questionTitle}` : titleBase;
        qDisplay.style.display = 'none';
    } else {
        qTitle.innerText = titleBase;
        qDisplay.style.display = 'block';
    }

    qDisplay.innerHTML = renderQuestionContent(question, 'question');
    aDisplay.innerHTML = renderQuestionContent(question, 'answer');
    aDisplay.style.display = isElemination ? 'none' : 'block';
    if (answerSeparator) answerSeparator.style.display = isElemination ? 'none' : 'block';
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
            toggleBtn.innerText = isPlaying ? "Pause" : "Play";
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

    // 1. H�he zur�cksetzen (wichtig falls das Fenster kleiner gezogen wird)
    titles.forEach(t => t.style.height = 'auto');

    // 2. Maximale H�he ermitteln
    let maxHeight = 0;
    titles.forEach(t => {
        if (t.offsetHeight > maxHeight) {
            maxHeight = t.offsetHeight;
        }
    });

    // 3. Allen Elementen die gleiche H�he geben
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
            <div style="flex-grow:1; padding-right: 10px; min-width: 0;">
                <div class="grading-name">${entry.name}</div>
                <div class="grading-text">${entry.text}</div>
            </div>
            <div style="display:flex; gap:8px; flex-shrink: 0;">
                <button class="host-btn btn-correct" id="btn-correct-${entry.playerId}" data-pid="${entry.playerId}" style="background:#e0e0e0; min-width: 40px;">OK</button>
                <button class="host-btn btn-incorrect" id="btn-incorrect-${entry.playerId}" data-pid="${entry.playerId}" style="background:#e0e0e0; min-width: 40px;">X</button>
            </div>
        `;
        
        freetextList.appendChild(row);
        
        // Initialen Status setzen
        if (entry.status) {
            updateFreetextButtonStyles(entry.playerId, entry.status);
        }
    });

    // Event Listener f�r Buttons (wie gehabt)
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

    // 2. Status anwenden (Klassen hinzuf�gen)
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

function attachMediaSyncListeners(containerId: string) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const mediaEl = container.querySelector('video, audio') as HTMLMediaElement;
    if (!mediaEl) return;

    mediaEl.onplay = () => {
        socket.emit('host_media_control', { action: 'play', currentTime: mediaEl.currentTime });
    };

    mediaEl.onpause = () => {
        socket.emit('host_media_control', { action: 'pause', currentTime: mediaEl.currentTime });
    };

    mediaEl.onseeked = () => {
        socket.emit('host_media_control', { action: 'seek', currentTime: mediaEl.currentTime });
    };
}
