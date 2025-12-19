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
        loadGameTiles: () => void;
        removeQuestionMedia: (qId: string, target: 'question' | 'answer') => void;
        searchAddress: (qId: string) => void;
        updateMapFromCoords: (qId: string) => void; 
        handleAddressInput: (qId: string) => void;
        selectAddress: (qId: string, lat: string, lon: string, name: string) => void;
    }
}

const tooltip = document.createElement('div');
tooltip.id = 'preview-tooltip';
Object.assign(tooltip.style, {
    position: 'fixed',
    display: 'none',
    background: 'rgba(0, 0, 0, 0.9)',
    color: '#fff',
    padding: '10px',
    borderRadius: '5px',
    maxWidth: '300px',
    zIndex: '10000',
    pointerEvents: 'none',
    fontSize: '0.9rem',
    whiteSpace: 'pre-wrap',
    boxShadow: '0 4px 6px rgba(0,0,0,0.3)'
});
document.body.appendChild(tooltip);

// --- STATE ---
let editingGameId: string | null = null;
let currentCategoriesCount = 0;
let cachedGames: IGame[] = [];
let View: boolean = false; // true = Board, false = List
let sidebarGamesCache: IGame[] = [];

const mapInstances: Record<string, L.Map> = {};

// --- DOM ELEMENTE ---
const container = document.getElementById('categories-container') as HTMLDivElement;
const titleInput = document.getElementById('gameTitle') as HTMLInputElement;
const numCatInput = document.getElementById('numCategories') as HTMLInputElement;
const numQInput = document.getElementById('numQuestions') as HTMLInputElement;
const dashboardDiv = document.getElementById('quiz-dashboard') as HTMLDivElement;
const editorDiv = document.getElementById('quiz-editor') as HTMLDivElement;
const dashboardGrid = document.getElementById('dashboard-grid') as HTMLDivElement;
const backToDashBtn = document.getElementById('btn-back-dashboard') as HTMLButtonElement;
const editorTitleDisplay = document.getElementById('editor-title-display') as HTMLHeadingElement;
const sidebar = document.getElementById('sidebar') as HTMLDivElement;
const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn') as HTMLButtonElement;
const gameListDiv = document.getElementById('game-list') as HTMLDivElement;
const btnDashboardNew = document.getElementById('btn-dashboard-new') as HTMLButtonElement;
const btnSidebarNew = document.getElementById('btn-sidebar-new') as HTMLButtonElement;
const btnBackDash = document.getElementById('btn-back-dashboard') as HTMLButtonElement;
const searchInput = document.getElementById('dashboard-search') as HTMLInputElement;
const sidebarSearchInput = document.getElementById('sidebar-search') as HTMLInputElement;

// Drag & Drop initialisieren
    setupDragAndDrop('drop-zone-bg', 'boardBackgroundUpload');
    setupDragAndDrop('drop-zone-music', 'backgroundMusicUpload');

// --- INIT ---
document.getElementById('btn-save')?.addEventListener('click', saveGame);
document.getElementById('btn-remove-bg')?.addEventListener('click', removeBackground);

document.getElementById("btn-view-list")?.addEventListener('click', switchView.bind(null, 'list'));
document.getElementById("btn-view-board")?.addEventListener('click', switchView.bind(null, 'board'));
document.getElementById("theme-toggle-btn")?.addEventListener('click', toggleTheme);

document.getElementById('numCategories')?.addEventListener('change', updateQuizStructure);
document.getElementById('numQuestions')?.addEventListener('change', updateQuizStructure);

document.getElementById('boardBackgroundUpload')?.addEventListener('change', function(this: HTMLInputElement) {
    uploadFile(this, 'preview-background', 'background-path');
});

document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('.autocomplete-wrapper')) {
        document.querySelectorAll('.autocomplete-list').forEach(el => {
            (el as HTMLElement).style.display = 'none';
        });
    }
});

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    
    showDashboard();

    const handleNew = () => {
        clearForm();
        editingGameId = null;
        // Reset Markierungen in der Liste
        document.querySelectorAll('.load-item').forEach(i => i.classList.remove('active'));
        showEditor(); 
    };

    if(btnDashboardNew) btnDashboardNew.onclick = handleNew;
    if(btnSidebarNew) btnSidebarNew.onclick = handleNew;
    if(btnBackDash) btnBackDash.onclick = showDashboard;

    // Sidebar Toggle
    if(sidebarToggleBtn) {
        sidebarToggleBtn.onclick = () => {
            if(sidebar.style.display === 'none') {
                sidebar.style.display = 'flex';
            } else {
                sidebar.style.display = 'none';
            }
        };
    }

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const term = (e.target as HTMLInputElement).value.toLowerCase();
            filterAndRenderTiles(term);
        });
    }

    if (sidebarSearchInput) {
        sidebarSearchInput.addEventListener('input', (e) => {
            const term = (e.target as HTMLInputElement).value.toLowerCase();
            renderSidebarList(term);
        });
    }

    if(backToDashBtn) backToDashBtn.onclick = showDashboard;
});

document.getElementById('backgroundMusicUpload')?.addEventListener('change', async function(this: HTMLInputElement) {
    const file = this.files?.[0];
    if (!file) return;

    const statusEl = document.getElementById('music-status');
    if(statusEl) statusEl.innerText = "Lade hoch...";

    const formData = new FormData();
    formData.append('mediaFile', file);

    try {
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();

        if (data.success) {
            const hiddenInput = document.getElementById('background-music-path') as HTMLInputElement;
            hiddenInput.value = data.filePath;
            
            const audio = document.getElementById('music-preview') as HTMLAudioElement;
            audio.src = data.filePath;
            audio.style.display = 'block';
            if(statusEl) statusEl.innerText = "Fertig!";
        }
    } catch (e) {
        alert("Fehler beim Musik-Upload");
    }
});

document.getElementById('btn-remove-music')?.addEventListener('click', () => {
    const hiddenInput = document.getElementById('background-music-path') as HTMLInputElement;
    const audio = document.getElementById('music-preview') as HTMLAudioElement;
    const fileInput = document.getElementById('backgroundMusicUpload') as HTMLInputElement;
    
    hiddenInput.value = '';
    audio.src = '';
    audio.style.display = 'none';
    fileInput.value = '';
});

// Start: Liste laden
loadGameList();
clearForm();

// --- 1. GLOBALE FUNKTIONEN ---

async function uploadFile(inputElement: HTMLInputElement, previewId: string, hiddenInputId: string) {
    let statusEl = inputElement.nextElementSibling as HTMLElement;
    const previewContainer = document.getElementById(previewId) as HTMLDivElement;
    const hiddenInput = document.getElementById(hiddenInputId) as HTMLInputElement;
    
    if (statusEl && statusEl.tagName === 'BUTTON') {
        statusEl = statusEl.nextElementSibling as HTMLElement;
    }

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
            
            previewContainer.innerHTML = generateMediaPreviewHtml(data.filePath);
            checkQuestionFilled(hiddenInput); 
        }
    } catch (e) {
        alert("Upload Fehler");
    }
}
window.uploadFile = uploadFile;

function removeBackground() {
    const pathInput = document.getElementById('background-path') as HTMLInputElement;
    const previewContainer = document.getElementById('preview-background') as HTMLDivElement;
    
    pathInput.value = '';
    if (previewContainer) {
        previewContainer.innerHTML = ''; 
    }
    const status = document.getElementById('background-status');
    if(status) status.innerText = '';
}
window.removeBackground = removeBackground;

// --- 2. LOGIK FÜR FRAGEN & KATEGORIEN ---

function updateQuizStructure() {
    const targetCatCount = parseInt(numCatInput.value) || 1;
    const targetQCount = parseInt(numQInput.value) || 1;

    const existingCategories = container.querySelectorAll('.category');
    const currentCatCount = existingCategories.length;

    if (targetCatCount > currentCatCount) {
        for (let i = currentCatCount; i < targetCatCount; i++) {
            addCategory({ forceQuestionCount: targetQCount });
        }
    } else if (targetCatCount < currentCatCount) {
        for (let i = currentCatCount - 1; i >= targetCatCount; i--) {
            existingCategories[i].remove();
        }
    }

    const allCategories = container.querySelectorAll('.category');

    allCategories.forEach(cat => {
        const catId = cat.id; 
        
        const qContainer = document.getElementById(`q-cont-${catId}`);
        if (!qContainer) return;

        const existingQuestions = qContainer.querySelectorAll('.question-block');
        const currentQCount = existingQuestions.length;

        if (targetQCount > currentQCount) {
            for (let k = currentQCount; k < targetQCount; k++) {
                addQuestion(catId);
            }
        } else if (targetQCount < currentQCount) {
            for (let k = currentQCount - 1; k >= targetQCount; k--) {
                existingQuestions[k].remove();
            }
        }
    });
    switchView(View ? 'board' : 'list');
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
    
    const qText = qData.questionText ?? '';
    const points = qData.points ?? 100;
    const negPoints = qData.negativePoints ?? 50;
    const media = qData.mediaPath ?? '';
    
    const aText = qData.answerText ?? ''; 
    const estAns = qData.estimationAnswer ?? '';
    const listItems = qData.listItems ? qData.listItems.join('\n') : ''; 
    
    const lat = qData.location?.lat ?? '';
    const lng = qData.location?.lng ?? '';
    const isCustom = qData.location?.isCustomMap ?? false;
    const customPath = qData.location?.customMapPath ?? '';

    const pxDuration = qData.pixelConfig?.resolutionDuration ?? 15;
    const pxType = qData.pixelConfig?.effectType ?? 'pixelate';

    const html = `
    <div class="question-block type-${type}" id="block-${qId}">
        <div style="margin-bottom:10px; border-bottom:1px solid #ddd; padding-bottom:5px;">
            <label style="font-weight:bold;">Fragetyp:</label>
            <select class="q-type-select" onchange="changeQuestionType(this, '${qId}')">
                <option value="standard" ${type === 'standard' ? 'selected' : ''}>Standard (Buzzer)</option>
                <option value="map" ${type === 'map' ? 'selected' : ''}>Map (Karte)</option>
                <option value="estimate" ${type === 'estimate' ? 'selected' : ''}>Schätzfrage (Zahl)</option>
                <option value="list" ${type === 'list' ? 'selected' : ''}>Liste (Begriffe aufdecken)</option>
                <option value="pixel" ${type === 'pixel' ? 'selected' : ''}>Pixel-Puzzle (Bild)</option>
                <option value="freetext" ${type === 'freetext' ? 'selected' : ''}>Freie Antwort (Punktevergabe)</option>
            </select>
        </div>

        <div style="display:flex; gap:10px;">
            <div style="flex:1"><label>Punkte:</label><input type="number" class="q-points" value="${points}"></div>
            <div style="flex:1"><label>Minus:</label><input type="number" class="q-negative-points" value="${negPoints}"></div>
        </div>

        <label>Fragetext / Titel:</label>
        <input type="text" class="q-text" value="${qText}" oninput="checkQuestionFilled(this)" placeholder="z.B. 'Was ist hier zu sehen?'">

        <label>Frage-Medien (Bild für Puzzle hier hochladen):</label>
        <div style="display:flex; align-items:center; gap: 10px;">
            <input type="file" id="file-upload-${qId}" onchange="uploadFile(this, 'preview-q-${qId}', 'media-${qId}')" style="flex-grow:1;">
            <button type="button" class="sidebar-delete-btn" onclick="removeQuestionMedia('${qId}', 'question')" title="Medien entfernen" style="font-size: 1.5rem;">🗑</button>
            <span class="upload-status" style="font-size: 0.9rem; margin-left: 5px; min-width: 50px;"></span>
        </div>
        <div id="preview-q-${qId}">${generateMediaPreviewHtml(media)}</div>
        <input type="hidden" class="q-media-path" id="media-${qId}" value="${media}">

        <div class="type-section section-pixel" style="display:none; background: rgba(0, 123, 255, 0.1); padding: 10px; border: 1px dashed #007bff; margin-top:10px; border-radius: 4px;">
            <label style="font-weight:bold; color: #007bff;">🧩 Pixel-Puzzle Einstellungen:</label>
            <div style="display:flex; gap:10px; align-items:center; margin-top:5px;">
                <select class="q-pixel-type" style="width: auto; padding: 5px;">
                    <option value="pixelate" ${pxType === 'pixelate' ? 'selected' : ''}>Klassisch (Verpixeln)</option>
                    <option value="twist" ${pxType === 'twist' ? 'selected' : ''}>Strudel (Verdrehen)</option>
                    <option value="shuffle" ${pxType === 'shuffle' ? 'selected' : ''}>Chaos (Pixel-Tausch)</option>
                </select>

                <span>Dauer bis scharf:</span>
                <input type="number" class="q-pixel-duration" value="${pxDuration}" min="5" max="120" style="width:80px;">
                <span>Sekunden</span>

                <button type="button" class="secondary-btn" onclick="previewPixelEffect('${qId}')" 
                        style="margin-top:0; margin-left:auto; background:#fff; color: #28a745; border-color: #28a745;">
                    ▶ Effekt Vorschau
                </button>
            </div>
            
            <small style="opacity: 0.8;">Das Bild startet stark verpixelt und wird über diese Zeit langsam erkennbar.</small>

            <canvas id="pixel-canvas-${qId}" style="display:none; width: 100%; max-height: 300px; object-fit: contain; border: 1px solid #ccc; background: #000; margin-top: 5px;"></canvas>
        </div>

        <div class="type-section section-list list-hint-box" style="display:none;">
            <label style="font-weight:bold;">Hinweise/Begriffe (Einer pro Zeile):</label>
            <textarea class="q-list-items" rows="4" placeholder="Begriff 1\nBegriff 2\nBegriff 3">${listItems}</textarea>
            <small>Diese Begriffe werden nacheinander aufgedeckt.</small>
        </div>

        <div class="type-section section-standard section-pixel section-freetext section-list" style="display:none;">
            <label>Richtige Lösung (Text):</label>
            <input type="text" class="q-answer" value="${aText}" oninput="checkQuestionFilled(this)" placeholder="Die richtige Antwort">
            
            <div style="margin-top:5px; border-top:1px dashed #ccc; padding-top:5px;">
                <label>Lösung-Medien (Optional):</label>
                <div style="display:flex; align-items:center; gap: 10px;">
                    <input type="file" id="file-upload-ans-${qId}" onchange="uploadFile(this, 'preview-ans-${qId}', 'media-ans-${qId}')" style="flex-grow:1;">
                    <button type="button" class="sidebar-delete-btn" onclick="removeQuestionMedia('${qId}', 'answer')" title="Medien entfernen" style="font-size: 1.5rem;">🗑</button>
                    <span class="upload-status" style="font-size: 0.9rem; margin-left: 5px; min-width: 50px;"></span>
                </div>
                <div id="preview-ans-${qId}">${generateMediaPreviewHtml(qData.answerMediaPath || '')}</div>
                <input type="hidden" class="q-answer-media-path" id="media-ans-${qId}" value="${qData.answerMediaPath || ''}">
            </div>
        </div>

        <div class="type-section section-estimate" style="display:none;">
            <label>Lösung (Zahl):</label>
            <input type="number" class="q-estimate-ans" value="${estAns}" oninput="checkQuestionFilled(this)" placeholder="z.B. 1995">
        </div>

        <div class="type-section section-map" style="display:none;">
             <div class="map-controls">
                <select onchange="toggleMapSource('${qId}', this.value)">
                    <option value="osm" ${!isCustom ? 'selected' : ''}>Weltkarte (OSM)</option>
                    <option value="custom" ${isCustom ? 'selected' : ''}>Eigenes Bild</option>
                </select>
                
                <div id="osm-search-${qId}" style="display:${!isCustom ? 'flex' : 'none'}; gap:5px; margin-top:5px; align-items:flex-start;">
                    
                    <div class="autocomplete-wrapper">
                        <input type="text" id="addr-search-${qId}" 
                               placeholder="Adresse tippen (z.B. Berlin)..." 
                               autocomplete="off"
                               oninput="handleAddressInput('${qId}')"
                               onkeydown="if(event.key === 'Enter') searchAddress('${qId}')">
                        
                        <div id="suggestions-${qId}" class="autocomplete-list" style="display:none;"></div>
                    </div>
                </div>

                <div id="custom-upload-${qId}" style="display:${isCustom?'block':'none'}; margin-top:5px;">
                    <input type="file" onchange="uploadCustomMap(this, '${qId}')">
                </div>
             </div>

             <div id="map-${qId}" class="map-editor-container"></div>
             
             <div class="map-coords-bar">
                <label style="margin:0;">Lat:</label>
                <input type="number" class="q-lat" id="lat-${qId}" value="${lat}" step="any" placeholder="Breitengrad" 
                    style="margin:0; width: 120px;" onchange="updateMapFromCoords('${qId}')">
                
                <label style="margin:0;">Lng:</label>
                <input type="number" class="q-lng" id="lng-${qId}" value="${lng}" step="any" placeholder="Längengrad" 
                    style="margin:0; width: 120px;" onchange="updateMapFromCoords('${qId}')">
                
                <input type="hidden" class="q-is-custom" id="is-custom-${qId}" value="${isCustom}">
                <input type="hidden" class="q-custom-path" id="custom-path-${qId}" value="${customPath}">
            </div>
             
             <label>Ortsname (Anzeige bei Lösung):</label>
             <input type="text" class="q-answer-map" value="${aText}" oninput="checkQuestionFilled(this)" placeholder="z.B. 'Eiffelturm'">
        </div>
    </div>`;

    qContainer.insertAdjacentHTML('beforeend', html);
    
    const select = document.querySelector(`#block-${qId} .q-type-select`) as HTMLSelectElement;
    changeQuestionType(select, qId);

    if (type === 'map') {
        setTimeout(() => initMap(qId, Number(lat), Number(lng), isCustom, customPath), 100);
    }
    checkQuestionFilled(document.getElementById(`block-${qId}`));
}

// --- 3. MAP LOGIK (Leaflet) ---

function initMap(qId: string, lat?: number, lng?: number, isCustom = false, customPath = '') {
    const mapId = `map-${qId}`;
    const mapEl = document.getElementById(mapId);
    if (!mapEl) return;

    if (mapInstances[qId]) {
        mapInstances[qId].remove();
        delete mapInstances[qId];
        mapEl.innerHTML = '';
    }

    let map: L.Map;

    if (isCustom && customPath) {
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

window.toggleMapSource = (qId, source) => {
    const isCustom = source === 'custom';
    (document.getElementById(`custom-upload-${qId}`) as HTMLElement).style.display = isCustom ? 'block' : 'none';
    (document.getElementById(`is-custom-${qId}`) as HTMLInputElement).value = isCustom.toString();
    
    const searchBar = document.getElementById(`osm-search-${qId}`);
    if(searchBar) searchBar.style.display = isCustom ? 'none' : 'flex';

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
    const musicPath = (document.getElementById('background-music-path') as HTMLInputElement).value;
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
            
            // Initialwerte
            let answerText = '';
            let estAns: number | undefined = undefined;
            let listItems: string[] = [];
            let loc = undefined;
            let answerMedia = '';
            let pixelConf = undefined;

            // Daten extrahieren
            if (type === 'standard' || type === 'pixel' || type === 'freetext' || type === 'list') {
                // Antwortfeld wird hier genutzt
                answerText = (qBlock.querySelector('.q-answer') as HTMLInputElement).value;
                answerMedia = (qBlock.querySelector('.q-answer-media-path') as HTMLInputElement).value;
            }
            
            // Spezifische Felder
            if (type === 'estimate') {
                estAns = parseFloat((qBlock.querySelector('.q-estimate-ans') as HTMLInputElement).value);
            } 
            else if (type === 'list') {
                const raw = (qBlock.querySelector('.q-list-items') as HTMLTextAreaElement).value;
                listItems = raw.split('\n').map(s => s.trim()).filter(s => s.length > 0);
            } 
            else if (type === 'map') {
                answerText = (qBlock.querySelector('.q-answer-map') as HTMLInputElement).value; // Map hat eigenes Antwortfeld
                const lat = (qBlock.querySelector('.q-lat') as HTMLInputElement).value;
                const lng = (qBlock.querySelector('.q-lng') as HTMLInputElement).value;
                const isCustom = (qBlock.querySelector('.q-is-custom') as HTMLInputElement).value === 'true';
                const customPath = (qBlock.querySelector('.q-custom-path') as HTMLInputElement).value;
                
                if(lat && lng) {
                    loc = { lat: parseFloat(lat), lng: parseFloat(lng), isCustomMap: isCustom, customMapPath: customPath, mapWidth: 1000, mapHeight: 1000 };
                }
            }
            else if (type === 'pixel') {
                const durInput = qBlock.querySelector('.q-pixel-duration') as HTMLInputElement;
                const typeInput = qBlock.querySelector('.q-pixel-type') as HTMLSelectElement;
                
                const dur = parseInt(durInput.value) || 30;
                const eff = (typeInput ? typeInput.value : 'pixelate') as 'pixelate' | 'twist' | 'shuffle';

                pixelConf = {
                    resolutionDuration: dur,
                    effectType: eff 
                };
            }
            
            questions.push({
                type, points, negativePoints: negPoints,
                questionText: text, 
                answerText,
                estimationAnswer: estAns,
                listItems: listItems, // Gespeichert als listItems
                mediaPath: media || '', hasMedia: !!media, mediaType: 'none',
                answerMediaPath: answerMedia || '', hasAnswerMedia: !!answerMedia, answerMediaType: 'none',
                location: loc,
                pixelConfig: pixelConf
            });
        });
        cats.push({ name, questions });
    });

    const game: IGame = {
        title: titleInput.value,
        boardBackgroundPath: bgPath,
        backgroundMusicPath: musicPath,
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
    const currentFilter = sidebarSearchInput ? sidebarSearchInput.value.toLowerCase() : '';
    gameListDiv.innerHTML = '<div style="padding:10px; color:grey;">Aktualisiere...</div>';
    
    try {
        const res = await fetch('/api/games');
        sidebarGamesCache = await res.json() as IGame[];
        renderSidebarList(currentFilter);
    } catch (e) {
        console.error(e);
        gameListDiv.innerText = "Fehler beim Laden";
    }
}

function renderSidebarList(filterTerm: string) {
    if (!gameListDiv) return;
    gameListDiv.innerHTML = '';

    const filtered = sidebarGamesCache.filter(g => 
        (g.title || "Unbenannt").toLowerCase().includes(filterTerm)
    );

    if (filtered.length === 0) {
        return;
    }

    const listContainer = document.createElement('div');
    
    filtered.forEach(g => {
        const item = document.createElement('div');
        item.className = 'load-item';
        
        if(editingGameId === g._id) {
            item.classList.add('active');
        }

        item.onclick = () => loadGame(g._id!);

        item.innerHTML = `
            <span style="flex-grow:1; overflow:hidden; text-overflow:ellipsis;">
                ${g.title || 'Ohne Titel'}
            </span>
            <button onclick="event.stopPropagation(); startGame('${g._id}')" class="sidebar-play-btn" title="Spiel starten">▶</button>
            <button onclick="event.stopPropagation(); deleteGame('${g._id}')" class="sidebar-delete-btn" title="Löschen">×</button>
        `;
        listContainer.appendChild(item);
    });
    
    gameListDiv.appendChild(listContainer);
}

async function loadGame(id: string) {
    if (!id || id === 'undefined') {
        alert("Fehler: Ungültige Spiel-ID.");
        return;
    }

    try {
        const res = await fetch(`/api/games/${id}`);
        if (!res.ok) throw new Error(`Server antwortete mit Status: ${res.status}`);

        const game = await res.json() as IGame;
        clearForm();

        editingGameId = game._id!;
        titleInput.value = game.title || ""; 

        if (game.boardBackgroundPath) {
             const bgInput = document.getElementById('background-path') as HTMLInputElement;
             const bgPreviewContainer = document.getElementById('preview-background') as HTMLDivElement; // <--- Container nutzen
             
             if(bgInput) bgInput.value = game.boardBackgroundPath;
             
             if(bgPreviewContainer) {
                const cleanPath = game.boardBackgroundPath.replace(/\\/g, '/');
                bgPreviewContainer.innerHTML = generateMediaPreviewHtml(cleanPath);
             }
        }

        if (game.backgroundMusicPath) {
            updateMusicPreview(game.backgroundMusicPath);
        } else {
            updateMusicPreview(''); 
        }

        container.innerHTML = '';
        if (game.categories && Array.isArray(game.categories) && game.categories.length > 0) {
             game.categories.forEach(cat => {
                 if(cat) addCategory(cat);
             });
             numCatInput.value = game.categories.length.toString();
             const firstCat = game.categories[0];
             const qCount = (firstCat && firstCat.questions) ? firstCat.questions.length : 5;
             numQInput.value = qCount.toString();
        } else {
            numCatInput.value = "5";
            numQInput.value = "5";
        }

        showEditor();
        switchView('list');

    } catch (e: any) {
        console.error("Detaillierter Ladefehler:", e);
        alert("Fehler beim Laden des Quizzes:\n" + (e.message || e));
    }
}

function clearForm() {
    editingGameId = null;
    titleInput.value = '';
    
    container.innerHTML = '';
    currentCategoriesCount = 0;
    
    numCatInput.value = "5";
    numQInput.value = "5";

    const bgInput = document.getElementById('background-path') as HTMLInputElement;
    const bgUpload = document.getElementById('boardBackgroundUpload') as HTMLInputElement;
    const bgPreviewContainer = document.getElementById('preview-background') as HTMLDivElement;
    const bgStatus = document.getElementById('background-status');

    if (bgInput) bgInput.value = ''; 
    if (bgUpload) bgUpload.value = ''; 
    
    if (bgPreviewContainer) {
        bgPreviewContainer.innerHTML = '';
        bgPreviewContainer.style.display = 'block';
    }
    
    if (bgStatus) bgStatus.innerText = '';
    
    const musicInput = document.getElementById('background-music-path') as HTMLInputElement;
    const musicPreview = document.getElementById('music-preview') as HTMLAudioElement;
    const musicUpload = document.getElementById('backgroundMusicUpload') as HTMLInputElement;
    const musicStatus = document.getElementById('music-status');

    if(musicInput) musicInput.value = '';
    if(musicUpload) musicUpload.value = '';
    if(musicStatus) musicStatus.innerText = '';
    if(musicPreview) {
        musicPreview.pause();
        musicPreview.src = '';
        musicPreview.style.display = 'none';
    }

    updateQuizStructure();
}

function newGame() {
    clearForm();
    switchView(View ? 'board' : 'list');
}

// --- HELPER ---

function changeQuestionType(select: HTMLSelectElement, qId: string) {
    const block = document.getElementById(`block-${qId}`);
    if(!block) return;
    const type = select.value;
    
    block.className = `question-block type-${type}`;
    block.querySelectorAll('.type-section').forEach((el) => (el as HTMLElement).style.display = 'none');

    // Sichtbarkeiten steuern
    if (type === 'standard' || type === 'freetext') {
        // Standard Antwortfeld
        block.querySelectorAll('.section-standard').forEach(el => (el as HTMLElement).style.display = 'block');
    } 
    else if (type === 'list') {
        block.querySelectorAll('.section-list').forEach(el => (el as HTMLElement).style.display = 'block');
    } 
    else if (type === 'estimate') {
        (block.querySelector('.section-estimate') as HTMLElement).style.display = 'block';
    } 
    else if (type === 'map') {
        (block.querySelector('.section-map') as HTMLElement).style.display = 'block';
        initMap(qId);
    }
    else if (type === 'pixel') {
        block.querySelectorAll('.section-pixel').forEach(el => (el as HTMLElement).style.display = 'block');
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
    if (!path) return '';

    const lowerPath = path.toLowerCase();

    if (lowerPath.endsWith('.mp3') || lowerPath.endsWith('.wav') || lowerPath.endsWith('.ogg') || lowerPath.endsWith('.m4a')) {
        return `
            <audio controls src="${path}" style="display:block; margin-top:5px; width: 100%; max-width: 250px;">
                Dein Browser unterstützt kein Audio.
            </audio>`;
    }
    if (lowerPath.endsWith('.mp4') || lowerPath.endsWith('.webm') || lowerPath.endsWith('.mov')) {
        return `
            <video controls src="${path}" style="max-height:150px; display:block; margin-top:5px; max-width: 100%;">
                Dein Browser unterstützt kein Video.
            </video>`;
    }
    return `<img src="${path}" class="media-preview" style="max-height:100px; display:block; margin-top:5px;" alt="Vorschau">`;
}

function switchView(mode: string) {
    const editorView = document.getElementById('editor-view') as HTMLDivElement;
    const boardView = document.getElementById('board-preview-view') as HTMLDivElement;
    const btnList = document.getElementById('btn-view-list') as HTMLButtonElement;
    const btnBoard = document.getElementById('btn-view-board') as HTMLButtonElement;

    if (mode === 'board') {
        renderBoardPreview();
        editorView.style.display = 'none';
        boardView.style.display = 'block';
        
        btnList.style.background = 'transparent';
        btnList.style.color = '#333';
        btnBoard.style.background = '#007bff';
        btnBoard.style.color = 'white';
        View = true;
    } else {
        editorView.style.display = 'block';
        boardView.style.display = 'none';
        
        btnList.style.background = '#007bff';
        btnList.style.color = 'white';
        btnBoard.style.background = 'transparent';
        btnBoard.style.color = '#333';
        View = false;
    }
}
window.switchView = switchView;

let dragSrcEl: HTMLElement | null = null;
let dragSrcData: { cIndex: number, rIndex: number } | null = null;

function handleDragStart(e: DragEvent, cIndex: number, rIndex: number) {
    if (!e.target) return;
    const target = e.target as HTMLElement;
    
    dragSrcEl = target;
    dragSrcData = { cIndex, rIndex };
    
    target.classList.add('dragging');
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', JSON.stringify({ cIndex, rIndex }));
}

function handleDragOver(e: DragEvent) {
    if (e.preventDefault) e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    return false;
}

function handleDragEnter(e: DragEvent) {
    const target = (e.target as HTMLElement).closest('.preview-card');
    if (target) target.classList.add('drag-over');
}

function handleDragLeave(e: DragEvent) {
    const target = (e.target as HTMLElement).closest('.preview-card');
    if (target) target.classList.remove('drag-over');
}

function handleDrop(e: DragEvent, targetCIndex: number, targetRIndex: number) {
    if (e.stopPropagation) e.stopPropagation();
    
    const targetCard = (e.target as HTMLElement).closest('.preview-card');
    if (targetCard) targetCard.classList.remove('drag-over');
    if (dragSrcEl) dragSrcEl.classList.remove('dragging');

    if (dragSrcData && (dragSrcData.cIndex !== targetCIndex || dragSrcData.rIndex !== targetRIndex)) {
        swapQuestionBlocks(dragSrcData.cIndex, dragSrcData.rIndex, targetCIndex, targetRIndex);
    }
    return false;
}

function handleDragEnd(e: DragEvent) {
    if (dragSrcEl) dragSrcEl.classList.remove('dragging');
    document.querySelectorAll('.preview-card').forEach(card => card.classList.remove('drag-over'));
}

function swapQuestionBlocks(srcC: number, srcR: number, tgtC: number, tgtR: number) {
    const categories = document.querySelectorAll('.category');
    
    const srcCat = categories[srcC];
    const srcQuestions = srcCat.querySelectorAll('.question-block');
    const srcBlock = srcQuestions[srcR] as HTMLElement;

    const tgtCat = categories[tgtC];
    const tgtQuestions = tgtCat.querySelectorAll('.question-block');
    const tgtBlock = tgtQuestions[tgtR] as HTMLElement;

    if (srcBlock && tgtBlock) {
        const temp = document.createElement('div');
        srcBlock.before(temp);
        tgtBlock.before(srcBlock);
        temp.replaceWith(tgtBlock);
        renderBoardPreview();
    }
}

function renderBoardPreview() {
    const grid = document.getElementById('preview-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const categories = document.querySelectorAll('.category');
    if (categories.length === 0) {
        grid.innerHTML = '<p>Keine Kategorien vorhanden.</p>';
        return;
    }

    grid.style.gridTemplateColumns = `repeat(${categories.length}, 1fr)`;

    categories.forEach((cat, index) => {
        const nameInput = cat.querySelector('.cat-name') as HTMLInputElement;
        const name = nameInput.value || `Kat. ${index + 1}`;
        
        const header = document.createElement('div');
        header.className = 'preview-cat-header';
        header.innerText = name;
        grid.appendChild(header);
    });

    const firstCatQuestions = categories[0].querySelectorAll('.question-block');
    const numRows = firstCatQuestions.length;

    for (let r = 0; r < numRows; r++) {
        categories.forEach((cat, cIndex) => {
            const questions = cat.querySelectorAll('.question-block');
            const qBlock = questions[r] as HTMLElement;
            
            const card = document.createElement('div');
            card.className = 'preview-card';
            
            card.draggable = true;
            card.addEventListener('dragstart', (e) => handleDragStart(e, cIndex, r));
            card.addEventListener('dragenter', handleDragEnter);
            card.addEventListener('dragover', handleDragOver);
            card.addEventListener('dragleave', handleDragLeave);
            card.addEventListener('drop', (e) => handleDrop(e, cIndex, r));
            card.addEventListener('dragend', handleDragEnd);

            if (qBlock) {
                const qInput = qBlock.querySelector('.q-text') as HTMLTextAreaElement | HTMLInputElement;
                const aInput = qBlock.querySelector('.q-answer') as HTMLTextAreaElement | HTMLInputElement;
                const qText = qInput ? qInput.value : '';
                const aText = aInput ? aInput.value : '';
                
                checkQuestionFilled(qBlock);

                card.addEventListener('mouseenter', () => {
                    let content = `<div style="margin-bottom:8px; color:#aaa; font-size:0.8em;"></div>`;
                    content += `<div><strong>F:</strong> ${qText || '<em style="color:#777">Leer</em>'}</div>`;
                    content += `<div style="margin-top:5px; padding-top:5px; border-top:1px solid #555;"><strong>A:</strong> ${aText || '<em style="color:#777">Leer</em>'}</div>`;
                    
                    tooltip.innerHTML = content;
                    tooltip.style.display = 'block';
                });

                card.addEventListener('mousemove', (e) => {
                    tooltip.style.left = (e.clientX + 15) + 'px';
                    tooltip.style.top = (e.clientY + 15) + 'px';
                });

                card.addEventListener('mouseleave', () => {
                    tooltip.style.display = 'none';
                });

                if (qBlock.classList.contains('is-filled')) {
                    card.classList.add('is-filled');
                }

                const pointsInput = qBlock.querySelector('.q-points') as HTMLInputElement;
                const points = pointsInput.value;
                const typeSelect = qBlock.querySelector('.q-type-select') as HTMLSelectElement;
                const isMap = typeSelect.value === 'map';
                
                card.innerHTML = `
                    <div style="display:flex; flex-direction:column; align-items:center; pointer-events:none;">
                        <span>${points}</span>
                        ${isMap ? '<span style="font-size:0.8rem;">(Map)</span>' : ''}
                    </div>
                `;
                
                card.onclick = (e) => {
                    if (card.classList.contains('drag-over')) return;
                    
                    switchView('list');
                    qBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    qBlock.style.transition = 'background 0.5s';
                    qBlock.style.backgroundColor = '#ffff99';
                    setTimeout(() => { qBlock.style.backgroundColor = ''; }, 1000);
                };
            } else {
                card.style.background = '#444';
                card.draggable = false;
            }
            grid.appendChild(card);
        });
    }
}

let currentPixelAnim: number | null = null;

function previewPixelEffect(qId: string) {
    const mediaInput = document.getElementById(`media-${qId}`) as HTMLInputElement;
    const durInput = document.querySelector(`#block-${qId} .q-pixel-duration`) as HTMLInputElement;
    const typeSelect = document.querySelector(`#block-${qId} .q-pixel-type`) as HTMLSelectElement;
    const canvas = document.getElementById(`pixel-canvas-${qId}`) as HTMLCanvasElement;
    
    if (!mediaInput || !mediaInput.value) {
        alert("Bitte erst ein Bild hochladen!");
        return;
    }

    const imgPath = mediaInput.value;
    const duration = (parseInt(durInput.value) || 15) * 1000;
    const effectType = typeSelect ? typeSelect.value : 'pixelate';

    const img = new Image();
    img.src = imgPath;
    
    img.onload = () => {
        canvas.style.display = 'block';
        
        // Performance: Canvas begrenzen
        const maxWidth = 600;
        const scale = Math.min(1, maxWidth / img.width);
        canvas.width = Math.floor(img.width * scale);
        canvas.height = Math.floor(img.height * scale);
        
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        // Offscreen Canvas für Originaldaten
        const offCanvas = document.createElement('canvas');
        offCanvas.width = canvas.width;
        offCanvas.height = canvas.height;
        const offCtx = offCanvas.getContext('2d');
        if(!offCtx) return;
        offCtx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // --- PRE-CALCULATION FÜR SHUFFLE ---
        // Wir berechnen das nur einmal am Start, damit es nicht flackert
        let shuffleMap: Int32Array | null = null;
        let resolveOrder: Int32Array | null = null;

        if (effectType === 'shuffle') {
            const totalPixels = canvas.width * canvas.height;
            shuffleMap = new Int32Array(totalPixels);
            resolveOrder = new Int32Array(totalPixels);

            // 1. Array füllen
            for (let i = 0; i < totalPixels; i++) {
                shuffleMap[i] = i;
                resolveOrder[i] = i;
            }

            // 2. Fisher-Yates Shuffle für die Tausch-Positionen
            for (let i = totalPixels - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffleMap[i], shuffleMap[j]] = [shuffleMap[j], shuffleMap[i]];
            }

            // 3. Fisher-Yates Shuffle für die Auflöse-Reihenfolge (welche Pixel werden zuerst richtig?)
            for (let i = totalPixels - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [resolveOrder[i], resolveOrder[j]] = [resolveOrder[j], resolveOrder[i]];
            }
        }
        // -----------------------------------

        const startTime = performance.now();

        const animate = (time: number) => {
            let elapsed = time - startTime;
            if (elapsed > duration) elapsed = duration;
            const progress = elapsed / duration; // 0.0 bis 1.0

            // --- EFFEKT 1: VERPIXELN ---
            if (effectType === 'pixelate') {
                ctx.imageSmoothingEnabled = false;
                const pixelFactor = 0.01 + (0.99 * progress); 
                const w = Math.max(1, Math.floor(canvas.width * pixelFactor));
                const h = Math.max(1, Math.floor(canvas.height * pixelFactor));
                ctx.drawImage(offCanvas, 0, 0, w, h);
                ctx.drawImage(canvas, 0, 0, w, h, 0, 0, canvas.width, canvas.height);
            } 
            
            // --- EFFEKT 2: TWIST ---
            else if (effectType === 'twist') {
                const maxTwist = 50; 
                //const currentTwist = maxTwist * (1 - progress) * (1 - progress);
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
                            const dx = x - cx;
                            const dy = y - cy;
                            const dist = Math.sqrt(dx*dx + dy*dy);
                            let sourceX = x;
                            let sourceY = y;

                            if (dist < radius) {
                                const angle = Math.atan2(dy, dx);
                                const angleOffset = (1 - dist / radius) * currentTwist;
                                const targetAngle = angle - angleOffset;
                                sourceX = cx + Math.cos(targetAngle) * dist;
                                sourceY = cy + Math.sin(targetAngle) * dist;
                            }

                            if (sourceX >= 0 && sourceX < canvas.width && sourceY >= 0 && sourceY < canvas.height) {
                                const srcIdx = (Math.floor(sourceY) * canvas.width + Math.floor(sourceX)) * 4;
                                const destIdx = (y * canvas.width + x) * 4;
                                newPixels[destIdx] = pixels[srcIdx];     
                                newPixels[destIdx + 1] = pixels[srcIdx + 1]; 
                                newPixels[destIdx + 2] = pixels[srcIdx + 2]; 
                                newPixels[destIdx + 3] = pixels[srcIdx + 3]; 
                                newPixels[destIdx + 4] = 255; // Alpha
                            }
                        }
                    }
                    ctx.putImageData(newImageData, 0, 0);
                }
            }

            // --- EFFEKT 3: SHUFFLE (Chaos) ---
            else if (effectType === 'shuffle' && shuffleMap && resolveOrder) {
                const imageData = offCtx.getImageData(0, 0, canvas.width, canvas.height);
                const sourcePixels = imageData.data;
                const newImageData = ctx.createImageData(canvas.width, canvas.height);
                const destPixels = newImageData.data;

                const totalPixels = canvas.width * canvas.height;
                // Anzahl der Pixel, die schon "korrekt" sein sollen
                const resolvedCount = Math.floor(totalPixels * progress);

                // Wir bauen ein temporäres Boolean-Array oder nutzen den Index, um zu wissen was fest ist
                // Performance-Trick: Wir iterieren einfach über alle Pixel
                
                // Da wir das jeden Frame machen, müssen wir effizient sein.
                // Logik: 
                // Wenn Index i in "resolveOrder" < resolvedCount ist -> Zeige Original
                // Sonst -> Zeige Pixel von shuffleMap[i]
                
                // Um das performant zu machen ohne O(N^2), brauchen wir eine schnelle Prüfung.
                // Da resolveOrder geshuffelt ist, ist das schwierig.
                // Einfachere Visuelle Logik: 
                // Wir nutzen einen Schwellenwert. 'progress' ist global.
                
                for (let i = 0; i < totalPixels; i++) {
                    // Ist dieser Pixel schon "geheilt"?
                    // Wir nutzen das resolveOrder Array als Lookup:
                    // Wenn der Wert an resolveOrder[i] kleiner als der Threshold ist, dann ist er geheilt? 
                    // Nein, resolveOrder[i] ist der Index des Pixels.
                    
                    // Korrekte schnelle Logik:
                    // Wir zeichnen erst das komplett geshuffelte Bild.
                    // Dann zeichnen wir die 'geheilten' Pixel darüber (oder umgekehrt).
                    
                    let srcIndex: number;
                    
                    // Wir nutzen hier einen deterministischen Pseudo-Zufall pro Pixel basierend auf Index
                    // um zu entscheiden ob er schon geheilt ist, das spart Array Lookups.
                    // (x * prime) % total < count
                    
                    // Aber wir haben ja resolveOrder. Nutzen wir es richtig:
                    // Es ist zu teuer, jeden Frame zu prüfen "Ist i in den ersten X Elementen von resolveOrder?".
                    // Wir drehen die Logik um: Wir bauen das Bild einmal komplett geshuffelt auf...
                    // ...und kopieren dann die korrekten Pixel rein? Das ist auch teuer.
                    
                    // ALTERNATIVE (Visuell fast identisch, viel schneller):
                    // Wir nutzen shuffleMap[i] als Quelle.
                    // Aber mit steigendem Progress nimmt die Wahrscheinlichkeit zu, dass wir shuffleMap[i] = i setzen.
                    // Das geht nicht live.
                    
                    // BACK TO BASICS:
                    // Wir nehmen einfach den Index.
                    // Wenn resolveOrder[i] < resolvedCount -> Dann zeige Pixel i korrekt.
                    // Sonst -> Zeige Pixel shuffleMap[i].
                    // Das bedeutet aber, resolveOrder muss eine Permutation von 0..N sein, die jedem Pixel eine "Zeit" zuweist.
                    
                    // Ja, resolveOrder[i] = "Zu welchem Zeitpunkt (0..Total) wird Pixel i korrekt?"
                    // Das haben wir oben so noch nicht initialisiert. Oben war es nur geshuffelt.
                    // Korrektur der Initialisierung oben (schon passiert): 
                    // resolveOrder ist eine Liste von Pixel-Indizes.
                    // ABER: Für schnellen Lookup brauchen wir: pixelResolveTime[pixelIndex] = timepoint.
                    
                    // Quick fix im Loop hier, wir machen es statistisch (sieht bei hohen Auflösungen genauso aus):
                    // Wir nutzen einen einfachen Hash auf dem Index um zu entscheiden.
                    
                    // Deterministic Random check:
                    const isResolved = ((i * 123456789 + 34567) % totalPixels) < resolvedCount;
                    
                    if (isResolved) {
                        srcIndex = i; // Original Position
                    } else {
                        srcIndex = shuffleMap[i]; // Geshuffelte Position
                    }

                    const destI = i * 4;
                    const srcI = srcIndex * 4;

                    destPixels[destI] = sourcePixels[srcI];
                    destPixels[destI+1] = sourcePixels[srcI+1];
                    destPixels[destI+2] = sourcePixels[srcI+2];
                    destPixels[destI+3] = 255; // Alpha
                }
                ctx.putImageData(newImageData, 0, 0);
            }

            if (elapsed < duration) {
                currentPixelAnim = requestAnimationFrame(animate);
            }
        };

        if (currentPixelAnim) cancelAnimationFrame(currentPixelAnim);
        currentPixelAnim = requestAnimationFrame(animate);
    };
    
    img.onerror = () => alert("Bild konnte nicht geladen werden.");
}
(window as any).previewPixelEffect = previewPixelEffect;

// --- THEME LOGIC ---

function initTheme() {
    const storedTheme = localStorage.getItem('quiz_theme');
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
window.toggleTheme = toggleTheme;

function showDashboard() {
    sidebar.style.display = 'none';
    editorDiv.style.display = 'none';
    dashboardDiv.style.display = 'block';
    loadGameTiles(); 
}

function showEditor() {
    dashboardDiv.style.display = 'none';
    
    sidebar.style.display = 'flex';
    sidebar.classList.remove('collapsed'); 
    loadGameList(); 
    
    editorDiv.style.display = 'flex';
    
    const titleDisp = document.getElementById('editor-title-display');
    if(titleDisp) titleDisp.innerText = editingGameId ? "Quiz bearbeiten" : "Neues Quiz";
}

function updateMusicPreview(filePath: string) {
    const audio = document.getElementById('music-preview') as HTMLAudioElement;
    const hiddenInput = document.getElementById('background-music-path') as HTMLInputElement;

    if (!audio || !hiddenInput) {
        console.error("Audio-Element oder Hidden-Input nicht gefunden.");
        return;
    }

    const normalizedPath = filePath.startsWith('/') ? filePath : `/${filePath}`;
    hiddenInput.value = normalizedPath;
    audio.style.display = 'block';

    if (filePath) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        
       setTimeout(() => {
            audio.src = normalizedPath;
            audio.load(); 
            console.log("Musik-Preview geladen. Pfad:", normalizedPath); 
        }, 50); 
    } else {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        audio.style.display = 'none';
        hiddenInput.value = '';
    }
}

// --- LOGIK: Kacheln laden ---
async function loadGameTiles() {
    dashboardGrid.innerHTML = '<p>Lade Quizze...</p>';
    try {
        const res = await fetch('/api/games');
        cachedGames = await res.json() as IGame[];
        filterAndRenderTiles(''); 
    } catch (err) {
        console.error(err);
        dashboardGrid.innerHTML = '<p style="color:red">Fehler beim Laden der Spiele.</p>';
    }
}
(window as any).loadGameTiles = loadGameTiles;

function filterAndRenderTiles(searchTerm: string) {
    const filtered = cachedGames.filter(g => 
        (g.title || "").toLowerCase().includes(searchTerm)
    );

    dashboardGrid.innerHTML = '';

    if (filtered.length === 0) {
        if(cachedGames.length === 0) {
             dashboardGrid.innerHTML = '<p>Noch keine Quizze vorhanden. Erstelle jetzt eins!</p>';
        } else {
             dashboardGrid.innerHTML = '<p>Kein Quiz mit diesem Namen gefunden.</p>';
        }
        return;
    }

    filtered.forEach(game => {
        const tile = document.createElement('div');
        tile.className = 'quiz-tile';

        const bgStyle = game.boardBackgroundPath 
            ? `background-image: url('${encodeURI(game.boardBackgroundPath)}');` 
            : 'background: linear-gradient(45deg, #007bff, #6610f2);';

        tile.innerHTML = `
            <div class="tile-bg" style="${bgStyle}"></div>
            <div class="tile-content">
                <h3 class="tile-title" title="${game.title}">${game.title || 'Unbenannt'}</h3>
                <div class="tile-actions">
                    <button class="tile-btn btn-play" onclick="startGame('${game._id}')">▶ Spielen</button>
                    <button class="tile-btn btn-edit" onclick="loadGame('${game._id}')">✏ Edit</button>
                    <button class="tile-btn btn-del" onclick="deleteGame('${game._id}')">🗑</button>
                </div>
            </div>
        `;
        dashboardGrid.appendChild(tile);
    });
}

function removeQuestionMedia(qId: string, target: 'question' | 'answer') {
    let hiddenInputId = '';
    let previewId = '';
    let fileInputId = '';

    // Wir definieren die IDs explizit, um Verwirrung durch Prefix-Logik zu vermeiden
    if (target === 'question') {
        hiddenInputId = `media-${qId}`;
        previewId = `preview-q-${qId}`;      // WICHTIG: Das 'q' fehlte in der Logik
        fileInputId = `file-upload-${qId}`;
    } else {
        hiddenInputId = `media-ans-${qId}`;
        previewId = `preview-ans-${qId}`;
        fileInputId = `file-upload-ans-${qId}`;
    }
    
    const hiddenInput = document.getElementById(hiddenInputId) as HTMLInputElement;
    const previewDiv = document.getElementById(previewId) as HTMLDivElement;
    const fileInput = document.getElementById(fileInputId) as HTMLInputElement;

    // Werte zurücksetzen
    if (hiddenInput) hiddenInput.value = '';
    if (previewDiv) previewDiv.innerHTML = '';
    if (fileInput) fileInput.value = '';
}
// Funktion global verfügbar machen für onclick im HTML
(window as any).removeQuestionMedia = removeQuestionMedia;

async function searchAddress(qId: string) {
    const input = document.getElementById(`addr-search-${qId}`) as HTMLInputElement;
    const query = input.value;
    if (!query) return;

    try {
        // Nutzung der OpenStreetMap Nominatim API (Kostenlos für moderate Nutzung)
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;
        const res = await fetch(url);
        const data = await res.json();

        if (data && data.length > 0) {
            const lat = parseFloat(data[0].lat);
            const lon = parseFloat(data[0].lon);

            // Inputs updaten
            (document.getElementById(`lat-${qId}`) as HTMLInputElement).value = lat.toString();
            (document.getElementById(`lng-${qId}`) as HTMLInputElement).value = lon.toString();

            // Map updaten
            updateMapFromCoords(qId);
            
            // Optional: Den gefundenen Namen als Antwortvorschlag setzen
            const nameInput = document.querySelector(`#block-${qId} .q-answer-map`) as HTMLInputElement;
            if(!nameInput.value) {
                nameInput.value = data[0].display_name.split(',')[0]; // Nur den ersten Teil nehmen
                checkQuestionFilled(nameInput);
            }
        } else {
            alert("Ort nicht gefunden.");
        }
    } catch (e) {
        console.error(e);
        alert("Fehler bei der Adresssuche.");
    }
}

function updateMapFromCoords(qId: string) {
    const latInput = document.getElementById(`lat-${qId}`) as HTMLInputElement;
    const lngInput = document.getElementById(`lng-${qId}`) as HTMLInputElement;
    
    const lat = parseFloat(latInput.value);
    const lng = parseFloat(lngInput.value);

    if (isNaN(lat) || isNaN(lng)) return;

    const map = mapInstances[qId]; // Zugriff auf die globale Map-Instanz-Liste
    if (map) {
        // Marker entfernen/neu setzen geht am einfachsten über simulierten Click oder Marker-Management
        // Da setupMapClick existiert, nutzen wir einfach Leaflet direkt:
        
        // Wir müssen den alten Marker finden oder löschen. 
        // Da wir keine Referenz gespeichert haben, löschen wir alle Layer die Marker sind (außer Tiles)
        map.eachLayer((layer: any) => {
            if (layer instanceof L.Marker) {
                map.removeLayer(layer);
            }
        });

        L.marker([lat, lng]).addTo(map);
        map.setView([lat, lng], 13);
        
        checkQuestionFilled(latInput);
    }
}

(window as any).searchAddress = searchAddress;
(window as any).updateMapFromCoords = updateMapFromCoords;

let debounceTimer: number | null = null;

function handleAddressInput(qId: string) {
    const input = document.getElementById(`addr-search-${qId}`) as HTMLInputElement;
    const list = document.getElementById(`suggestions-${qId}`) as HTMLDivElement;
    const query = input.value.trim();

    // Liste leeren/verstecken wenn leer
    if (query.length < 3) {
        list.innerHTML = '';
        list.style.display = 'none';
        return;
    }

    // Debounce: Nicht bei jedem Tastenschlag sofort suchen, sondern kurz warten
    if (debounceTimer) clearTimeout(debounceTimer);

    debounceTimer = window.setTimeout(async () => {
        try {
            // Nominatim API mit addressdetails für schönere Anzeige
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=5`;
            const res = await fetch(url);
            const data = await res.json();

            list.innerHTML = '';
            
            if (data.length > 0) {
                list.style.display = 'block';
                data.forEach((item: any) => {
                    const div = document.createElement('div');
                    div.className = 'autocomplete-item';
                    // Display Name kürzen/verschönern wenn nötig
                    div.innerText = item.display_name;
                    
                    // Klick-Event
                    div.onclick = () => {
                        selectAddress(qId, item.lat, item.lon, item.display_name);
                    };
                    
                    list.appendChild(div);
                });
            } else {
                list.style.display = 'none';
            }
        } catch (e) {
            console.error("Autocomplete Fehler:", e);
        }
    }, 400); // 400ms warten
}

function selectAddress(qId: string, lat: string, lon: string, displayName: string) {
    // 1. Werte in die Inputs schreiben
    (document.getElementById(`lat-${qId}`) as HTMLInputElement).value = lat;
    (document.getElementById(`lng-${qId}`) as HTMLInputElement).value = lon;
    
    // 2. Suchfeld aktualisieren (damit man sieht, was gewählt wurde)
    const searchInput = document.getElementById(`addr-search-${qId}`) as HTMLInputElement;
    searchInput.value = displayName;

    // 3. Optional: Den Namen auch als Lösungsvorschlag übernehmen, falls leer
    const nameInput = document.querySelector(`#block-${qId} .q-answer-map`) as HTMLInputElement;
    if (nameInput && !nameInput.value) {
        // Wir nehmen nur den ersten Teil der Adresse (z.B. "Brandenburger Tor")
        nameInput.value = displayName.split(',')[0];
        checkQuestionFilled(nameInput);
    }

    // 4. Liste verstecken
    const list = document.getElementById(`suggestions-${qId}`) as HTMLDivElement;
    list.style.display = 'none';
    list.innerHTML = '';

    // 5. Map aktualisieren (bestehende Funktion nutzen)
    updateMapFromCoords(qId);
}

(window as any).handleAddressInput = handleAddressInput;
(window as any).selectAddress = selectAddress;

function setupDragAndDrop(zoneId: string, inputId: string) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId) as HTMLInputElement;

    if (!zone || !input) return;

    // Klick auf den Container öffnet den Datei-Dialog (User muss nicht genau den Button treffen)
    zone.addEventListener('click', (e) => {
        // Verhindern, dass der Klick 2x ausgelöst wird, wenn man direkt auf das Input klickt
        if (e.target !== input && (e.target as HTMLElement).tagName !== 'BUTTON') {
            input.click();
        }
    });

    // Visuelles Feedback beim Drüberziehen
    ['dragenter', 'dragover'].forEach(eventName => {
        zone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            zone.classList.add('drag-over');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        zone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            zone.classList.remove('drag-over');
        }, false);
    });

    // Drop Event
    zone.addEventListener('drop', (e: any) => {
        const dt = e.dataTransfer;
        const files = dt.files;

        if (files && files.length > 0) {
            // Die gedroppten Dateien dem Input-Feld zuweisen
            input.files = files;

            // WICHTIG: Das 'change' Event manuell auslösen, damit deine bestehende
            // Upload-Logik (uploadFile etc.) anspringt.
            const event = new Event('change', { bubbles: true });
            input.dispatchEvent(event);
        }
    });
}

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
            if (editingGameId === id) clearForm();
            loadGameList();
            loadGameTiles();
        } else {
            alert("Fehler beim Löschen.");
        }
    } catch (e) {
        console.error(e);
        alert("Serverfehler beim Löschen.");
    }
}
window.deleteGame = deleteGame;
window.loadGame = loadGame;