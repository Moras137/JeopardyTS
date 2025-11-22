const mongoose = require('mongoose');

// --- 1. Question Schema (Frage) ---
const questionSchema = new mongoose.Schema({
    points: { type: Number, default: 100 },
    negativePoints: { type: Number, default: 0 }, 
    
    // required: true ENTFERNT
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
    // required: true ENTFERNT
    name: { type: String, default: '' },
    questions: [questionSchema]
});

// --- 3. Game Schema (Hauptquiz) ---
const gameSchema = new mongoose.Schema({
    // Dies ist das einzige Feld, das wirklich erforderlich sein sollte
    title: { type: String, required: true }, 
    
    boardBackgroundPath: { type: String, default: '' },
    
    categories: [categorySchema]
});

module.exports = mongoose.model('Game', gameSchema);