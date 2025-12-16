import { socket } from './socket';
import L from 'leaflet';
import QRCode from 'qrcode'; 
import { IGame, IQuestion, IPlayer } from '../../src/types';

// CSS Import
import 'leaflet/dist/leaflet.css';

// --- STATE ---
let currentGame: IGame | null = null;
let currentQuestion: IQuestion | null = null;
let mapInstance: L.Map | null = null;
let qrCodeVisible = false;
let serverAddress = window.location.hostname; 
let serverPort = window.location.port;

// --- DOM ELEMENTE ---
const gameGrid = document.getElementById('game-grid') as HTMLDivElement;
const questionOverlay = document.getElementById('question-overlay') as HTMLDivElement;
const questionText = document.getElementById('question-text') as HTMLDivElement;
const answerTextDiv = document.getElementById('answer-text') as HTMLDivElement;
const mediaContainer = document.getElementById('media-container') as HTMLDivElement;
const mapDiv = document.getElementById('q-map') as HTMLDivElement;
const playerBar = document.getElementById('player-bar') as HTMLDivElement;
const qrOverlay = document.getElementById('qr-overlay') as HTMLDivElement;
const qrCanvas = document.getElementById('qrcode-canvas') as HTMLCanvasElement;
const joinUrlSpan = document.getElementById('join-url') as HTMLSpanElement;
const audioEl = document.getElementById('board-bg-music') as HTMLAudioElement;
const introOverlay = document.getElementById('intro-overlay') as HTMLDivElement;
const introMain = document.getElementById('intro-main-text') as HTMLDivElement;
const introSub = document.getElementById('intro-sub-text') as HTMLDivElement;
const listContainer = document.getElementById('list-container') as HTMLDivElement;

// --- INIT ---
const urlParams = new URLSearchParams(window.location.search);
const roomCode = urlParams.get('room');

if (roomCode) {
    socket.emit('board_join_session', roomCode);
} else {
    alert("Fehler: Kein Raum-Code in der URL!");
}

// --- SOCKET EVENTS ---

socket.on('board_show_intro', (data) => {
    const { text, subtext, type } = data;

    if (type === 'end') {
        // Intro vorbei -> Grid zeigen
        introOverlay.style.display = 'none';
        return;
    }

    // Intro anzeigen
    introOverlay.style.display = 'flex';
    
    // Reset Animation durch kurzes Entfernen der Klasse
    introMain.classList.remove('slide-in');
    void introMain.offsetWidth; // Trigger Reflow
    introMain.classList.add('slide-in');

    introMain.innerText = text;
    introSub.innerText = subtext || '';

    // Optional: Soundeffekt für jeden Schritt abspielen
    // const sfx = new Audio('/sounds/swoosh.mp3'); sfx.play();
});

socket.on('board_init_game', (game: IGame) => {
    console.log("Spieldaten empfangen:", game);
    currentGame = game;
    document.title = game.title;

    if (game.boardBackgroundPath) {
        document.body.style.backgroundImage = `url('${game.boardBackgroundPath}')`;
    }
    
    renderGrid();
    
    generateQrCode();
    qrCodeVisible = false;
    qrOverlay.style.display = 'flex';

    if (game.backgroundMusicPath && audioEl) {
        audioEl.src = game.backgroundMusicPath;
        audioEl.volume = 0.3; // Standardwert
    }
});

socket.on('board_show_question', (data) => {
    const { catIndex, qIndex, question } = data;
    currentQuestion = question;

    // Reset UI
    mediaContainer.innerHTML = "";
    mediaContainer.style.display = 'none';
    mapDiv.style.display = 'none';
    listContainer.style.display = 'none';
    listContainer.innerHTML = '';
    answerTextDiv.style.display = 'none';
    answerTextDiv.innerHTML = "";
    
    questionText.innerText = question.questionText;

    // --- MAP FRAGE ---
    if (question.type === 'map' && question.location) {
        mapDiv.style.display = 'block';
        // Leaflet braucht sichtbaren Container, daher kurzer Timeout
        setTimeout(() => initMap(question), 100);
    } else if (question.type === 'list') {
        // NEU: List Modus
        listContainer.style.display = 'block';
        
        // Falls wir reconnecten und schon Items offen sind:
        if (data.currentListIndex !== undefined && data.currentListIndex >= 0 && question.listItems) {
            for (let i = 0; i <= data.currentListIndex; i++) {
                addListItemToBoard(question.listItems[i]);
            }
        }
    }
    // --- MEDIA FRAGE ---
    else if (question.mediaPath) {
        renderMedia(question.mediaPath, mediaContainer, false);
    }

    questionOverlay.style.display = 'flex';
    
    // Karte als gespielt markieren
    const card = document.getElementById(`card-${catIndex}-${qIndex}`);
    if(card) card.classList.add('played');

    adjustFontSize(questionText);
});

socket.on('board_reveal_list_item', (index: number) => {
    if (!currentQuestion || !currentQuestion.listItems) return;
    
    const itemText = currentQuestion.listItems[index];
    if (itemText) {
        addListItemToBoard(itemText);
    }
});

socket.on('board_reveal_answer', () => {
    if (!currentQuestion) return;

    questionText.style.display = 'none';

    // Antwort Text anzeigen
    answerTextDiv.innerHTML = `<span style="color:var(--text-success); font-size:0.5em; display:block;">LÖSUNG:</span>${currentQuestion.answerText || ''}`;
    answerTextDiv.style.display = 'block';

    // --- MAP AUFLÖSUNG ---
    if (currentQuestion.type === 'map' && currentQuestion.location) {
        // Karte bleibt sichtbar, Marker kommen via 'board_reveal_map_results'
    } 
    // --- STANDARD ANTWORT MEDIA ---
    else {
        // Map weg
        mapDiv.style.display = 'none';
        if (mapInstance) { mapInstance.remove(); mapInstance = null; }

        // Medien Container leeren & Antwort-Medien zeigen
        mediaContainer.innerHTML = '';
        if (currentQuestion.answerMediaPath) {
            renderMedia(currentQuestion.answerMediaPath, mediaContainer, true); // Autoplay
        } else {
            mediaContainer.style.display = 'none';
        }
    }
});

socket.on('board_reveal_map_results', (data: { results: any, players: Record<string, IPlayer>, target: any }) => {
    if(!mapInstance) return;

    const map = mapInstance; 
    
    const { results, players, target } = data;
    const bounds: L.LatLngTuple[] = [[target.lat, target.lng]];

    // 1. ZIEL MARKER
    const targetIcon = L.divIcon({
        className: 'target-icon',
        html: `<div style="width:20px; height:20px; background:#00ff00; border:2px solid black; border-radius:50%; box-shadow:0 0 10px #00ff00;"></div>
               <div style="position:absolute; top:-25px; left:-20px; background:black; color:#00ff00; padding:2px 5px; font-weight:bold; border:1px solid #00ff00;">LÖSUNG</div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });
    L.marker([target.lat, target.lng], {icon: targetIcon, zIndexOffset: 1000}).addTo(map);

    // 2. SPIELER MARKER
    Object.keys(results).forEach(playerId => {
        const res = results[playerId];
        const player = players[playerId];
        if(!player) return;

        const distText = target.isCustomMap 
            ? Math.round(res.distance) + " px" 
            : res.distance.toFixed(1) + " km";

        const winnerLabel = res.isWinner 
            ? '<br><span style="color:#00ff00; font-weight:900;">★ GEWINNER ★</span>' 
            : '';

        const html = `
            <div class="marker-wrapper">
                <div class="marker-dot" style="background:${player.color}; ${res.isWinner ? 'border:3px solid #00ff00; width:18px; height:18px;' : ''}"></div>
                <div class="marker-label">
                    <span style="color:${player.color}; font-weight:bold;">${player.name}</span><br>
                    ${distText}
                    ${winnerLabel}
                </div>
            </div>`;

        const pIcon = L.divIcon({
            className: 'custom-map-marker',
            html: html,
            iconSize: [0,0], 
            iconAnchor: [0,0] 
        });

        L.marker([res.lat, res.lng], {icon: pIcon}).addTo(map);
        
        // Linie zeichnen
        L.polyline([[target.lat, target.lng], [res.lat, res.lng]], {
            color: player.color, weight: res.isWinner ? 4 : 2, opacity: 0.8, dashArray: '5, 10'
        }).addTo(map);

        bounds.push([res.lat, res.lng]);
    });

    if(bounds.length > 0) {
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    }
});

socket.on('board_hide_question', () => {
    questionOverlay.style.display = 'none';
    mediaContainer.innerHTML = "";
    const audios = document.querySelectorAll('audio, video');
    audios.forEach((a: any) => a.pause());
});

socket.on('board_toggle_qr', () => {
    if (qrOverlay.style.display === 'none' || qrOverlay.style.display === '') {
        if (!qrCodeVisible) generateQrCode();
        qrOverlay.style.display = 'flex';
        qrCodeVisible = true;
    } else {
        qrOverlay.style.display = 'none';
        qrCodeVisible = false;
    }
});

socket.on('update_scores', renderPlayerBar);
socket.on('update_player_list', renderPlayerBar);

socket.on('player_won_buzz', (data) => {
    document.querySelectorAll('.player-card').forEach(c => c.classList.remove('buzzing'));
    const winner = document.getElementById('p-' + data.id);
    if(winner) winner.classList.add('buzzing');
});

socket.on('buzzers_unlocked', () => {
    document.querySelectorAll('.player-card').forEach(c => c.classList.remove('buzzing'));
});

socket.on('session_ended', () => {
    questionOverlay.style.display = 'flex';
    
    mediaContainer.innerHTML = "";
    mediaContainer.style.display = 'none';
    mapDiv.style.display = 'none';
    answerTextDiv.style.display = 'none';
    
    questionText.innerText = "Der Host hat die Sitzung beendet.";
    questionText.style.color = "#ff6666";
    
    setTimeout(() => {
        window.close(); 
    }, 3000);
});

socket.on('music_control', (data) => {
    if (!audioEl) return;
    
    if (!audioEl.src && currentGame?.backgroundMusicPath) {
        audioEl.src = currentGame.backgroundMusicPath;
    }

    if (!audioEl.src) return;

    switch (data.action) {
        case 'play':
            const playPromise = audioEl.play();
            if (playPromise !== undefined) {
                playPromise.catch(error => console.log("Autoplay prevented:", error));
            }
            break;
        case 'pause':
            audioEl.pause();
            break;
        case 'volume':
            if (data.value !== undefined) {
                audioEl.volume = data.value;
            }
            break;
    }
});

socket.on('load_game_on_board', (data: { game: IGame, usedQuestions: { catIndex: number, qIndex: number }[] }) => {
    console.log("Board geladen:", data);
    currentGame = data.game;
    
    if (data.usedQuestions) {
        data.usedQuestions.forEach(item => {
            const tile = document.getElementById(`card-${item.catIndex}-${item.qIndex}`);
            if (tile) {
                tile.classList.add('played');
            }
        });
    }
});

socket.on('server_network_info', (data: { ip: string, port: number }) => {
    console.log("Server IP empfangen:", data.ip);
    serverAddress = data.ip;
    serverPort = data.port.toString();
    generateQrCode(); 
});

// --- HELPER FUNKTIONEN ---

function renderGrid() {
    gameGrid.innerHTML = "";
    if(!currentGame || !currentGame.categories) return;

    gameGrid.style.gridTemplateColumns = `repeat(${currentGame.categories.length}, 1fr)`;
    const numQ = currentGame.categories[0]?.questions?.length || 5;
    gameGrid.style.gridTemplateRows = `0.5fr repeat(${numQ}, 1fr)`;

    if (currentGame.backgroundMusicPath && audioEl) {
        audioEl.src = currentGame.backgroundMusicPath;
        audioEl.volume = 0.3; 
    }

    currentGame.categories.forEach((cat, catIndex) => {
        const head = document.createElement('div');
        head.className = 'cat-header';
        head.innerText = cat.name;
        gameGrid.appendChild(head);

        cat.questions.forEach((q, qIndex) => {
            const card = document.createElement('div');
            card.className = 'q-card';
            card.innerText = q.points.toString();
            card.id = `card-${catIndex}-${qIndex}`;
            // CSS Grid Positionierung
            card.style.gridColumn = (catIndex + 1).toString();
            card.style.gridRow = (qIndex + 2).toString();
            gameGrid.appendChild(card);
        });
    });
}

function initMap(question: IQuestion) {
    if (!question.location) return;
    if (mapInstance) { mapInstance.remove(); mapInstance = null; }

    const loc = question.location;
    const crsMode = loc.isCustomMap ? L.CRS.Simple : L.CRS.EPSG3857;

    mapInstance = L.map('q-map', {
        center: [0, 0],
        zoomSnap: 0.5,
        zoomControl: true,
        attributionControl: false,
        crs: crsMode
    });

    if (loc.isCustomMap && loc.customMapPath) {
        const bounds: L.LatLngBoundsExpression = [[0,0], [loc.mapHeight,loc.mapWidth]];
        L.imageOverlay(loc.customMapPath, bounds).addTo(mapInstance);
        mapInstance.fitBounds(bounds);
    } else {
        // OSM
        mapInstance.setView([0,0], 2);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapInstance);
    }
    
    mapInstance.invalidateSize();
}

function renderMedia(path: string, container: HTMLElement, autoPlay: boolean) {
    container.style.display = 'block';
    const ext = path.split('.').pop()?.toLowerCase();

    if (['mp4', 'webm', 'mov'].includes(ext || '')) {
        const vid = document.createElement('video');
        vid.src = path;
        if(autoPlay) vid.autoplay = true;
        vid.controls = true;
        container.appendChild(vid);
    } else if (['mp3', 'wav'].includes(ext || '')) {
        const audio = document.createElement('audio');
        audio.src = path;
        if(autoPlay) audio.play().catch(console.error);
        audio.controls = true;
        container.appendChild(audio);
        
        const icon = document.createElement('div');
        icon.innerHTML = '🎵';
        icon.style.fontSize = '5rem';
        container.appendChild(icon);
    } else {
        const img = document.createElement('img');
        img.src = path;
        container.appendChild(img);
    }
}

function renderPlayerBar(players: Record<string, IPlayer>) {
    playerBar.innerHTML = "";
    for (const id in players) {
        const p = players[id];
        const div = document.createElement('div');
        div.className = 'player-card';
        div.id = 'p-' + p.id; 
        div.style.color = p.color;
        div.style.borderColor = p.color;
        div.innerText = `${p.name}: ${p.score}`;
        playerBar.appendChild(div);
    }
}

async function generateQrCode() {
    const protocol = window.location.protocol; 
    const portPart = serverPort ? `:${serverPort}` : '';
    const fullUrl = `${protocol}//${serverAddress}${portPart}/player.html?room=${roomCode}`;

    joinUrlSpan.innerText = fullUrl;
    
    try {
        await QRCode.toCanvas(qrCanvas, fullUrl, { 
            width: 400, 
            margin: 2, 
            color: { dark: '#000000', light: '#ffffff' } 
        });
    } catch (err) {
        console.error("QR Fehler", err);
    }
}

function adjustFontSize(element: HTMLElement) {
    element.style.fontSize = '8vh';
    let size = 8;
    // Simple Loop um Overflow zu verhindern
    while(size > 2 && (element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight)) {
        size -= 0.5;
        element.style.fontSize = size + 'vh';
    }
}

function addListItemToBoard(text: string) {
    const div = document.createElement('div');
    div.className = 'list-item-card';
    div.innerText = text;
    listContainer.appendChild(div);
    
    // Auto-Scroll nach unten, falls Liste lang wird
    listContainer.scrollTop = listContainer.scrollHeight;
}