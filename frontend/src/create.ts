import L from 'leaflet';
// Interfaces importieren
import { IGame, ICategory, IQuestion, QuestionType } from '../../src/types';

// Typendefinition für das globale Window, damit TS nicht meckert
declare global {
    interface Window {
        uploadFile: (input: HTMLInputElement, previewId: string, hiddenInputId: string) => void;
        uploadCustomMap: (input: HTMLInputElement, qId: string) => void;
        toggleMapSource: (qId: string, source: string) => void;
        checkQuestionFilled: (el: HTMLElement) => void;
        switchView: (mode: string) => void;
        removeBackground: () => void;
        changeQuestionType: (select: HTMLSelectElement, qId: string) => void;
        startGame: (id: string) => void;
        deleteGame: (id: string) => void;
        loadGame: (id: string) => void;
        toggleTheme: () => void;
    }
}

// --- STATE ---
let editingGameId: string | null = null;
let currentCategoriesCount = 0;
let filesToDeleteOnSave: string[] = [];
const mapInstances: Record<string, L.Map> = {}; // Speichert Leaflet Instanzen

// --- DOM ELEMENTE ---
const container = document.getElementById('categories-container') as HTMLDivElement;
const titleInput = document.getElementById('gameTitle') as HTMLInputElement;
const numCatInput = document.getElementById('numCategories') as HTMLInputElement;
const numQInput = document.getElementById('numQuestions') as HTMLInputElement;

// --- INIT ---
// Event Listener für statische Buttons
document.getElementById('btn-new-quiz')?.addEventListener('click', () => clearForm());
document.getElementById('btn-save')?.addEventListener('click', saveGame);
document.getElementById('btn-remove-bg')?.addEventListener('click', removeBackground);

document.getElementById('numCategories')?.addEventListener('change', updateQuizStructure);
document.getElementById('numQuestions')?.addEventListener('change', updateQuizStructure);

// Upload Listener für Hintergrundbild (statisch)
document.getElementById('boardBackgroundUpload')?.addEventListener('change', function(this: HTMLInputElement) {
    uploadFile(this, 'preview-background', 'background-path');
});

// Start: Liste laden
loadGameList();
//clearForm();

// --- 1. GLOBALE FUNKTIONEN (für onclick="" im HTML) ---

// Datei Upload Helper
async function uploadFile(inputElement: HTMLInputElement, previewId: string, hiddenInputId: string) {
    const statusEl = inputElement.nextElementSibling as HTMLElement;
    const previewContainer = document.getElementById(previewId) as HTMLDivElement;
    const hiddenInput = document.getElementById(hiddenInputId) as HTMLInputElement;
    
    // Preview Image Element suchen (könnte img oder video sein, wir suchen im Container)
    let imgPreview = previewContainer.querySelector('img.media-preview') as HTMLImageElement;

    const file = inputElement.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('mediaFile', file);

    try {
        if(statusEl) statusEl.innerText = "Lade hoch...";
        
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();

        if(data.success) {
            hiddenInput.value = data.filePath;
            if(statusEl) statusEl.innerText = "Fertig!";
            
            // Preview Logik (vereinfacht)
            previewContainer.innerHTML = generateMediaPreviewHtml(data.filePath);
            checkQuestionFilled(hiddenInput); // Status aktualisieren
        }
    } catch (e) {
        alert("Upload Fehler");
    }
}
// Global verfügbar machen
window.uploadFile = uploadFile;

function removeBackground() {
    const pathInput = document.getElementById('background-path') as HTMLInputElement;
    const previewImg = document.getElementById('background-preview-img') as HTMLImageElement;
    
    if (pathInput.value) {
        filesToDeleteOnSave.push(pathInput.value);
    }
    pathInput.value = '';
    previewImg.src = '';
    previewImg.style.display = 'none';
    const status = document.getElementById('background-status');
    if(status) status.innerText = '';
}
window.removeBackground = removeBackground;


// --- 2. LOGIK FÜR FRAGEN & KATEGORIEN ---

function updateQuizStructure() {
    const numCat = parseInt(numCatInput.value) || 5;
    const numQ = parseInt(numQInput.value) || 5;

    container.innerHTML = '';
    currentCategoriesCount = 0;

    for (let i = 0; i < numCat; i++) {
        addCategory({ forceQuestionCount: numQ });
    }
}

function addCategory(data: { name?: string, questions?: IQuestion[], forceQuestionCount?: number } = {}) {
    currentCategoriesCount++;
    const catId = `cat-${Date.now()}-${currentCategoriesCount}`;
    const catName = data.name ?? '';
    
    const html = `
    <div class="card category" id="${catId}" data-cat-name="${catName}">
        <label for="input-cat-${catId}">Kategorie Name:</label>
        <input type="text" id="input-cat-${catId}" class="cat-name" value="${catName}" 
               placeholder="Kategorie benennen" title="Name der Kategorie"
               oninput="this.closest('.category').setAttribute('data-cat-name', this.value)">
        <div class="questions-container" id="q-cont-${catId}"></div>
    </div>`;

    container.insertAdjacentHTML('beforeend', html);

    const qCount = data.questions ? data.questions.length : (data.forceQuestionCount || 1);
    
    if (data.questions) {
        data.questions.forEach(q => addQuestion(catId, q));
    } else {
        for(let i=0; i<qCount; i++) addQuestion(catId);
    }
}

function addQuestion(catId: string, qData: Partial<IQuestion> = {}) {
    const qContainer = document.getElementById(`q-cont-${catId}`);
    if(!qContainer) return;

    const qId = (Date.now() + Math.random()).toString().replace('.', '_');
    const type = qData.type ?? 'standard';
    
    // Default Werte mit Nullish Coalescing (??)
    const points = qData.points ?? 100;
    const negPoints = qData.negativePoints ?? 0;
    const qText = qData.questionText ?? '';
    const aText = qData.answerText ?? '';
    const media = qData.mediaPath ?? '';
    
    // Map Daten
    const lat = qData.location?.lat ?? '';
    const lng = qData.location?.lng ?? '';
    const isCustom = qData.location?.isCustomMap ?? false;
    const customPath = qData.location?.customMapPath ?? '';

    // HTML Template (Achtung: onclick ruft globale window-Funktionen auf)
    const html = `
    <div class="question-block type-${type}" id="block-${qId}" data-points="${points}">
        <div style="margin-bottom:10px; border-bottom:1px solid #ddd;">
            <label>Typ:</label>
            <select class="q-type-select" onchange="changeQuestionType(this, '${qId}')">
                <option value="standard" ${type === 'standard' ? 'selected' : ''}>Standard</option>
                <option value="map" ${type === 'map' ? 'selected' : ''}>Karte</option>
            </select>
        </div>

        <label>Punkte:</label>
        <input type="number" class="q-points" value="${points}" oninput="checkQuestionFilled(this)">
        <label>Minus-Punkte:</label>
        <input type="number" class="q-negative-points" value="${negPoints}">

        <label>Frage:</label>
        <input type="text" class="q-text" value="${qText}" oninput="checkQuestionFilled(this)">

        <label>Medien (Frage):</label>
        <input type="file" onchange="uploadFile(this, 'preview-q-${qId}', 'media-${qId}')">
        <div id="preview-q-${qId}">${generateMediaPreviewHtml(media)}</div>
        <input type="hidden" class="q-media-path" id="media-${qId}" value="${media}">

        <div class="standard-answer-section" style="display:${type==='standard'?'block':'none'}">
            <label>Antwort:</label>
            <input type="text" class="q-answer" value="${aText}" oninput="checkQuestionFilled(this)">
        </div>

        <div class="map-answer-section" style="display:${type==='map'?'block':'none'}">
             <div style="background:#eef; padding:5px; margin:5px 0;">
                <select onchange="toggleMapSource('${qId}', this.value)">
                    <option value="osm" ${!isCustom ? 'selected' : ''}>Weltkarte</option>
                    <option value="custom" ${isCustom ? 'selected' : ''}>Bild hochladen</option>
                </select>
                <div id="custom-upload-${qId}" style="display:${isCustom?'block':'none'}">
                    <input type="file" onchange="uploadCustomMap(this, '${qId}')">
                </div>
             </div>
             
             <div id="map-${qId}" class="map-editor-container"></div>
             <p style="font-size:0.8rem">Klicke auf die Karte um das Ziel zu setzen.</p>

             <input type="hidden" class="q-lat" id="lat-${qId}" value="${lat}">
             <input type="hidden" class="q-lng" id="lng-${qId}" value="${lng}">
             <input type="hidden" class="q-is-custom" id="is-custom-${qId}" value="${isCustom}">
             <input type="hidden" class="q-custom-path" id="custom-path-${qId}" value="${customPath}">
             
             <label>Ortsname (Lösung):</label>
             <input type="text" class="q-answer-map" value="${aText}" oninput="checkQuestionFilled(this)">
        </div>
    </div>`;

    qContainer.insertAdjacentHTML('beforeend', html);

    // Initialisiere Map falls nötig
    if (type === 'map') {
        setTimeout(() => initMap(qId, Number(lat), Number(lng), isCustom, customPath), 100);
    }
    
    // Check Status
    const newBlock = document.getElementById(`block-${qId}`);
    if(newBlock) checkQuestionFilled(newBlock);
}

// --- 3. MAP LOGIK (Leaflet) ---

function initMap(qId: string, lat?: number, lng?: number, isCustom = false, customPath = '') {
    const mapId = `map-${qId}`;
    const mapEl = document.getElementById(mapId);
    if (!mapEl) return;

    // Aufräumen alter Instanzen
    if (mapInstances[qId]) {
        mapInstances[qId].remove();
        delete mapInstances[qId];
        mapEl.innerHTML = '';
    }

    let map: L.Map;

    if (isCustom && customPath) {
        // Custom Map (Bild)
        const img = new Image();

        img.onerror = (err) => {
            console.error("BILD LADEFEHLER:", err);
            alert(`Bild konnte nicht geladen werden.\nPfad: ${customPath}\n`);
        };

        img.onload = () => {
            const w = img.width;
            const h = img.height;
            map = L.map(mapId, {
                crs: L.CRS.Simple,
                minZoom: -2, 
                zoom: 0,
                center: [h/2, w/2]
            });
            const bounds: L.LatLngBoundsExpression = [[0,0], [h,w]];
            L.imageOverlay(customPath, bounds).addTo(map);
            map.fitBounds(bounds);
            setupMapClick(map, qId);
            if (lat && lng) L.marker([lat, lng]).addTo(map);
            mapInstances[qId] = map;
        };
        img.src = customPath;
    } else {
        // OSM
        map = L.map(mapId).setView([lat || 51.16, lng || 10.45], lat ? 13 : 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
        setupMapClick(map, qId);
        if (lat && lng) L.marker([lat, lng]).addTo(map);
        mapInstances[qId] = map;
    }
}

function setupMapClick(map: L.Map, qId: string) {
    let marker: L.Marker | undefined;
    
    map.on('click', (e) => {
        const { lat, lng } = e.latlng;
        
        if (marker) marker.setLatLng(e.latlng);
        else marker = L.marker(e.latlng).addTo(map);

        (document.getElementById(`lat-${qId}`) as HTMLInputElement).value = lat.toString();
        (document.getElementById(`lng-${qId}`) as HTMLInputElement).value = lng.toString();
        
        checkQuestionFilled(document.getElementById(`lat-${qId}`)!);
    });
}

// Helper für Map-Wechsel
window.toggleMapSource = (qId, source) => {
    const isCustom = source === 'custom';
    (document.getElementById(`custom-upload-${qId}`) as HTMLElement).style.display = isCustom ? 'block' : 'none';
    (document.getElementById(`is-custom-${qId}`) as HTMLInputElement).value = isCustom.toString();
    
    // Reset Values
    (document.getElementById(`lat-${qId}`) as HTMLInputElement).value = '';
    const path = (document.getElementById(`custom-path-${qId}`) as HTMLInputElement).value;
    
    initMap(qId, undefined, undefined, isCustom, path);
};

window.uploadCustomMap = async (input, qId) => {
    const file = input.files?.[0];
    if(!file) return;
    
    const fd = new FormData();
    fd.append('mediaFile', file);
    try {
        const res = await fetch('/api/upload', { method: 'POST', body: fd });
        const data = await res.json();
        if(data.success) {
            (document.getElementById(`custom-path-${qId}`) as HTMLInputElement).value = data.filePath;
            initMap(qId, undefined, undefined, true, data.filePath);
        }
    } catch(e) { alert("Fehler beim Map Upload"); }
};


// --- 4. SPEICHERN & LADEN ---

async function saveGame() {
    const bgPath = (document.getElementById('background-path') as HTMLInputElement).value;
    const cats: ICategory[] = [];

    document.querySelectorAll('.category').forEach(catDiv => {
        const name = (catDiv.querySelector('.cat-name') as HTMLInputElement).value;
        const questions: IQuestion[] = [];

        catDiv.querySelectorAll('.question-block').forEach(qBlock => {
            const type = (qBlock.querySelector('.q-type-select') as HTMLSelectElement).value as QuestionType;
            const points = parseInt((qBlock.querySelector('.q-points') as HTMLInputElement).value) || 0;
            const negPoints = parseInt((qBlock.querySelector('.q-negative-points') as HTMLInputElement).value) || 0;
            const text = (qBlock.querySelector('.q-text') as HTMLInputElement).value;
            const media = (qBlock.querySelector('.q-media-path') as HTMLInputElement).value;
            
            let answerText = '';
            let loc = undefined;
            let mapWidth = 0;
            let mapHeight = 0;

            if (type === 'map') {
                answerText = (qBlock.querySelector('.q-answer-map') as HTMLInputElement).value;
                const lat = (qBlock.querySelector('#lat-' + qBlock.id.split('-')[1]) as HTMLInputElement).value;
                const lng = (qBlock.querySelector('#lng-' + qBlock.id.split('-')[1]) as HTMLInputElement).value;
                const isCustom = (qBlock.querySelector('#is-custom-' + qBlock.id.split('-')[1]) as HTMLInputElement).value === 'true';
                const customPath = (qBlock.querySelector('#custom-path-' + qBlock.id.split('-')[1]) as HTMLInputElement).value;

                if (isCustom && customPath) {
                    const img = new Image();
                    img.src = customPath;
                    mapWidth = img.width || 1000;
                    mapHeight = img.height || 1000;
                }
                
                alert(`Speichern: Pfad=${customPath}, Größe=${mapWidth}x${mapHeight}`);

                if (lat && lng) {
                    loc = { 
                        lat: parseFloat(lat), 
                        lng: parseFloat(lng), 
                        isCustomMap: isCustom, 
                        customMapPath: customPath,
                        mapWidth: mapWidth,
                        mapHeight: mapHeight
                    };
                }
            } else {
                answerText = (qBlock.querySelector('.q-answer') as HTMLInputElement).value;
            }

            questions.push({
                type, 
                points, 
                negativePoints: negPoints,
                questionText: text, 
                answerText,
                mediaPath: media || '', 
                hasMedia: !!media, 
                mediaType: 'none', // Typ vereinfacht
                answerMediaPath: '', 
                hasAnswerMedia: false,
                answerMediaType: 'none',
                location: loc
            });
        });

        cats.push({ name, questions });
    });

    const game: IGame = {
        title: titleInput.value,
        boardBackgroundPath: bgPath,
        categories: cats
    };
    if (editingGameId) game._id = editingGameId;

    try {
        const res = await fetch('/api/create-game', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(game)
        });
        const result = await res.json();
        if (result.success) {
            alert("Gespeichert!");
            editingGameId = result.gameId;
            loadGameList();
        }
    } catch (e) { alert("Fehler beim Speichern"); }
}

async function loadGameList() {
    const list = document.getElementById('game-list');
    if(!list) return;
    list.innerHTML = '<p style="text-align:center; color:#666;">Lade...</p>';
    
    try {
        const res = await fetch('/api/games');
        const games = await res.json();
        
        list.innerHTML = '';
        
        if (games.length === 0) {
            list.innerHTML = '<p style="text-align:center; color:#999;">Keine Spiele gefunden.</p>';
            return;
        }

        games.forEach((g: any) => {
            const html = `
            <div class="load-item" style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid #eee;">
                
                <span onclick="loadGame('${g._id}')" 
                      style="flex-grow: 1; cursor: pointer; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                      title="Zum Bearbeiten klicken">
                    ${g.title}
                </span>

                <div style="display: flex; gap: 5px; margin-left: 10px;">
                    <button onclick="startGame('${g._id}')" 
                            style="background: #28a745; color: white; border: none; padding: 5px 10px; cursor: pointer; border-radius: 4px; font-size: 0.9rem;"
                            title="Hosten">
                        ▶
                    </button>
                    
                    <button onclick="deleteGame('${g._id}')" 
                            style="background: #dc3545; color: white; border: none; padding: 5px 10px; cursor: pointer; border-radius: 4px; font-size: 0.9rem;"
                            title="Löschen">
                        🗑
                    </button>
                </div>
            </div>`;
            
            list.insertAdjacentHTML('beforeend', html);
        });
    } catch (e) {
        list.innerHTML = '<p style="color:red; text-align:center;">Fehler beim Laden.</p>';
    }
}

async function loadGame(id: string) {
    const res = await fetch(`/api/games/${id}`);
    const game = await res.json() as IGame;
    
    editingGameId = game._id!;
    titleInput.value = game.title;
    (document.getElementById('background-path') as HTMLInputElement).value = game.boardBackgroundPath;
    
    // UI Reset
    container.innerHTML = '';
    game.categories.forEach(cat => addCategory(cat));
    
    // Inputs updaten
    numCatInput.value = game.categories.length.toString();
    numQInput.value = (game.categories[0]?.questions.length || 5).toString();
}

function clearForm() {
    editingGameId = null;
    titleInput.value = '';
    container.innerHTML = '';
    updateQuizStructure();
}

// --- HELPER ---

function changeQuestionType(select: HTMLSelectElement, qId: string) {
    const block = document.getElementById(`block-${qId}`);
    if(!block) return;
    const type = select.value;
    
    block.className = `question-block type-${type}`;
    const stdSec = block.querySelector('.standard-answer-section') as HTMLElement;
    const mapSec = block.querySelector('.map-answer-section') as HTMLElement;
    
    if (type === 'map') {
        stdSec.style.display = 'none';
        mapSec.style.display = 'block';
        initMap(qId); // Leaflet Hack: Refresh size
    } else {
        stdSec.style.display = 'block';
        mapSec.style.display = 'none';
    }
    checkQuestionFilled(select);
}

window.changeQuestionType = changeQuestionType;

function checkQuestionFilled(el: HTMLElement | null) {
    if (!el) return;
    const block = el.closest('.question-block');
    if(!block) return;
    
    const text = (block.querySelector('.q-text') as HTMLInputElement).value;
    const type = (block.querySelector('.q-type-select') as HTMLSelectElement).value;
    let filled = false;

    if (type === 'standard') {
        const ans = (block.querySelector('.q-answer') as HTMLInputElement).value;
        if(text && ans) filled = true;
    } else {
        const lat = (block.querySelector('.q-lat') as HTMLInputElement).value;
        if(text && lat) filled = true;
    }
    
    if(filled) block.classList.add('is-filled');
    else block.classList.remove('is-filled');
}

window.checkQuestionFilled = checkQuestionFilled;

function generateMediaPreviewHtml(path: string) {
    if(!path) return '';
    return `<img src="${path}" class="media-preview" style="max-height:100px; display:block; margin-top:5px;">`;
}

function switchView(mode: string) {
    const editorView = document.getElementById('editor-view') as HTMLDivElement;
    const boardView = document.getElementById('board-preview-view') as HTMLDivElement;
    const btnList = document.getElementById('btn-view-list') as HTMLButtonElement;
    const btnBoard = document.getElementById('btn-view-board') as HTMLButtonElement;

    if (mode === 'board') {
        // Daten aus dem Editor lesen und Grid bauen
        renderBoardPreview();
        
        editorView.style.display = 'none';
        boardView.style.display = 'block';
        
        // Buttons stylen
        btnList.style.background = 'transparent';
        btnList.style.color = '#333';
        btnBoard.style.background = '#007bff';
        btnBoard.style.color = 'white';
    } else {
        editorView.style.display = 'block';
        boardView.style.display = 'none';
        
        btnList.style.background = '#007bff';
        btnList.style.color = 'white';
        btnBoard.style.background = 'transparent';
        btnBoard.style.color = '#333';
    }
}
window.switchView = switchView;

function renderBoardPreview() {
    const grid = document.getElementById('preview-grid');
    if (!grid) return;
    grid.innerHTML = '';

    // Wir lesen die Daten direkt aus dem DOM, da das Spiel evtl. noch nicht gespeichert wurde
    const categories = document.querySelectorAll('.category');
    if (categories.length === 0) {
        grid.innerHTML = '<p>Keine Kategorien vorhanden.</p>';
        return;
    }

    // Grid CSS setzen (Spaltenanzahl)
    grid.style.gridTemplateColumns = `repeat(${categories.length}, 1fr)`;

    // 1. Header Zeile (Kategorienamen)
    categories.forEach((cat, index) => {
        const nameInput = cat.querySelector('.cat-name') as HTMLInputElement;
        const name = nameInput.value || `Kat. ${index + 1}`;
        
        const header = document.createElement('div');
        header.className = 'preview-cat-header';
        header.innerText = name;
        grid.appendChild(header);
    });

    // 2. Fragen (Wir müssen zeilenweise iterieren)
    // Wir nehmen an, dass alle Kategorien gleich viele Fragen haben (basierend auf der ersten)
    const firstCatQuestions = categories[0].querySelectorAll('.question-block');
    const numRows = firstCatQuestions.length;

    for (let r = 0; r < numRows; r++) {
        categories.forEach((cat, cIndex) => {
            const questions = cat.querySelectorAll('.question-block');
            const qBlock = questions[r] as HTMLElement;; // Die Frage in dieser Zeile

            const card = document.createElement('div');
            card.className = 'preview-card';
            
            if (qBlock) {
                const pointsInput = qBlock.querySelector('.q-points') as HTMLInputElement;
                const points = pointsInput.value;
                const typeSelect = qBlock.querySelector('.q-type-select') as HTMLSelectElement;
                const isMap = typeSelect.value === 'map';
                
                // Text Inhalt der Karte
                card.innerHTML = `
                    <div style="display:flex; flex-direction:column; align-items:center;">
                        <span>${points}</span>
                        ${isMap ? '<span style="font-size:0.8rem;">(Map)</span>' : ''}
                    </div>
                `;
                
                // Optional: Klick scrollt zum Editor (Erweitertes Feature)
                card.onclick = () => {
                    switchView('list');
                    qBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    // Highlight-Effekt
                    qBlock.style.transition = 'background 0.5s';
                    const originalBg = qBlock.style.backgroundColor; // Typ-Klasse beachten
                    qBlock.style.backgroundColor = '#ffff99';
                    setTimeout(() => { qBlock.style.backgroundColor = ''; }, 1000);
                };
            } else {
                card.style.background = '#444'; // Leer
            }
            
            grid.appendChild(card);
        });
    }
}

// --- THEME LOGIC ---

function initTheme() {
    const storedTheme = localStorage.getItem('quiz_theme');
    // Standard ist hell. Wenn 'dark' gespeichert ist, anwenden.
    if (storedTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
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

// Global verfügbar machen
window.toggleTheme = toggleTheme;

// Beim Start ausführen
initTheme();

function startGame(id: string) {
    window.location.href = `/host.html?gameId=${id}`;
}
window.startGame = startGame;

async function deleteGame(id: string) {
    if(!confirm("Möchtest du dieses Quiz wirklich unwiderruflich löschen?")) return;

    try {
        const res = await fetch(`/api/games/${id}`, { method: 'DELETE' });
        const data = await res.json();
        
        if (data.success) {
            // Wenn das aktuell offene Spiel gelöscht wurde, Formular leeren
            if (editingGameId === id) clearForm();
            // Liste neu laden
            loadGameList();
        } else {
            alert("Fehler beim Löschen.");
        }
    } catch (e) {
        console.error(e);
        alert("Serverfehler beim Löschen.");
    }
}
window.deleteGame = deleteGame;

// loadGame muss auch global verfügbar sein für onclick="..."
window.loadGame = loadGame;