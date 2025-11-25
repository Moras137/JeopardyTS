const mongoose = require('mongoose');

// --- 1. Question Schema (Frage) ---
const questionSchema = new mongoose.Schema({
    type: { type: String, default: 'standard', enum: ['standard', 'map'] },

    location: {
        lat: { type: Number }, // Breitengrad
        lng: { type: Number }, // Längengrad
        isCustomMap: { type: Boolean, default: false }, 
        customMapPath: { type: String, default: '' },
        mapWidth: { type: Number }, 
        mapHeight: { type: Number }
    },

    points: { type: Number, default: 100 },
    negativePoints: { type: Number, default: 0 }, 
    
    questionText: { type: String, default: '' }, 
    answerText: { type: String, default: '' }, 

    answerMediaPath: { type: String, default: '' },
    hasAnswerMedia: { type: Boolean, default: false },
    answerMediaType: { type: String, default: 'none' },

    mediaPath: { type: String, default: '' },
    hasMedia: { type: Boolean, default: false },
    mediaType: { type: String, default: 'none' },
});

// --- 2. Category Schema (Kategorie) ---
const categorySchema = new mongoose.Schema({
    name: { type: String, default: '' },
    questions: [questionSchema]
});

// --- 3. Game Schema (Hauptquiz) ---
const gameSchema = new mongoose.Schema({
    title: { type: String, required: true }, 
    
    boardBackgroundPath: { type: String, default: '' },
    
    categories: [categorySchema]
});

module.exports = mongoose.model('Game', gameSchema);