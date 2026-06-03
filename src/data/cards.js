const fs = require("node:fs");
const path = require("node:path");

const cardsPath = path.join(__dirname, "../../data/cards.json");

function loadCards() {
  if (!fs.existsSync(cardsPath)) {
    return [];
  }

  return JSON.parse(fs.readFileSync(cardsPath, "utf8"));
}

const cards = loadCards();

const timeLimitSecondsByDifficulty = {
  easy: 30,
  medium: 45,
  hard: 60,
};

function normalizeCardCode(code) {
  const raw = String(code || "").trim().toUpperCase();
  const numberOnly = raw.match(/^\d+$/) ? Number(raw) : null;
  if (numberOnly) {
    return `TH${String(numberOnly).padStart(2, "0")}`;
  }

  const match = raw.match(/^TH\s*0*(\d+)$/);
  if (match) {
    return `TH${String(Number(match[1])).padStart(2, "0")}`;
  }

  return raw;
}

function findCard(code) {
  const normalized = normalizeCardCode(code);
  return cards.find((card) => card.code === normalized);
}

function findQuestion(card, difficulty) {
  return card.questions.find((question) => question.difficulty === difficulty);
}

function questionKey(cardCode, difficulty) {
  return `${normalizeCardCode(cardCode)}:${difficulty}`;
}

function sanitizeQuestion(question, includeAnswers = false) {
  const timeLimitSeconds = question.type === "open" ? 180 : timeLimitSecondsByDifficulty[question.difficulty] || 60;

  if (includeAnswers) {
    return { ...question, timeLimitSeconds };
  }

  const {
    answer,
    correctOption,
    explanation,
    suggestedAnswer,
    gradingGuide,
    ...publicQuestion
  } = question;

  return { ...publicQuestion, timeLimitSeconds };
}

function toPublicCard(card, options = {}) {
  const usedQuestionKeys = options.usedQuestionKeys || new Set();
  const includeAnswers = options.includeAnswers === true;
  const hideUsed = options.hideUsed === true;

  const questions = card.questions
    .map((question) => ({
      ...sanitizeQuestion(question, includeAnswers),
      used: usedQuestionKeys.has(questionKey(card.code, question.difficulty)),
    }))
    .filter((question) => !hideUsed || !question.used);

  return {
    ...card,
    questions,
    usedCount: card.questions.length - questions.filter((question) => !question.used).length,
    totalQuestions: card.questions.length,
  };
}

module.exports = {
  cards,
  findCard,
  findQuestion,
  questionKey,
  normalizeCardCode,
  sanitizeQuestion,
  toPublicCard,
};
