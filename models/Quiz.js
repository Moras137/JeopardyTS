const mongoose = require('mongoose');

const QuestionSchema = new mongoose.Schema({
  points: Number,
  questionText: String,
  answerText: String,
  hasMedia: Boolean,
  mediaType: String,
  mediaPath: String,
  isAnswered: { type: Boolean, default: false }
});

const CategorySchema = new mongoose.Schema({
  name: String,
  questions: [QuestionSchema]
});

const GameSchema = new mongoose.Schema({
  title: String,
  categories: [CategorySchema]
});

// WICHTIG: Hier wird das Modell direkt exportiert!
module.exports = mongoose.model('Game', GameSchema);