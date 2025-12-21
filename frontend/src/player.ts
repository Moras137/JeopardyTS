import { socket } from './socket';
import L from 'leaflet';

import 'leaflet/dist/leaflet.css';

// --- 1. DOM ELEMENTE ---
const joinSection = document.getElementById('join-section') as HTMLDivElement;
const gameSection = document.getElementById('game-section') as HTMLDivElement;
const mapInterface = document.getElementById('map-interface') as HTMLDivElement;

const roomInput = document.getElementById('room-code') as HTMLInputElement;
const nameInput = document.getElementById('player-name') as HTMLInputElement;
const joinBtn = document.getElementById('join-btn') as HTMLButtonElement;
const rejoinMsg = document.getElementById('rejoin-msg') as HTMLParagraphElement;
const playerInfoDiv = document.getElementById('player-info') as HTMLDivElement;

const buzzerBtn = document.getElementById('buzzer-button') as HTMLButtonElement;
const statusMsg = document.getElementById('status-message') as HTMLDivElement;

const mapQText = document.getElementById('map-q-text') as HTMLSpanElement;
const confirmGuessBtn = document.getElementById('confirm-guess-btn') as HTMLButtonElement;

const estimateInterface = document.getElementById('estimate-interface') as HTMLDivElement;
const estimateInput = document.getElementById('estimate-input') as HTMLInputElement;
const estimateBtn = document.getElementById('submit-estimate-btn') as HTMLButtonElement;
const estimateQText = document.getElementById('estimate-q-text') as HTMLHeadingElement;
const estimateWaitMsg = document.getElementById('estimate-wait-msg') as HTMLParagraphElement;

const freetextInterface = document.getElementById('freetext-interface') as HTMLDivElement;
const freetextInput = document.getElementById('freetext-input') as HTMLTextAreaElement;
const freetextBtn = document.getElementById('submit-freetext-btn') as HTMLButtonElement;
const freetextQText = document.getElementById('freetext-q-text') as HTMLHeadingElement;
const freetextWaitMsg = document.getElementById('freetext-wait-msg') as HTMLParagraphElement;

// --- 2. STATE VARIABLEN ---
let mySocketId: string | null = null;
let playerName = "";
let playerBuzzed = true; // Startet gesperrt

// Leaflet Variablen
let playerMap: L.Map | null = null;
let playerMarker: L.Marker | null = null;

// Session Storage
let myPlayerId: string | null = null;
let currentRoom: string | null = null;

// Wake Lock Variable (für Bildschirm wachhalten)
let wakeLock: any = null; 

// --- 3. INITIALISIERUNG ---

document.addEventListener('DOMContentLoaded', () => {
    // URL Parameter prüfen (z.B. vom QR Code)
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get('room');

    if (roomFromUrl && roomInput) {
        roomInput.value = roomFromUrl;
        if (nameInput) nameInput.focus();
    }

    // LocalStorage prüfen (Rejoin)
    const savedSession = localStorage.getItem('jeopardy_session');
    if (savedSession) {
        try {
            const data = JSON.parse(savedSession);
            if(data.roomCode && data.name && data.playerId) {
                rejoinMsg.style.display = 'block';
                console.log("Versuche Rejoin...", data);

                socket.emit('player_join_session', {
                    roomCode: data.roomCode,
                    name: data.name,
                    existingPlayerId: data.playerId
                });
            }
        } catch (e) {
            console.error("Fehler beim Parsen der Session", e);
            localStorage.removeItem('jeopardy_session');
        }
    }
});

// Event Listener für Wake Lock Re-Acquire (wenn Tab gewechselt wurde)
document.addEventListener('visibilitychange', async () => {
    if (wakeLock !== null && document.visibilityState === 'visible') {
        await requestWakeLock();
    }
});

// --- 4. EVENT LISTENER (User Aktionen) ---

joinBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    const code = roomInput.value.trim();

    if (name && code) {
        socket.emit('player_join_session', { roomCode: code, name: name });
    } else {
        alert("Bitte Name und Raum-Code eingeben!");
    }
});

buzzerBtn.addEventListener('click', () => {
    if (!playerBuzzed) {
        // Lokales Feedback sofort anzeigen
        playerBuzzed = true;
        setBuzzerState('waiting');
        
        if (mySocketId) {
            socket.emit('player_buzz', { id: mySocketId, name: playerName });
        }
    }
});

confirmGuessBtn.addEventListener('click', () => {
    if (!playerMarker) return;

    const lat = playerMarker.getLatLng().lat;
    const lng = playerMarker.getLatLng().lng;

    socket.emit('player_submit_map_guess', { lat, lng });

    // UI Feedback
    mapQText.innerText = "Tipp gesendet! Warte auf Auflösung...";
    confirmGuessBtn.style.display = 'none';

    // Karte sperren
    if (playerMap) {
        playerMap.off('click');
        playerMap.dragging.disable();
        playerMap.touchZoom.disable();
        playerMap.scrollWheelZoom.disable();
        playerMap.doubleClickZoom.disable();
        playerMap.boxZoom.disable();
    }
});

if(estimateBtn) {
    estimateBtn.addEventListener('click', () => {
        const val = parseFloat(estimateInput.value);
        if (isNaN(val)) {
            alert("Bitte eine gültige Zahl eingeben.");
            return;
        }
        socket.emit('player_submit_estimate', val);
        
        // UI Feedback
        estimateInput.style.display = 'none';
        estimateBtn.style.display = 'none';
        estimateWaitMsg.style.display = 'block';
    });
}

if(freetextBtn) {
    freetextBtn.addEventListener('click', () => {
        const text = freetextInput.value.trim();
        if (!text) {
            alert("Bitte eine Antwort eingeben.");
            return;
        }
        socket.emit('player_submit_freetext', text);
        
        // UI Feedback
        freetextInput.style.display = 'none';
        freetextBtn.style.display = 'none';
        freetextWaitMsg.style.display = 'block';
    });
}

// --- 5. SOCKET EVENTS (Server Antworten) ---

socket.on('connect', () => {
    mySocketId = socket.id ?? null;
});

socket.on('join_success', (data) => {
    myPlayerId = data.playerId;
    currentRoom = data.roomCode;
    playerName = data.name;

    // Speichern für Reconnect
    localStorage.setItem('jeopardy_session', JSON.stringify({
        playerId: myPlayerId,
        roomCode: currentRoom,
        name: data.name
    }));

    // UI Wechsel
    joinSection.style.display = 'none';
    gameSection.style.display = 'flex';
    playerInfoDiv.innerText = `${data.name}`;
    
    // Reset für den Fall eines Rejoins mitten im Spiel
    setBuzzerState('locked');

    // WAKE LOCK AKTIVIEREN
    requestWakeLock();
});

socket.on('join_error', (msg) => {
    alert("Fehler: " + msg);
    localStorage.removeItem('jeopardy_session');
    rejoinMsg.style.display = 'none';
    joinSection.style.display = 'flex';
    gameSection.style.display = 'none';
});

// --- BUZZER LOGIK ---

socket.on('buzzers_unlocked', (lockedIds?: string[]) => {
    if (myPlayerId && lockedIds && lockedIds.includes(myPlayerId)) {
        playerBuzzed = true;
        setBuzzerState('locked'); 
        const statusMsg = document.getElementById('status-message');
        if(statusMsg) statusMsg.innerText = "Du hast bereits geantwortet.";
        return;
    }

    playerBuzzed = false;
    setBuzzerState('active');
});

socket.on('buzzers_locked', () => {
    playerBuzzed = true;
    setBuzzerState('locked');
});

socket.on('player_won_buzz', (data) => {
    setBuzzerState('locked');
    
    if (data.id === myPlayerId) { 
        statusMsg.innerText = 'DU BIST DRAN!';
        document.body.style.backgroundColor = '#155724'; // Dunkelgrün
        // Vibrations-Feedback (falls unterstützt)
        if(navigator.vibrate) navigator.vibrate(200);
    } else {
        statusMsg.innerText = `${data.name} ist dran!`;
        document.body.style.backgroundColor = 'var(--bg-body)';
    }
});

// --- MAP LOGIK ---

socket.on('player_start_map_guess', (data) => {
    console.log("Map Modus gestartet", data);

    // UI Umschalten
    gameSection.style.display = 'none';
    mapInterface.style.display = 'flex';
    mapQText.innerText = data.questionText || "Wo liegt das?";
    confirmGuessBtn.style.display = 'none';
    document.body.style.backgroundColor = 'var(--bg-body)';

    // Karte initialisieren (Verzögerung für DOM Rendering)
    setTimeout(() => {
        if (playerMap) {
            playerMap.remove();
            playerMap = null;
        }

        playerMarker = null;

        playerMap = L.map('player-map', {
            center: [0, 0],
            zoomSnap: 0.5,
            zoomControl: false, // Mobil besser ohne Zoom-Buttons
            attributionControl: false,
            crs: L.CRS.Simple,
            minZoom: -5
        });

        const location = data.location;

        playerMap.invalidateSize();

        if (location && location.isCustomMap && location.customMapPath) {
            // --- CUSTOM MAP ---
            const h = location.mapHeight;
            const w = location.mapWidth;

            const bounds: L.LatLngBoundsExpression = [[0, 0], [h, w]];
            L.imageOverlay(location.customMapPath, bounds).addTo(playerMap);
            playerMap.fitBounds(bounds);
        } else {
            // --- WELTKARTE ---
            playerMap.options.crs = L.CRS.EPSG3857; 
            playerMap.setView([0, 0], 2);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19
            }).addTo(playerMap);

            playerMap.invalidateSize();
        }

        // Klick Event
        playerMap.on('click', (e: L.LeafletMouseEvent) => {
            if (!playerMap) return;

            if (playerMarker) {
                playerMarker.setLatLng(e.latlng);
            } else {
                playerMarker = L.marker(e.latlng).addTo(playerMap);
            }
            confirmGuessBtn.style.display = 'block';
        });

    }, 200);
});

// --- RESET LOGIK ---

socket.on('board_hide_question', () => {
    // Map verstecken
    mapInterface.style.display = 'none';
    
    // Wenn eingeloggt, zeige Buzzer Screen wieder
    if (myPlayerId) {
        gameSection.style.display = 'flex';
        setBuzzerState('locked');
        statusMsg.innerText = "Warte auf nächste Frage...";
        document.body.style.backgroundColor = 'var(--bg-body)';
    }

    // Karte aufräumen
    if (playerMap) {
        playerMap.remove();
        playerMap = null;
    }

    estimateInterface.style.display = 'none';
    estimateInput.value = '';                 
    estimateBtn.style.display = 'block';      
    estimateInput.style.display = 'block';    
    estimateWaitMsg.style.display = 'none';

    freetextInterface.style.display = 'none';
    freetextInput.value = '';
    freetextBtn.style.display = 'block';
    freetextInput.style.display = 'block';
    freetextWaitMsg.style.display = 'none';
});

socket.on('session_ended', () => {
    alert("Der Host hat das Spiel beendet.");
    localStorage.removeItem('jeopardy_session');
    
    // Wake Lock freigeben
    if(wakeLock) {
        wakeLock.release().then(() => wakeLock = null);
    }
    
    location.reload();
});

socket.on('player_new_question', (data: { text: string, points: number }) => {
    // UI Reset für Standard-Frage
    mapInterface.style.display = 'none';
    freetextInterface.style.display = 'none';
    estimateInterface.style.display = 'none';
    gameSection.style.display = 'flex';
    statusMsg.innerText = "Frage aktiv!";
    document.body.style.backgroundColor = 'var(--bg-body)';

});

socket.on('player_start_estimate', (data) => {
    // UI Reset
    gameSection.style.display = 'none';
    mapInterface.style.display = 'none';
    freetextInterface.style.display = 'none';
    estimateInterface.style.display = 'flex';
    
    estimateQText.innerText = data.text;
    estimateInput.value = '';
    
    estimateInput.style.display = 'block';
    estimateBtn.style.display = 'block';
    estimateWaitMsg.style.display = 'none';
    
    document.body.style.backgroundColor = 'var(--bg-body)';
});

socket.on('player_start_freetext', (data) => {
    // UI Reset
    gameSection.style.display = 'none';
    mapInterface.style.display = 'none';
    estimateInterface.style.display = 'none';
    freetextInterface.style.display = 'flex';
    
    freetextQText.innerText = data.text;
    freetextInput.value = '';
    
    freetextInput.style.display = 'block';
    freetextBtn.style.display = 'block';
    freetextWaitMsg.style.display = 'none';
    
    document.body.style.backgroundColor = 'var(--bg-body)';
});

// --- HELPER ---

function setBuzzerState(state: 'active' | 'locked' | 'waiting') {
    if (state === 'active') {
        buzzerBtn.style.backgroundColor = 'var(--btn-buzz-active)';
        buzzerBtn.innerText = "DRÜCKEN!";
        statusMsg.innerText = 'LOS!';
    } else if (state === 'waiting') {
        buzzerBtn.style.backgroundColor = 'var(--btn-buzz-wait)';
        buzzerBtn.innerText = "...";
    } else {
        buzzerBtn.style.backgroundColor = 'var(--btn-buzz-locked)';
        buzzerBtn.innerText = "GESPERRT";
        if(statusMsg.innerText === 'LOS!') statusMsg.innerText = 'Gesperrt';
    }
}

// Funktion um Screen Lock zu verhindern
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await (navigator as any).wakeLock.request('screen');
            console.log('Screen Wake Lock aktiv');
            
            wakeLock.addEventListener('release', () => {
                console.log('Screen Wake Lock wurde freigegeben');
            });
        }
    } catch (err) {
        console.error(`Wake Lock Fehler: ${err}`);
    }
}