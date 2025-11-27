import { socket } from './socket';
import L, { map } from 'leaflet';

// Falls das CSS nicht im HTML ist, kann man es oft so importieren (Vite kümmert sich darum):
import 'leaflet/dist/leaflet.css';

// --- 1. DOM ELEMENTE ---
// Wir holen alle Elemente sicher ab und casten sie auf den richtigen Typ.
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

// --- 2. STATE VARIABLEN ---
let myId: string | null = null;
let playerName = "";
let playerBuzzed = true; // Startet gesperrt

// Leaflet Variablen (können null sein, bevor die Map initialisiert ist)
let playerMap: L.Map | null = null;
let playerMarker: L.Marker | null = null;

// Session Storage
let myPlayerId: string | null = null;
let currentRoom: string | null = null;

// --- 3. INITIALISIERUNG (window.onload Ersatz) ---

// URL Parameter prüfen (z.B. vom QR Code)
const urlParams = new URLSearchParams(window.location.search);
const urlRoom = urlParams.get('room');
if (urlRoom) {
    roomInput.value = urlRoom;
}

// LocalStorage prüfen
const savedSession = localStorage.getItem('jeopardy_session');
if (savedSession) {
    try {
        const data = JSON.parse(savedSession);
        rejoinMsg.style.display = 'block';
        console.log("Versuche Rejoin...", data);

        socket.emit('player_join_session', {
            roomCode: data.roomCode,
            name: data.name,
            existingPlayerId: data.playerId
        });
    } catch (e) {
        console.error("Fehler beim Parsen der Session", e);
    }
}

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
        // Lokales Feedback
        playerBuzzed = true;
        buzzerBtn.style.backgroundColor = '#ffc107'; // Gelb
        buzzerBtn.innerText = "...";
        
        // Da socket.id undefined sein könnte, nutzen wir myId oder einen Fallback
        if (myId) {
            socket.emit('player_buzz', { id: myId, name: playerName });
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
    }
});

// --- 5. SOCKET EVENTS (Server Antworten) ---

socket.on('connect', () => {
    myId = socket.id ?? null;
    console.log("Verbunden mit Socket ID:", myId);
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
    playerInfoDiv.innerText = `${data.name} (Raum: ${currentRoom})`;
});

socket.on('join_error', (msg) => {
    alert("Fehler: " + msg);
    localStorage.removeItem('jeopardy_session');
    rejoinMsg.style.display = 'none';
});

// --- BUZZER LOGIK ---

socket.on('buzzers_unlocked', () => {
    playerBuzzed = false;
    buzzerBtn.style.backgroundColor = '#28a745'; // Grün
    buzzerBtn.innerText = "DRÜCKEN!";
    statusMsg.innerText = 'LOS!';
    document.body.style.backgroundColor = '#222';
});

socket.on('buzzers_locked', () => {
    playerBuzzed = true;
    buzzerBtn.style.backgroundColor = '#dc3545'; // Rot
    buzzerBtn.innerText = "GESPERRT";
    statusMsg.innerText = 'Gesperrt';
});

socket.on('player_won_buzz', (data) => {
    buzzerBtn.style.backgroundColor = '#dc3545';
    buzzerBtn.innerText = "GESPERRT";
    
    // Vergleich mit der gespeicherten PlayerId ist sicherer als SocketID (wegen Reconnects)
    // Aber data.id kommt vom Server, hier muss man prüfen, ob der Server socket.id oder player.id sendet.
    // Laut deinem Server-Code sendet er die 'playerId'.
    
    if (data.id === myPlayerId) { 
        statusMsg.innerText = 'DU BIST DRAN!';
        document.body.style.backgroundColor = '#155724'; // Dunkelgrün
    } else {
        statusMsg.innerText = `${data.name} ist dran!`;
        document.body.style.backgroundColor = '#222';
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
    document.body.style.backgroundColor = '#222';

    // Karte initialisieren (Verzögerung für DOM Rendering)
    setTimeout(() => {
        if (playerMap) {
            playerMap.remove();
            playerMap = null;
            playerMarker = null;
        }

        // Wir nutzen Leaflet Types hier!
        playerMap = L.map('player-map', {
                    center: [0, 0],
                    zoomSnap: 0.5,
                    zoomControl: true,
                    attributionControl: false,
                    crs: L.CRS.Simple
                });

        const location = data.location;

        if (location && location.isCustomMap && location.customMapPath) {
            // --- CUSTOM MAP ---
            // Wir müssen die Karte auf "Simple" CRS umstellen für flache Bilder
            const bounds: L.LatLngBoundsExpression = [[0, 0], [location.mapHeight, location.mapWidth]];
            
            L.imageOverlay(location.customMapPath, bounds).addTo(playerMap);
            playerMap.fitBounds(bounds);
        } else {
            // --- WELTKARTE ---
            playerMap.options.crs = L.CRS.EPSG3857; // Zurücksetzen auf Standard
            playerMap.setView([0, 0], 2);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19
            }).addTo(playerMap);
        }

        playerMap.invalidateSize();

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
    
    // Wenn eingeloggt, zeige Buzzer
    if (myPlayerId) {
        gameSection.style.display = 'flex';
        // Reset Status
        buzzerBtn.style.backgroundColor = '#dc3545';
        buzzerBtn.innerText = "GESPERRT";
        statusMsg.innerText = "Warte...";
        document.body.style.backgroundColor = '#222';
    }

    // Karte aufräumen
    if (playerMap) {
        playerMap.remove();
        playerMap = null;
    }
});

socket.on('session_ended', () => {
    alert("Der Host hat das Spiel beendet.");
    localStorage.removeItem('jeopardy_session');
    location.reload();
});