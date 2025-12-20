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
let currentPixelAnim: number | null = null;
let pixelControlCalls: { pause: () => void, resume: () => void } | null = null;

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
const estimateResultsDiv = document.getElementById('estimate-results') as HTMLDivElement;
const freetextContainer = document.getElementById('freetext-container') as HTMLDivElement;

// --- INIT ---
const urlParams = new URLSearchParams(window.location.search);
const roomCode = urlParams.get('room');

if (roomCode) {
    socket.emit('board_join_session', roomCode);
} else {
    alert("Fehler: Kein Raum-Code in der URL!");
}

// --- SOCKET EVENTS ---
socket.on('board_control_pixel_puzzle', (action) => {
    if (!pixelControlCalls) return;
    if (action === 'pause') pixelControlCalls.pause();
    if (action === 'resume') pixelControlCalls.resume();
});

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
    estimateResultsDiv.style.display = 'none';
    estimateResultsDiv.innerHTML = '';
    freetextContainer.style.display = 'none';
    freetextContainer.innerHTML = '';
    
    questionText.innerText = question.questionText;
    mapDiv.style.display = 'none';

    // --- MAP FRAGE ---
    if (question.type === 'list') {
        // NEU: List Modus
        listContainer.style.display = 'flex';
        
        // Falls wir reconnecten und schon Items offen sind:
        if (data.currentListIndex !== undefined && data.currentListIndex >= 0 && question.listItems) {
            for (let i = 0; i <= data.currentListIndex; i++) {
                addListItemToBoard(question.listItems[i]);
            }
        }
    }
    else if (question.type === 'pixel' && question.mediaPath) {
        // Starte den Effekt im Media Container
        startPixelPuzzle(question);
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

    if (currentPixelAnim) {
        cancelAnimationFrame(currentPixelAnim);
        currentPixelAnim = null;
    }
    // --- STANDARD ANTWORT MEDIA ---
    else {
        // Map weg
        mapDiv.style.display = 'none';
        if (mapInstance) { mapInstance.remove(); mapInstance = null; }

        // Medien Container leeren & Antwort-Medien zeigen
        mediaContainer.innerHTML = '';

        if (currentQuestion.type === 'pixel' && currentQuestion.mediaPath) {
             renderMedia(currentQuestion.mediaPath, mediaContainer, false);
        }

        if (currentQuestion.answerMediaPath) {
            renderMedia(currentQuestion.answerMediaPath, mediaContainer, true); // Autoplay
        } else {
            mediaContainer.style.display = 'none';
        }
    }
});

socket.on('board_reveal_map_results', (data: { results: any, players: Record<string, IPlayer>, target: any }) => {
    
    // 1. UI Umschalten
    mediaContainer.style.display = 'none'; 
    questionText.style.display = 'none';  
    mapDiv.style.display = 'block';        

    // 2. TIMEOUT HINZUFÜGEN (Der wichtige Fix!)
    // Wir warten 100ms, damit der Browser das 'display: block' rendern kann,
    // bevor Leaflet die Größe berechnet.
    setTimeout(() => {
        
        // Karte initialisieren, falls noch nicht da
        if (!mapInstance && currentQuestion) {
            initMap(currentQuestion);
        }

        if (!mapInstance) return;

        const map = mapInstance; 
        
        // Leaflet zwingen, die Container-Größe neu zu berechnen
        map.invalidateSize();

        const { results, players, target } = data;
        const bounds: L.LatLngTuple[] = [[target.lat, target.lng]];

        // --- Marker Logik (wie zuvor) ---

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
            
            L.polyline([[target.lat, target.lng], [res.lat, res.lng]], {
                color: player.color, weight: res.isWinner ? 4 : 2, opacity: 0.8, dashArray: '5, 10'
            }).addTo(map);

            bounds.push([res.lat, res.lng]);
        });

        if(bounds.length > 0) {
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
        }
        
    }, 200); // 200ms Verzögerung reicht meistens völlig aus
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

socket.on('board_reveal_estimate_results', (data) => {
    questionText.style.display = 'none'; // Fragetext ausblenden oder klein machen
    answerTextDiv.innerHTML = `LÖSUNG: <span style="color:#ffcc00; font-size:1.5em;">${data.correctAnswer}</span>`;
    answerTextDiv.style.display = 'block';
    
    estimateResultsDiv.style.display = 'block';
    estimateResultsDiv.innerHTML = '';

    // Liste bauen
    data.guesses.forEach((g, index) => {
        const row = document.createElement('div');
        row.className = `estimate-result-row ${g.isWinner ? 'estimate-winner' : ''}`;
        
        // Verzögerte Animation für Spannung (je weiter unten/besser, desto später?) 
        // Oder einfach von oben nach unten.
        row.style.animationDelay = `${index * 0.2}s`;

        const diffDisplay = g.diff % 1 === 0 ? g.diff : g.diff.toFixed(2);
        
        row.innerHTML = `
            <span>${index + 1}. ${g.name}</span>
            <div style="display:flex; gap:20px;">
                <span>Tipp: ${g.value}</span>
                <span style="font-size:0.8em; opacity:0.8;">(Abw: ${diffDisplay})</span>
            </div>
        `;
        estimateResultsDiv.appendChild(row);
    });
});

socket.on('board_play_sfx', (type: 'correct' | 'incorrect') => {
    playSoundEffect(type);
});

socket.on('board_show_freetext_results', (data) => {
    questionText.style.display = 'none'; // Frage ausblenden für mehr Platz (optional)
    freetextContainer.style.display = 'flex';
    freetextContainer.innerHTML = '';

    data.answers.forEach((entry, index) => {
        const card = document.createElement('div');
        card.className = 'freetext-card';
        card.id = `ft-card-${entry.playerId}`; // ID zum Wiederfinden für Punkte
        card.style.animationDelay = `${index * 0.1}s`; // Schöner Kaskaden-Effekt

        card.innerHTML = `
            <div class="ft-player-name">${entry.name}</div>
            <div class="ft-answer-text">${entry.text}</div>
        `;
        freetextContainer.appendChild(card);
    });
});

socket.on('board_freetext_mark_correct', (playerId: string) => {
    const card = document.getElementById(`ft-card-${playerId}`);mapDiv.style.display = 'none';
    if (card) {
        card.classList.add('correct');
        // Optional: Kleiner Konfetti-Effekt oder Haken
        card.innerHTML += `<div style="position:absolute; top:-10px; right:-10px; font-size:2rem;">✅</div>`;
    }
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

function startPixelPuzzle(question: IQuestion) {
    mediaContainer.style.display = 'block';
    mediaContainer.innerHTML = ''; 

    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '60vh'; 
    canvas.style.objectFit = 'contain';
    mediaContainer.appendChild(canvas);

    const img = new Image();
    img.src = question.mediaPath;

    img.onload = () => {
        const maxWidth = 1920; 
        const scale = Math.min(1, maxWidth / img.width);
        canvas.width = Math.floor(img.width * scale);
        canvas.height = Math.floor(img.height * scale);

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        const offCanvas = document.createElement('canvas');
        offCanvas.width = canvas.width;
        offCanvas.height = canvas.height;
        const offCtx = offCanvas.getContext('2d');
        if(!offCtx) return;
        offCtx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const totalDuration = (question.pixelConfig?.resolutionDuration || 30) * 1000;
        const effectType = question.pixelConfig?.effectType || 'pixelate';

        // Shuffle Setup (wie zuvor)
        let shuffleMap: Int32Array | null = null;
        if (effectType === 'shuffle') {
            const totalPixels = canvas.width * canvas.height;
            shuffleMap = new Int32Array(totalPixels);
            for (let i = 0; i < totalPixels; i++) shuffleMap[i] = i;
            for (let i = totalPixels - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffleMap[i], shuffleMap[j]] = [shuffleMap[j], shuffleMap[i]];
            }
        }

        // --- PAUSE / RESUME LOGIK ---
        let startTime = performance.now();
        let pausedTime = 0;
        let isPaused = false;
        let lastPauseStart = 0;

        // Exportiere die Steuerungs-Funktionen für den Socket-Listener
        pixelControlCalls = {
            pause: () => {
                if (!isPaused) {
                    isPaused = true;
                    lastPauseStart = performance.now();
                    cancelAnimationFrame(currentPixelAnim!);
                }
            },
            resume: () => {
                if (isPaused) {
                    isPaused = false;
                    // Die Zeit, die wir pausiert haben, zur "Startzeit" addieren, 
                    // damit der Fortschritt dort weitermacht wo er aufhörte.
                    const pauseDuration = performance.now() - lastPauseStart;
                    startTime += pauseDuration;
                    currentPixelAnim = requestAnimationFrame(animate);
                }
            }
        };

        const animate = (time: number) => {
            if (isPaused) return;

            let elapsed = time - startTime;
            if (elapsed > totalDuration) elapsed = totalDuration;
            const progress = elapsed / totalDuration;

            // --- RENDERING (Logik wie zuvor) ---
            if (effectType === 'pixelate') {
                ctx.imageSmoothingEnabled = false;
                const pixelFactor = 0.005 + (0.995 * progress);
                const w = Math.max(1, Math.floor(canvas.width * pixelFactor));
                const h = Math.max(1, Math.floor(canvas.height * pixelFactor));
                ctx.drawImage(offCanvas, 0, 0, w, h);
                ctx.drawImage(canvas, 0, 0, w, h, 0, 0, canvas.width, canvas.height);
            } 
            else if (effectType === 'twist') {
                const maxTwist = 150; 
                const currentTwist = maxTwist * Math.pow(1 - progress, 4);

                if (currentTwist < 0.05) {
                    ctx.drawImage(offCanvas, 0, 0);
                } else {
                    const imageData = offCtx.getImageData(0, 0, canvas.width, canvas.height);
                    const pixels = imageData.data;
                    const newImageData = ctx.createImageData(canvas.width, canvas.height);
                    const newPixels = newImageData.data;
                    const cx = canvas.width / 2;
                    const cy = canvas.height / 2;
                    const radius = Math.min(cx, cy) * 1.5; 

                    for (let y = 0; y < canvas.height; y++) {
                        for (let x = 0; x < canvas.width; x++) {
                            const dx = x - cx; const dy = y - cy;
                            const dist = Math.sqrt(dx*dx + dy*dy);
                            if (dist < radius) {
                                const angle = Math.atan2(dy, dx);
                                const angleOffset = (1 - dist / radius) * currentTwist;
                                const targetAngle = angle - angleOffset;
                                const sourceX = cx + Math.cos(targetAngle) * dist;
                                const sourceY = cy + Math.sin(targetAngle) * dist;
                                if (sourceX >= 0 && sourceX < canvas.width && sourceY >= 0 && sourceY < canvas.height) {
                                    const srcIdx = (Math.floor(sourceY) * canvas.width + Math.floor(sourceX)) * 4;
                                    const destIdx = (y * canvas.width + x) * 4;
                                    newPixels[destIdx] = pixels[srcIdx]; newPixels[destIdx + 1] = pixels[srcIdx + 1]; newPixels[destIdx + 2] = pixels[srcIdx + 2]; newPixels[destIdx + 3] = pixels[srcIdx + 3]; newPixels[destIdx + 4] = 255;
                                }
                            }
                        }
                    }
                    ctx.putImageData(newImageData, 0, 0);
                }
            } 
            else if (effectType === 'shuffle' && shuffleMap) {
                const imageData = offCtx.getImageData(0, 0, canvas.width, canvas.height);
                const sourcePixels = imageData.data;
                const newImageData = ctx.createImageData(canvas.width, canvas.height);
                const destPixels = newImageData.data;
                const totalPixels = canvas.width * canvas.height;
                const threshold = progress;

                for (let i = 0; i < totalPixels; i++) {
                    const isResolved = ((i * 0.61803398875) % 1) < threshold; 
                    let srcIndex = isResolved ? i : shuffleMap[i];
                    const destI = i * 4; const srcI = srcIndex * 4;
                    destPixels[destI] = sourcePixels[srcI]; destPixels[destI+1] = sourcePixels[srcI+1]; destPixels[destI+2] = sourcePixels[srcI+2]; destPixels[destI+3] = 255;
                }
                ctx.putImageData(newImageData, 0, 0);
            }

            if (elapsed < totalDuration) {
                currentPixelAnim = requestAnimationFrame(animate);
            }
        };
        
        if(currentPixelAnim) cancelAnimationFrame(currentPixelAnim);
        currentPixelAnim = requestAnimationFrame(animate);
    };
}

function playSoundEffect(type: 'correct' | 'incorrect') {
    let src = '';
    
    // Basis-URL für Backend Assets bauen
    const backendBase = `${window.location.protocol}//${window.location.hostname}:3000`;

    if (type === 'correct') {
        if (currentGame?.soundCorrectPath) {
            // Wenn Custom Sound, nutzen wir den Pfad vom Spiel (der hoffentlich schon '/uploads/...' ist)
            // Prüfen ob Pfad absolut ist oder nicht
            src = currentGame.soundCorrectPath.startsWith('http') 
                  ? currentGame.soundCorrectPath 
                  : backendBase + currentGame.soundCorrectPath;
        } else {
            // Standard Sound vom Backend laden
            src = backendBase + '/sounds/default_correct.mp3'; 
        }
    } else {
        if (currentGame?.soundIncorrectPath) {
            src = currentGame.soundIncorrectPath.startsWith('http')
                  ? currentGame.soundIncorrectPath
                  : backendBase + currentGame.soundIncorrectPath;
        } else {
            src = backendBase + '/sounds/default_incorrect.mp3';
        }
    }

    if (src) {
        console.log("Spiele Sound:", src); // Debug log
        const audio = new Audio(src);
        audio.volume = 0.5;
        audio.play().catch(e => console.log("SFX Playback error (Autoplay Blocked?)", e));
    }
}