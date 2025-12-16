// src/models/Quiz.ts
import { Schema, model } from 'mongoose';
import { IGame, ICategory, IQuestion } from '../types';

const questionSchema = new Schema<IQuestion>({
    type: { type: String, default: 'standard', enum: ['standard', 'map'] },
    location: {
        lat: { type: Number },
        lng: { type: Number },
        isCustomMap: { type: Boolean, default: false }, 
        customMapPath: { type: String, default: '' },
        mapWidth: { type: Number }, 
        mapHeight: { type: Number }
    },

    estimationAnswer: { type: Number },
    listItems: { type: [String], default: [] },
    pixelConfig: {
        blurStrength: { type: Number, default: 0 },
        resolutionDuration: { type: Number, default: 15 }, 
        effectType: { type: String, default: 'pixelate', enum: ['pixelate', 'twist', 'shuffle'] }
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

const categorySchema = new Schema<ICategory>({
    name: { type: String, default: '' },
    questions: [questionSchema]
});

const gameSchema = new Schema<IGame>({
    title: { type: String, required: true }, 
    boardBackgroundPath: { type: String, default: '' },
    backgroundMusicPath: { type: String, default: '' },
    categories: [categorySchema]
});

export const GameModel = model<IGame>('Game', gameSchema);