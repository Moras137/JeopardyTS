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
let mapIsCustomMode = false;

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
const listContainer = document.getElementById('list-container') as HTMLDivElement;
const estimateResultsDiv = document.getElementById('estimate-results') as HTMLDivElement;
const freetextContainer = document.getElementById('freetext-container') as HTMLDivElement;
const podiumOverlay = document.getElementById('podium-overlay') as HTMLDivElement;

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
    //introSub.innerText = subtext || '';
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

    questionText.style.display = 'flex';

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

    // 1. Frage-Elemente ausblenden
    questionText.style.display = 'none';
    if(listContainer) listContainer.style.display = 'none'; // Liste weg (aus vorherigem Fix)

    // 2. Lösungstext zeigen
    answerTextDiv.innerHTML = `<span style="color:var(--text-success); font-size:0.5em; display:block;">LÖSUNG:</span>${currentQuestion.answerText || ''}`;
    answerTextDiv.style.display = 'block';

    // 3. Pixel-Animation stoppen (falls aktiv)
    if (currentPixelAnim) {
        cancelAnimationFrame(currentPixelAnim);
        currentPixelAnim = null;
    }

    // 4. Medien-Logik
    if (currentQuestion.type === 'map' && currentQuestion.location) {
        // Map-Logik bleibt unberührt (wird über map_results gesteuert)
    } else {
        // Map aufräumen
        mapDiv.style.display = 'none';
        if (mapInstance) { mapInstance.remove(); mapInstance = null; }

        // Medien-Container leeren (Canvas oder altes Bild entfernen)
        mediaContainer.innerHTML = '';
        
        let showMedia = false;

        // FALL A: Pixel-Puzzle -> Originalbild anzeigen
        if (currentQuestion.type === 'pixel' && currentQuestion.mediaPath) {
             renderMedia(currentQuestion.mediaPath, mediaContainer, false);
             showMedia = true;
        }

        // FALL B: Explizites Antwort-Medium (überschreibt Pixel-Bild, falls vorhanden)
        if (currentQuestion.answerMediaPath) {
            mediaContainer.innerHTML = ''; // Container leeren für Antwort-Medium
            renderMedia(currentQuestion.answerMediaPath, mediaContainer, false); // Autoplay
            showMedia = true;
        }

        // Container nur anzeigen, wenn auch wirklich was drin ist
        mediaContainer.style.display = showMedia ? 'block' : 'none';
    }
});

socket.on('board_reveal_map_results', (data) => {
    // 1. UI ZURÜCKSETZEN
    questionText.style.display = 'none';
    mediaContainer.style.display = 'none';
    if(listContainer) listContainer.style.display = 'none';
    if(estimateResultsDiv) estimateResultsDiv.style.display = 'none';
    
    // Karte sichtbar machen
    mapDiv.style.display = 'block';

    const { results, players, target } = data;
    if (!target) return;

    // --- LOGIK FÜR KARTEN-WECHSEL ---
    const targetIsCustom = !!target.isCustomMap;

    // Falls Karte existiert, aber falscher Modus -> Zerstören
    if (mapInstance) {
        if (mapIsCustomMode !== targetIsCustom) {
            mapInstance.remove();
            mapInstance = null;
        }
    }

    // Falls Karte nicht existiert (oder gerade zerstört wurde) -> Neu bauen
    if (!mapInstance) {
        if (targetIsCustom) {
            mapInstance = L.map('q-map', {
                crs: L.CRS.Simple,
                minZoom: -5,
                zoomControl: false,
                attributionControl: false
            });
        } else {
            mapInstance = L.map('q-map', {
                crs: L.CRS.EPSG3857,
                zoomControl: false,
                attributionControl: false
            });
        }
        mapIsCustomMode = targetIsCustom;
    }
    // --------------------------------

    // 2. TIMEOUT BLOCK (Rendering)
    setTimeout(() => {
        if (!mapInstance) return;
        const map = mapInstance;
        
        map.invalidateSize();

        // Layer aufräumen: Alles weg außer dem passenden Hintergrund
        map.eachLayer((layer) => {
            if (targetIsCustom) {
                // Bei Custom Maps behalten wir nur das Bild (ImageOverlay)
                if (layer instanceof L.ImageOverlay) return;
            } else {
                // Bei Weltkarten behalten wir nur die Kacheln (TileLayer)
                if (layer instanceof L.TileLayer) return;
            }
            map.removeLayer(layer);
        });

        // Hintergrund laden, falls er fehlt (z.B. nach Neustart der Map)
        let hasBackground = false;
        map.eachLayer(l => {
            if (targetIsCustom && l instanceof L.ImageOverlay) hasBackground = true;
            if (!targetIsCustom && l instanceof L.TileLayer) hasBackground = true;
        });

        if (!hasBackground) {
            if (targetIsCustom && target.customMapPath) {
                const w = target.mapWidth || 1000;
                const h = target.mapHeight || 1000;
                const bounds: L.LatLngBoundsExpression = [[0, 0], [h, w]];
                L.imageOverlay(target.customMapPath, bounds).addTo(map);
                map.fitBounds(bounds);
            } else {
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    maxZoom: 19
                }).addTo(map);
                map.setView([0, 0], 2);
            }
        }

        const targetLatLng = L.latLng(target.lat, target.lng);
        let bounds: L.LatLngBounds;

        // --- ZIEL MARKER ---
        if (target.zone && target.zone.length > 2) {
            // FALL A: Zonen-Frage -> Polygon zeichnen, KEINE Flagge
            const poly = L.polygon(target.zone, {
                color: '#28a745',
                fillColor: '#28a745',
                fillOpacity: 0.3,
                weight: 2,
                dashArray: '5, 5'
            }).addTo(map);
            
            // Bounds auf die Zone setzen
            bounds = poly.getBounds();
        
        } else {
            // FALL B: Punkt-Frage -> Flagge & Radius zeichnen
            bounds = L.latLngBounds([targetLatLng]);

            const targetIcon = L.divIcon({
                className: 'map-target-icon',
                html: `<div style="font-size:2rem; filter: drop-shadow(0 0 5px white); line-height:1;">🚩</div>`,
                iconSize: [30, 30],
                iconAnchor: [10, 28] 
            });
            L.marker(targetLatLng, { icon: targetIcon, zIndexOffset: 2000 }).addTo(map);

            // Radius Kreis
            if (target.radius && target.radius > 0) {
                const circle = L.circle(targetLatLng, {
                    color: '#28a745',       
                    fillColor: '#28a745',
                    fillOpacity: 0.2,
                    radius: target.radius,
                    weight: 1
                }).addTo(map);
                bounds.extend(circle.getBounds());
            }
        }
        // --- SPIELER MARKER ---
        Object.keys(results).forEach((pid) => {
            const r = results[pid];
            const p = players[pid];
            if (!p) return;

            const playerLatLng = L.latLng(r.lat, r.lng);
            bounds.extend(playerLatLng);

            const isWin = r.isWinner;
            const size = isWin ? 30 : 18;

            let distText = '';
            if (target.isCustomMap) {
                distText = Math.round(r.distance) + ' px';
            } else {
                if (r.distance >= 1000) {
                    distText = (r.distance / 1000).toFixed(2) + ' km';
                } else {
                    distText = Math.round(r.distance) + ' m';
                }
            }

            const shadow = isWin ? '0 0 15px #ffcc00' : '0 2px 4px rgba(0,0,0,0.5)';
            const fontSize = isWin ? '1.2rem' : '0';

            const markerHtml = `
                <div style="
                    background-color: ${p.color}; 
                    width: ${size}px; height: ${size}px; 
                    border-radius: 50%; 
                    border: 2px solid white;
                    box-shadow: ${shadow};
                    display: flex; align-items: center; justify-content: center;
                    color: white; font-weight: bold; font-size: ${fontSize};
                    box-sizing: border-box;
                ">
                    ${isWin ? '✓' : ''}
                </div>
                <div style="
                    position: absolute; top: -35px; left: 50%; transform: translateX(-50%);
                    background: rgba(0,0,0,0.85); color: white; padding: 4px 8px; border-radius: 4px;
                    font-size: 0.8rem; white-space: nowrap; pointer-events: none;
                    text-align: center; line-height: 1.2; z-index: 3000;
                    border: 1px solid #555;
                ">
                    <span style="font-weight:bold; color:${p.color}">${p.name}</span><br>
                    <span style="font-size:0.75em; color:#ccc;">${distText}</span>
                </div>
            `;

            const icon = L.divIcon({
                className: 'player-map-marker',
                html: markerHtml,
                iconSize: [size, size],
                iconAnchor: [size / 2, size / 2] // ZENTRIERT
            });

            const marker = L.marker(playerLatLng, { icon }).addTo(map);

            // Linie zum Ziel
            if (!(target.zone && target.zone.length > 0)) {
                const dashArrayValue = isWin ? undefined : '5, 10';
                L.polyline([playerLatLng, targetLatLng], { 
                    color: isWin ? '#28a745' : '#666', 
                    weight: isWin ? 3 : 1, 
                    dashArray: dashArrayValue,
                    opacity: isWin ? 0.8 : 0.5 
                }).addTo(map);
            }
            
            if (isWin) marker.setZIndexOffset(2500);
        });

        // --- ZOOM ANPASSEN ---
        const maxZ = target.isCustomMap ? 2 : 16;
        map.fitBounds(bounds, { 
            padding: [50, 50], 
            maxZoom: maxZ,
            animate: true 
        });

    }, 200);
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

    mediaContainer.style.display = 'none'; 
    mediaContainer.innerHTML = '';      
    mapDiv.style.display = 'none';

    // Liste bauen
    data.guesses.forEach((g, index) => {
        const row = document.createElement('div');
        row.className = `estimate-result-row ${g.isWinner ? 'estimate-winner' : ''}`;
        
        // Verzögerte Animation für Spannung (je weiter unten/besser, desto später?) 
        // Oder einfach von oben nach unten.
        row.style.animationDelay = `${index * 0.2}s`;

        const diffDisplay = g.diff % 1 === 0 ? g.diff : g.diff.toFixed(2);
        
        row.innerHTML = `
            <span style="font-weight:bold; text-align:left;">${index + 1}. ${g.name}</span>
            <div style="display:flex; gap:15px; align-items:center;">
                <span style="background:#eee; color:#000; padding:2px 10px; border-radius:4px;">${g.value}</span>
                <span style="font-size:0.6em; opacity:0.7;">(±${diffDisplay})</span>
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

    mediaContainer.style.display = 'none';
    mediaContainer.innerHTML = '';

    estimateResultsDiv.style.display = 'none';
    estimateResultsDiv.innerHTML = '';
    mapDiv.style.display = 'none';

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

socket.on('board_freetext_update_state', (data: { playerId: string, status: 'correct' | 'incorrect' | 'none' }) => {
    const card = document.getElementById(`ft-card-${data.playerId}`);
    if (!card) return;

    // Klassen bereinigen
    card.classList.remove('correct', 'incorrect');
    
    // Alte Icons entfernen (falls vorhanden)
    const oldIcon = card.querySelector('.ft-status-icon');
    if (oldIcon) oldIcon.remove();

    if (data.status === 'correct') {
        card.classList.add('correct');
        card.innerHTML += `<div class="ft-status-icon" style="position:absolute; top:-10px; right:-10px; font-size:2rem; background:white; border-radius:50%;">✅</div>`;
    } else if (data.status === 'incorrect') {
        card.classList.add('incorrect'); // CSS Klasse gleich hinzufügen
        card.innerHTML += `<div class="ft-status-icon" style="position:absolute; top:-10px; right:-10px; font-size:2rem; background:white; border-radius:50%;">❌</div>`;
    }
});

// 2. Falls du socket.on('board_show_freetext_results') hast, pass auf, dass dort eventuell der Status schon initial gesetzt wird:
socket.on('board_show_freetext_results', (data) => {
    questionText.style.display = 'none';
    freetextContainer.style.display = 'flex';
    freetextContainer.innerHTML = '';

    data.answers.forEach((entry, index) => {
        const card = document.createElement('div');
        card.className = 'freetext-card';
        card.id = `ft-card-${entry.playerId}`;
        card.style.animationDelay = `${index * 0.1}s`;

        card.innerHTML = `
            <div class="ft-player-name">${entry.name}</div>
            <div class="ft-answer-text">${entry.text}</div>
        `;
        freetextContainer.appendChild(card);

        // Status direkt anwenden, falls beim Reload schon bewertet
        if (entry.status) {
            // Um Code-Duplizierung zu vermeiden, rufen wir einfach das Update manuell auf
            // (Simulierter Aufruf wäre sauberer, aber hier direkt Logik:)
            if(entry.status === 'correct') {
                card.classList.add('correct');
                card.innerHTML += `<div class="ft-status-icon" style="position:absolute; top:-10px; right:-10px; font-size:2rem; background:white; border-radius:50%;">✅</div>`;
            } else if (entry.status === 'incorrect') {
                card.classList.add('incorrect');
                card.innerHTML += `<div class="ft-status-icon" style="position:absolute; top:-10px; right:-10px; font-size:2rem; background:white; border-radius:50%;">❌</div>`;
            }
        }
    });
});

socket.on('board_show_podium', (sortedPlayers: IPlayer[]) => {
    // Alles andere ausblenden
    questionOverlay.style.display = 'none';
    introOverlay.style.display = 'none';
    gameGrid.style.display = 'none';
    playerBar.style.display = 'none'; // Auch die Leiste unten weg

    podiumOverlay.style.display = 'flex';

    // Platz 1
    const p1 = sortedPlayers[0];
    const p1Name = document.getElementById('p1-name');
    const p1Score = document.getElementById('p1-score');
    if (p1 && p1Name && p1Score) {
        p1Name.innerText = p1.name;
        p1Score.innerText = p1.score.toString();
    } else {
        // Falls keiner da ist (sollte nicht passieren)
        if(p1Name) p1Name.parentElement!.style.visibility = 'hidden';
    }

    // Platz 2
    const p2 = sortedPlayers[1];
    const p2Name = document.getElementById('p2-name');
    const p2Score = document.getElementById('p2-score');
    if (p2 && p2Name && p2Score) {
        p2Name.innerText = p2.name;
        p2Score.innerText = p2.score.toString();
        p2Name.parentElement!.style.visibility = 'visible';
    } else {
        if(p2Name) p2Name.parentElement!.style.visibility = 'hidden';
    }

    // Platz 3
    const p3 = sortedPlayers[2];
    const p3Name = document.getElementById('p3-name');
    const p3Score = document.getElementById('p3-score');
    if (p3 && p3Name && p3Score) {
        p3Name.innerText = p3.name;
        p3Score.innerText = p3.score.toString();
        p3Name.parentElement!.style.visibility = 'visible';
    } else {
        if(p3Name) p3Name.parentElement!.style.visibility = 'hidden';
    }

    // Konfetti starten
    startConfetti();

    // Optional: Sound abspielen (Gewinner Sound)
    // playSoundEffect('correct'); 
});

socket.on('board_media_control', (data) => {
    // Wir suchen nach Audio oder Video Elementen im Medien-Container
    const mediaEl = document.querySelector('#media-container video, #media-container audio') as HTMLMediaElement;
    
    // Falls kein Medium da ist, brechen wir ab
    if (!mediaEl) return;

    // 1. Zeit synchronisieren (falls Abweichung größer als 0.5s)
    if (Math.abs(mediaEl.currentTime - data.currentTime) > 0.5) {
        mediaEl.currentTime = data.currentTime;
    }

    // 2. Aktion ausführen
    if (data.action === 'play') {
        // Play muss oft mit catch abgefangen werden (Browser-Richtlinien)
        mediaEl.play().catch(e => console.log("Autoplay blocked or error:", e));
    } else if (data.action === 'pause') {
        mediaEl.pause();
    } else if (data.action === 'seek') {
        mediaEl.currentTime = data.currentTime;
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
    const targetIsCustom = !!question.location?.isCustomMap;

    // PRÜFUNG: Muss die Karte neu erstellt werden?
    if (mapInstance) {
        // Wenn wir von Welt auf Custom (oder umgekehrt) wechseln -> Karte zerstören
        if (mapIsCustomMode !== targetIsCustom) {
            mapInstance.remove();
            mapInstance = null;
        }
    }

    // Wenn Karte (noch) nicht existiert -> Neu erstellen mit korrektem CRS
    if (!mapInstance) {
        if (targetIsCustom) {
            // CUSTOM MAP (BILD) -> CRS.Simple
            mapInstance = L.map('q-map', {
                crs: L.CRS.Simple,
                minZoom: -5,
                zoomControl: false,
                attributionControl: false
            });
        } else {
            // WELTKARTE -> Standard
            mapInstance = L.map('q-map', {
                crs: L.CRS.EPSG3857,
                zoomControl: false,
                attributionControl: false
            });
        }
        mapIsCustomMode = targetIsCustom; // Modus merken
    }
    
    // Größe sofort aktualisieren
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
    // Wir sortieren hier optional auch nach Score, damit die Reihenfolge stabil bleibt
    const sorted = Object.values(players).sort((a, b) => b.score - a.score);

    for (const p of sorted) {
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
    
    const backendBase = `${window.location.protocol}//${window.location.hostname}:3000`;

    if (type === 'correct') {
        if (currentGame?.soundCorrectPath) {
            src = currentGame.soundCorrectPath.startsWith('http') 
                  ? currentGame.soundCorrectPath 
                  : backendBase + currentGame.soundCorrectPath;
        } else {
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
        console.log("Spiele Sound:", src); 
        const audio = new Audio(src);
        audio.volume = 0.5;
        audio.play().catch(e => console.log("SFX Playback error (Autoplay Blocked?)", e));
    }
}

function startConfetti() {
    const container = document.getElementById('confetti-container');
    if(!container) return;

    const colors = ['#ff0', '#f00', '#0f0', '#00f', '#f0f', '#0ff'];

    // Erzeuge 100 Konfetti-Schnipsel
    for(let i=0; i<150; i++) {
        const div = document.createElement('div');
        div.className = 'confetti';
        div.style.left = Math.random() * 100 + 'vw';
        div.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        div.style.animationDuration = (Math.random() * 3 + 2) + 's';
        div.style.top = -10 + 'px';
        container.appendChild(div);
    }
}