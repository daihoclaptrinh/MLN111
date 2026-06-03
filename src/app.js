const express = require("express");
const cors = require("cors");
const { z } = require("zod");

const { cards, findCard, findQuestion, questionKey, toPublicCard, sanitizeQuestion } = require("./data/cards");
const { events, pickRandomEvent } = require("./data/events");
const { skills, findSkill } = require("./data/skills");
const { checkAnswer } = require("./services/answerChecker");
const { createMatchStore, normalizeScopeId } = require("./services/matchStore");

const matchStore = createMatchStore();

function getCorsOptions() {
  const configuredOrigins = String(process.env.CORS_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const allowedOrigins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    ...configuredOrigins,
  ].map((origin) => origin.replace(/\/$/, ""));

  const allowedPatterns = allowedOrigins
    .filter((origin) => origin.includes("*"))
    .map((origin) => new RegExp(`^${origin.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*")}$`));

  return {
    origin(origin, callback) {
      const normalizedOrigin = origin?.replace(/\/$/, "");
      if (
        !normalizedOrigin ||
        allowedOrigins.includes(normalizedOrigin) ||
        allowedPatterns.some((pattern) => pattern.test(normalizedOrigin))
      ) {
        return callback(null, true);
      }

      return callback(new Error(`CORS origin not allowed: ${origin}`));
    },
  };
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

async function getScopeIdFromRequest(req) {
  if (req.query.scopeId) {
    return normalizeScopeId(req.query.scopeId);
  }

  if (req.query.matchId) {
    return matchStore.getScopeIdForMatch(req.query.matchId);
  }

  return null;
}

async function getUsedQuestionKeys(scopeId) {
  if (!scopeId) {
    return new Set();
  }

  const usedQuestions = await matchStore.getUsedQuestions(scopeId);
  return new Set(usedQuestions.map((item) => questionKey(item.cardCode, item.difficulty)));
}

function createApp({ displayHub } = {}) {
  const app = express();

  app.use(cors(getCorsOptions()));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (req, res) => {
    res.json({ status: "ok", service: "triet-chien-api", database: matchStore.mode });
  });

  app.get("/api/events", (req, res) => {
    res.json({ count: events.length, data: events });
  });

  app.get("/api/skills", (req, res) => {
    res.json({ count: skills.length, data: skills });
  });

  app.get(
    "/api/cards",
    asyncRoute(async (req, res) => {
      const includeQuestions = req.query.includeQuestions === "true";
      const hideUsed = req.query.hideUsed === "true";
      const scopeId = await getScopeIdFromRequest(req);
      const usedQuestionKeys = await getUsedQuestionKeys(scopeId);

      const publicCards = cards.map((card) => toPublicCard(card, { usedQuestionKeys, hideUsed }));

      res.json({
        count: publicCards.length,
        scopeId,
        data: includeQuestions
          ? publicCards
          : publicCards.map(({ questions, ...card }) => ({
              ...card,
              availableCount: questions.filter((question) => !question.used).length,
              difficulties: questions.map((question) => ({
                difficulty: question.difficulty,
                points: question.points,
                type: question.type,
                used: question.used,
              })),
            })),
      });
    }),
  );

  app.get(
    "/api/cards/:code",
    asyncRoute(async (req, res) => {
      const card = findCard(req.params.code);
      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }

      const scopeId = await getScopeIdFromRequest(req);
      const usedQuestionKeys = await getUsedQuestionKeys(scopeId);
      const publicCard = toPublicCard(card, {
        usedQuestionKeys,
        hideUsed: req.query.hideUsed === "true",
        includeAnswers: req.query.includeAnswers === "true",
      });

      if (req.query.includeQuestionText !== "true") {
        publicCard.questions = publicCard.questions.map((question) => ({
          difficulty: question.difficulty,
          points: question.points,
          type: question.type,
          label: question.label,
          used: question.used,
        }));
      }

      return res.json({ data: publicCard });
    }),
  );

  app.get(
    "/api/cards/:code/questions/:difficulty",
    asyncRoute(async (req, res) => {
      const card = findCard(req.params.code);
      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }

      const question = findQuestion(card, req.params.difficulty);
      if (!question) {
        return res.status(404).json({ message: "Question not found" });
      }

      const scopeId = await getScopeIdFromRequest(req);
      const used =
        scopeId && (await matchStore.isQuestionUsed(scopeId, card.code, question.difficulty));

      if (used && req.query.includeUsed !== "true") {
        return res.status(409).json({ message: "Câu hỏi này đã được dùng trong đợt chơi hiện tại." });
      }

      return res.json({
        data: {
          cardCode: card.code,
          cardTitle: card.title,
          question: {
            ...sanitizeQuestion(question, req.query.includeAnswers === "true"),
            used: Boolean(used),
          },
        },
      });
    }),
  );

  app.post(
    "/api/answers/check",
    asyncRoute(async (req, res) => {
      const schema = z.object({
        cardCode: z.string().min(1),
        difficulty: z.enum(["easy", "medium", "hard"]),
        answer: z.string().min(1),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
      }

      const card = findCard(parsed.data.cardCode);
      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }

      const question = findQuestion(card, parsed.data.difficulty);
      if (!question) {
        return res.status(404).json({ message: "Question not found" });
      }

      return res.json({
        data: checkAnswer(question, parsed.data.answer),
      });
    }),
  );

  app.post(
    "/api/matches",
    asyncRoute(async (req, res) => {
      const schema = z.object({
        playerNames: z.array(z.string().trim().min(1)).min(1).max(12),
        scopeId: z.string().trim().min(1).default("default-class"),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
      }

      const match = await matchStore.create(parsed.data);
      return res.status(201).json({ data: match });
    }),
  );

  app.get(
    "/api/matches/:matchId",
    asyncRoute(async (req, res) => {
      const match = await matchStore.get(req.params.matchId);
      if (!match) {
        return res.status(404).json({ message: "Match not found" });
      }

      return res.json({ data: match });
    }),
  );

  app.get("/api/matches/:matchId/display", (req, res) => {
    res.json({ data: displayHub?.getState(req.params.matchId) || { matchId: req.params.matchId, screen: "idle" } });
  });

  app.post(
    "/api/matches/:matchId/questions/reveal",
    asyncRoute(async (req, res) => {
      const schema = z.object({
        playerId: z.string().min(1).optional(),
        cardCode: z.string().min(1),
        difficulty: z.enum(["easy", "medium", "hard"]),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
      }

      const card = findCard(parsed.data.cardCode);
      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }

      const question = findQuestion(card, parsed.data.difficulty);
      if (!question) {
        return res.status(404).json({ message: "Question not found" });
      }

      const result = await matchStore.markQuestionUsed(req.params.matchId, {
        cardCode: card.code,
        difficulty: question.difficulty,
        playerId: parsed.data.playerId,
      });

      if (!result.ok) {
        return res.status(result.status).json({ message: result.message });
      }

      return res.json({
        data: {
          match: result.match,
          card: toPublicCard(card, {
            usedQuestionKeys: new Set([questionKey(card.code, question.difficulty)]),
          }),
          question: {
            ...sanitizeQuestion(question, req.query.includeAnswers === "true"),
            used: true,
          },
        },
      });
    }),
  );

  app.post(
    "/api/matches/:matchId/skills/apply",
    asyncRoute(async (req, res) => {
      const schema = z.object({
        playerId: z.string().min(1),
        targetPlayerId: z.string().min(1).optional(),
        skillCode: z.string().min(1),
        manualDelta: z.number().int().min(-20).max(20).default(0),
        targetDelta: z.number().int().min(-20).max(20).default(0),
        effectType: z.enum(["event_immunity", "loss_immunity", "causality_trap"]).optional(),
        note: z.string().trim().max(500).optional(),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
      }

      const skill = findSkill(parsed.data.skillCode);
      if (!skill) {
        return res.status(404).json({ message: "Skill not found" });
      }

      if (skill.requiresTarget && !parsed.data.targetPlayerId) {
        return res.status(400).json({ message: "This skill requires a target player" });
      }

      const result = await matchStore.applySkill(req.params.matchId, skill, parsed.data);
      if (!result.ok) {
        return res.status(result.status).json({ message: result.message });
      }

      return res.json({ data: { match: result.match, skill, scoreChanges: result.scoreChanges || [] } });
    }),
  );

  app.post(
    "/api/matches/:matchId/events/random",
    asyncRoute(async (req, res) => {
      const match = await matchStore.get(req.params.matchId);
      if (!match) {
        return res.status(404).json({ message: "Match not found" });
      }

      if (!match.pendingEvent) {
        return res.status(409).json({ message: "Cần hoàn thành một lượt trước khi quay biến cố." });
      }

      const event = pickRandomEvent();
      if (!event) {
        return res.status(404).json({ message: "Event deck is empty" });
      }

      const result = await matchStore.recordEvent(req.params.matchId, event);
      if (!result.ok) {
        return res.status(result.status).json({ message: result.message });
      }

      return res.json({ data: { match: result.match, event: result.match.lastEvent || event } });
    }),
  );

  app.post(
    "/api/matches/:matchId/score",
    asyncRoute(async (req, res) => {
      const schema = z.object({
        playerId: z.string().min(1),
        delta: z.number().int(),
        reason: z.string().trim().min(1).default("manual_adjustment"),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
      }

      const result = await matchStore.adjustScore(req.params.matchId, parsed.data);
      if (!result.ok) {
        return res.status(result.status).json({ message: result.message });
      }

      return res.json({ data: result.match });
    }),
  );

  app.post(
    "/api/matches/:matchId/answers",
    asyncRoute(async (req, res) => {
      const schema = z.object({
        playerId: z.string().min(1),
        cardCode: z.string().min(1),
        difficulty: z.enum(["easy", "medium", "hard"]),
        answer: z.string().min(1),
        isCorrectOverride: z.boolean().optional(),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
      }

      const card = findCard(parsed.data.cardCode);
      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }

      const question = findQuestion(card, parsed.data.difficulty);
      if (!question) {
        return res.status(404).json({ message: "Question not found" });
      }

      const checked = checkAnswer(question, parsed.data.answer);
      const finalCorrect =
        typeof parsed.data.isCorrectOverride === "boolean" ? parsed.data.isCorrectOverride : checked.correct;

      const result = await matchStore.recordAnswer(req.params.matchId, {
        playerId: parsed.data.playerId,
        cardCode: card.code,
        difficulty: question.difficulty,
        answer: parsed.data.answer,
        points: 0,
        correct: finalCorrect,
        autoGradable: checked.autoGradable,
      });

      if (!result.ok) {
        return res.status(result.status).json({ message: result.message });
      }

      return res.json({ data: { match: result.match, grading: checked } });
    }),
  );

  app.post(
    "/api/matches/:matchId/turns/skip",
    asyncRoute(async (req, res) => {
      const schema = z.object({
        playerId: z.string().min(1),
        reason: z.string().trim().min(1).default("manual_skip"),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
      }

      const result = await matchStore.skipTurn(req.params.matchId, parsed.data);
      if (!result.ok) {
        return res.status(result.status).json({ message: result.message });
      }

      return res.json({ data: result.match });
    }),
  );

  app.use((req, res) => {
    res.status(404).json({ message: "Route not found" });
  });

  app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  });

  return app;
}

module.exports = { createApp };
