const crypto = require("node:crypto");
const mongoose = require("mongoose");

const DEFAULT_SCOPE_ID = "default-class";

function now() {
  return new Date().toISOString();
}

function normalizeScopeId(scopeId) {
  return String(scopeId || DEFAULT_SCOPE_ID)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 80) || DEFAULT_SCOPE_ID;
}

function sortPlayers(players) {
  return [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function getTurnOrderState(match) {
  const players = match.players || [];
  const answered = new Set(match.answeredPlayerIds || []);
  const skipped = new Set(match.skippedPlayerIds || []);
  const processed = new Set([...answered, ...skipped]);
  const currentIndex = players.findIndex((player) => !processed.has(player.id));
  const currentPlayer = currentIndex >= 0 ? players[currentIndex] : null;

  return {
    currentPlayerId: currentPlayer?.id || null,
    currentPlayerName: currentPlayer?.name || null,
    currentIndex,
    isRoundComplete: players.length > 0 && processed.size >= players.length,
    order: players.map((player, index) => ({
      id: player.id,
      name: player.name,
      position: index + 1,
      answered: answered.has(player.id),
      skipped: skipped.has(player.id),
      processed: processed.has(player.id),
      current: player.id === currentPlayer?.id,
    })),
  };
}

function validatePlayerTurn(match, playerId) {
  const turnOrder = getTurnOrderState(match);
  if (!playerId) {
    return { ok: false, status: 400, message: "Cần chọn người đang đến lượt." };
  }
  if (turnOrder.isRoundComplete || match.pendingEvent) {
    return { ok: false, status: 409, message: "Vòng này đã đủ lượt. Hãy quay biến cố trước khi tiếp tục." };
  }
  const player = (match.players || []).find((item) => item.id === playerId);
  if (!player) {
    return { ok: false, status: 404, message: "Player not found" };
  }
  if ((match.answeredPlayerIds || []).includes(playerId)) {
    return { ok: false, status: 409, message: "Người chơi này đã trả lời trong vòng hiện tại." };
  }
  if ((match.skippedPlayerIds || []).includes(playerId)) {
    return { ok: false, status: 409, message: "Người chơi này đã bị bỏ qua trong vòng hiện tại." };
  }
  return { ok: true };
}

function updateRoundCompletion(match) {
  const processed = new Set([...(match.answeredPlayerIds || []), ...(match.skippedPlayerIds || [])]);
  match.pendingEvent = (match.players || []).length > 0 && processed.size >= match.players.length;
}

function getStatusEffects(player) {
  if (!Array.isArray(player.statusEffects)) {
    player.statusEffects = [];
  }
  return player.statusEffects;
}

function addStatusEffect(player, effect) {
  const effects = getStatusEffects(player);
  const existingIndex = effects.findIndex((item) => item.type === effect.type);
  const nextEffect = { ...effect, createdAt: now() };
  if (existingIndex >= 0) {
    effects.splice(existingIndex, 1, nextEffect);
  } else {
    effects.push(nextEffect);
  }
}

function consumeStatusEffect(player, type) {
  const effects = getStatusEffects(player);
  const index = effects.findIndex((effect) => effect.type === type);
  if (index < 0) return null;
  const [effect] = effects.splice(index, 1);
  return effect;
}

function hasStatusEffect(player, type) {
  return getStatusEffects(player).some((effect) => effect.type === type);
}

function hasLossImmunity(player) {
  return hasStatusEffect(player, "loss_immunity") || hasStatusEffect(player, "event_immunity");
}

function blockLossIfProtected(player, source) {
  if (!player || !hasLossImmunity(player)) return null;

  const consumed =
    source === "event"
      ? consumeStatusEffect(player, "event_immunity") || consumeStatusEffect(player, "loss_immunity")
      : consumeStatusEffect(player, "loss_immunity");

  return consumed || null;
}

function applySkillScoreEffects(
  match,
  skill,
  { playerId, targetPlayerId, manualDelta = 0, targetDelta = 0, effectType = "" },
) {
  const player = match.players.find((item) => item.id === playerId);
  if (!player) {
    return { ok: false, status: 404, message: "Player not found" };
  }

  const targetPlayer = targetPlayerId
    ? match.players.find((item) => item.id === targetPlayerId)
    : null;
  if (targetPlayerId && !targetPlayer) {
    return { ok: false, status: 404, message: "Target player not found" };
  }

  const scoreChanges = [];
  const changeScore = (target, delta, source = "skill") => {
    if (!target || delta === 0) return true;
    const blockedBy = delta < 0 ? blockLossIfProtected(target, source) : null;
    if (blockedBy) {
      scoreChanges.push({
        playerId: target.id,
        name: target.name,
        delta: 0,
        score: target.score,
        blocked: true,
        blockedBy: blockedBy.skillCode,
      });
      return false;
    }
    target.score += delta;
    scoreChanges.push({ playerId: target.id, name: target.name, delta, score: target.score });
    return true;
  };

  if (effectType === "event_immunity") {
    addStatusEffect(player, {
      type: "event_immunity",
      label: "Miễn biến cố kế tiếp",
      skillCode: skill.code,
      skillTitle: skill.title,
    });
  } else if (effectType === "loss_immunity") {
    addStatusEffect(player, {
      type: "loss_immunity",
      label: "Miễn mất điểm",
      skillCode: skill.code,
      skillTitle: skill.title,
    });
  } else if (effectType === "causality_trap") {
    if (!targetPlayer) {
      return { ok: false, status: 400, message: "This skill requires a target player" };
    }
    addStatusEffect(targetPlayer, {
      type: "causality_trap",
      label: "Bẫy nhân quả",
      skillCode: skill.code,
      skillTitle: skill.title,
      sourcePlayerId: player.id,
      sourcePlayerName: player.name,
    });
  } else if (skill.automation === "steal_one") {
    if (!targetPlayer) {
      return { ok: false, status: 400, message: "This skill requires a target player" };
    }
    if (changeScore(targetPlayer, -1)) {
      changeScore(player, 1);
    }
  } else if (skill.automation === "self_plus_five") {
    changeScore(player, 5);
  } else if (skill.automation === "self_plus_one") {
    changeScore(player, 1);
  } else if (skill.automation === "random_zero_to_three") {
    changeScore(player, Math.floor(Math.random() * 4));
  } else if (skill.automation === "both_plus_one") {
    if (!targetPlayer) {
      return { ok: false, status: 400, message: "This skill requires a target player" };
    }
    changeScore(player, 1);
    changeScore(targetPlayer, 1);
  } else {
    changeScore(player, manualDelta);
    changeScore(targetPlayer, targetDelta);
  }

  return { ok: true, scoreChanges };
}

function applyEventScoreEffects(match, event) {
  return [];
}

function toPlainMatch(match) {
  const plain = typeof match.toObject === "function" ? match.toObject() : match;
  const players = (plain.players || []).map((player) => ({
    ...player,
    statusEffects: Array.isArray(player.statusEffects) ? player.statusEffects : [],
  }));
  const answeredPlayerIds = plain.answeredPlayerIds || [];
  const skippedPlayerIds = plain.skippedPlayerIds || [];
  const matchForTurn = { ...plain, players };
  const processedPlayerIds = Array.from(new Set([...answeredPlayerIds, ...skippedPlayerIds]));
  return {
    id: plain.id,
    scopeId: plain.scopeId,
    status: plain.status,
    pendingEvent: Boolean(plain.pendingEvent),
    turnCount: plain.turnCount || 0,
    roundNumber: plain.roundNumber || 1,
    answeredPlayerIds,
    skippedPlayerIds,
    roundProgress: {
      answered: answeredPlayerIds.length,
      skipped: skippedPlayerIds.length,
      processed: processedPlayerIds.length,
      total: players.length,
    },
    lastEvent: plain.lastEvent || null,
    turnOrder: getTurnOrderState(matchForTurn),
    players,
    log: plain.log,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
    leaderboard: sortPlayers(players),
  };
}

function createMemoryStore() {
  const matches = new Map();
  const usedByScope = new Map();

  function scopeSet(scopeId) {
    const normalized = normalizeScopeId(scopeId);
    if (!usedByScope.has(normalized)) {
      usedByScope.set(normalized, new Map());
    }
    return usedByScope.get(normalized);
  }

  async function create({ playerNames, scopeId }) {
    const match = {
      id: crypto.randomUUID(),
      scopeId: normalizeScopeId(scopeId),
      status: "playing",
      pendingEvent: false,
      turnCount: 0,
      roundNumber: 1,
      answeredPlayerIds: [],
      skippedPlayerIds: [],
      lastEvent: null,
      players: playerNames.map((name) => ({
        id: crypto.randomUUID(),
        name,
        score: 0,
        statusEffects: [],
      })),
      log: [],
      createdAt: now(),
      updatedAt: now(),
    };

    matches.set(match.id, match);
    return toPlainMatch(match);
  }

  async function get(matchId) {
    const match = matches.get(matchId);
    return match ? toPlainMatch(match) : null;
  }

  async function mutate(matchId, callback) {
    const match = matches.get(matchId);
    if (!match) {
      return { ok: false, status: 404, message: "Match not found" };
    }

    const result = await callback(match);
    if (result?.ok === false) {
      return result;
    }

    match.updatedAt = now();
    return { ok: true, match: toPlainMatch(match) };
  }

  async function adjustScore(matchId, { playerId, delta, reason }) {
    return mutate(matchId, (match) => {
      const player = match.players.find((item) => item.id === playerId);
      if (!player) {
        return { ok: false, status: 404, message: "Player not found" };
      }

      player.score += delta;
      match.log.unshift({
        id: crypto.randomUUID(),
        type: "score_adjusted",
        playerId,
        delta,
        reason,
        createdAt: now(),
      });
    });
  }

  async function recordAnswer(matchId, payload) {
    return mutate(matchId, (match) => {
      const turnCheck = validatePlayerTurn(match, payload.playerId);
      if (!turnCheck.ok) {
        return turnCheck;
      }

      const player = match.players.find((item) => item.id === payload.playerId);
      if (!player) {
        return { ok: false, status: 404, message: "Player not found" };
      }

      match.log.unshift({
        id: crypto.randomUUID(),
        type: "answer_submitted",
        ...payload,
        scoreChanges: [],
        createdAt: now(),
      });
      match.turnCount = (match.turnCount || 0) + 1;
      match.answeredPlayerIds = Array.from(new Set([...(match.answeredPlayerIds || []), payload.playerId]));
      updateRoundCompletion(match);

    });
  }

  async function skipTurn(matchId, { playerId, reason }) {
    return mutate(matchId, (match) => {
      const turnCheck = validatePlayerTurn(match, playerId);
      if (!turnCheck.ok) {
        return turnCheck;
      }

      match.skippedPlayerIds = Array.from(new Set([...(match.skippedPlayerIds || []), playerId]));
      updateRoundCompletion(match);
      match.log.unshift({
        id: crypto.randomUUID(),
        type: "turn_skipped",
        playerId,
        reason: reason || "manual_skip",
        createdAt: now(),
      });
    });
  }

  async function recordEvent(matchId, event) {
    return mutate(matchId, (match) => {
      const scoreChanges = applyEventScoreEffects(match, event);
      match.pendingEvent = false;
      match.roundNumber = (match.roundNumber || 1) + 1;
      match.answeredPlayerIds = [];
      match.skippedPlayerIds = [];
      match.lastEvent = { ...event, scoreChanges };
      match.log.unshift({
        id: crypto.randomUUID(),
        type: "event_drawn",
        event: { ...event, scoreChanges },
        scoreChanges,
        createdAt: now(),
      });
    });
  }

  async function applySkill(matchId, skill, payload) {
    return mutate(matchId, (match) => {
      const applied = applySkillScoreEffects(match, skill, payload);
      if (!applied.ok) {
        return applied;
      }

      match.log.unshift({
        id: crypto.randomUUID(),
        type: "skill_applied",
        playerId: payload.playerId,
        targetPlayerId: payload.targetPlayerId || null,
        skill,
        scoreChanges: applied.scoreChanges,
        note: payload.note || "",
        createdAt: now(),
      });
    });
  }

  async function markQuestionUsed(matchId, { cardCode, difficulty, playerId }) {
    const match = matches.get(matchId);
    if (!match) {
      return { ok: false, status: 404, message: "Match not found" };
    }

    if (playerId) {
      const turnCheck = validatePlayerTurn(match, playerId);
      if (!turnCheck.ok) {
        return turnCheck;
      }
    }

    const key = `${cardCode}:${difficulty}`;
    const used = scopeSet(match.scopeId);
    if (used.has(key)) {
      return { ok: false, status: 409, message: "Câu hỏi này đã được dùng trong đợt chơi hiện tại." };
    }

    used.set(key, {
      scopeId: match.scopeId,
      cardCode,
      difficulty,
      matchId,
      askedByPlayerId: playerId || null,
      askedAt: now(),
    });

    match.log.unshift({
      id: crypto.randomUUID(),
      type: "question_revealed",
      playerId: playerId || null,
      cardCode,
      difficulty,
      createdAt: now(),
    });
    match.updatedAt = now();

    return { ok: true, match: toPlainMatch(match) };
  }

  async function getUsedQuestions(scopeId) {
    return [...scopeSet(scopeId).values()];
  }

  async function isQuestionUsed(scopeId, cardCode, difficulty) {
    return scopeSet(scopeId).has(`${cardCode}:${difficulty}`);
  }

  async function getScopeIdForMatch(matchId) {
    const match = matches.get(matchId);
    return match?.scopeId || null;
  }

  return {
    mode: "memory",
    create,
    get,
    adjustScore,
    recordAnswer,
    skipTurn,
    recordEvent,
    applySkill,
    markQuestionUsed,
    getUsedQuestions,
    isQuestionUsed,
    getScopeIdForMatch,
  };
}

function createMongoStore(mongodbUri) {
  let connected = false;

  const matchSchema = new mongoose.Schema(
    {
      id: { type: String, unique: true, index: true, required: true },
      scopeId: { type: String, index: true, required: true },
      targetScore: { type: Number, default: 0 },
      status: { type: String, required: true },
      pendingEvent: { type: Boolean, default: false },
      turnCount: { type: Number, default: 0 },
      roundNumber: { type: Number, default: 1 },
      answeredPlayerIds: [{ type: String }],
      skippedPlayerIds: [{ type: String }],
      lastEvent: { type: mongoose.Schema.Types.Mixed, default: null },
      players: [
        {
          _id: false,
          id: String,
          name: String,
          score: Number,
          statusEffects: { type: [mongoose.Schema.Types.Mixed], default: [] },
        },
      ],
      log: [mongoose.Schema.Types.Mixed],
    },
    { timestamps: true, versionKey: false },
  );

  const usedQuestionSchema = new mongoose.Schema(
    {
      scopeId: { type: String, required: true, index: true },
      cardCode: { type: String, required: true },
      difficulty: { type: String, required: true, enum: ["easy", "medium", "hard"] },
      matchId: { type: String, required: true, index: true },
      askedByPlayerId: { type: String, default: null },
      askedAt: { type: Date, default: Date.now },
    },
    { timestamps: true, versionKey: false },
  );

  usedQuestionSchema.index({ scopeId: 1, cardCode: 1, difficulty: 1 }, { unique: true });

  const Match = mongoose.models.Match || mongoose.model("Match", matchSchema);
  const UsedQuestion =
    mongoose.models.UsedQuestion || mongoose.model("UsedQuestion", usedQuestionSchema);

  async function connect() {
    if (connected) return;
    await mongoose.connect(mongodbUri, {
      serverSelectionTimeoutMS: 5000,
    });
    connected = true;
  }

  async function create({ playerNames, scopeId }) {
    await connect();
    const match = await Match.create({
      id: crypto.randomUUID(),
      scopeId: normalizeScopeId(scopeId),
      status: "playing",
      pendingEvent: false,
      turnCount: 0,
      roundNumber: 1,
      answeredPlayerIds: [],
      skippedPlayerIds: [],
      lastEvent: null,
      players: playerNames.map((name) => ({
        id: crypto.randomUUID(),
        name,
        score: 0,
        statusEffects: [],
      })),
      log: [],
    });

    return toPlainMatch(match);
  }

  async function get(matchId) {
    await connect();
    const match = await Match.findOne({ id: matchId }).lean();
    return match ? toPlainMatch(match) : null;
  }

  async function adjustScore(matchId, { playerId, delta, reason }) {
    await connect();
    const match = await Match.findOne({ id: matchId });
    if (!match) {
      return { ok: false, status: 404, message: "Match not found" };
    }

    const player = match.players.find((item) => item.id === playerId);
    if (!player) {
      return { ok: false, status: 404, message: "Player not found" };
    }

    player.score += delta;
    match.log.unshift({
      id: crypto.randomUUID(),
      type: "score_adjusted",
      playerId,
      delta,
      reason,
      createdAt: now(),
    });
    await match.save();

    return { ok: true, match: toPlainMatch(match) };
  }

  async function recordAnswer(matchId, payload) {
    await connect();
    const match = await Match.findOne({ id: matchId });
    if (!match) {
      return { ok: false, status: 404, message: "Match not found" };
    }

    const turnCheck = validatePlayerTurn(match, payload.playerId);
    if (!turnCheck.ok) {
      return turnCheck;
    }

    const player = match.players.find((item) => item.id === payload.playerId);
    if (!player) {
      return { ok: false, status: 404, message: "Player not found" };
    }

    match.log.unshift({
      id: crypto.randomUUID(),
      type: "answer_submitted",
      ...payload,
      scoreChanges: [],
      createdAt: now(),
    });
    match.turnCount = (match.turnCount || 0) + 1;
    match.answeredPlayerIds = Array.from(new Set([...(match.answeredPlayerIds || []), payload.playerId]));
    updateRoundCompletion(match);

    await match.save();
    return { ok: true, match: toPlainMatch(match) };
  }

  async function skipTurn(matchId, { playerId, reason }) {
    await connect();
    const match = await Match.findOne({ id: matchId });
    if (!match) {
      return { ok: false, status: 404, message: "Match not found" };
    }

    if (playerId) {
      const turnCheck = validatePlayerTurn(match, playerId);
      if (!turnCheck.ok) {
        return turnCheck;
      }
    }

    match.skippedPlayerIds = Array.from(new Set([...(match.skippedPlayerIds || []), playerId]));
    updateRoundCompletion(match);
    match.log.unshift({
      id: crypto.randomUUID(),
      type: "turn_skipped",
      playerId,
      reason: reason || "manual_skip",
      createdAt: now(),
    });

    await match.save();
    return { ok: true, match: toPlainMatch(match) };
  }

  async function recordEvent(matchId, event) {
    await connect();
    const match = await Match.findOne({ id: matchId });
    if (!match) {
      return { ok: false, status: 404, message: "Match not found" };
    }

    const scoreChanges = applyEventScoreEffects(match, event);
    match.pendingEvent = false;
    match.roundNumber = (match.roundNumber || 1) + 1;
    match.answeredPlayerIds = [];
    match.skippedPlayerIds = [];
    match.lastEvent = { ...event, scoreChanges };
    match.log.unshift({
      id: crypto.randomUUID(),
      type: "event_drawn",
      event: { ...event, scoreChanges },
      scoreChanges,
      createdAt: now(),
    });

    await match.save();
    return { ok: true, match: toPlainMatch(match) };
  }

  async function applySkill(matchId, skill, payload) {
    await connect();
    const match = await Match.findOne({ id: matchId });
    if (!match) {
      return { ok: false, status: 404, message: "Match not found" };
    }

    const applied = applySkillScoreEffects(match, skill, payload);
    if (!applied.ok) {
      return applied;
    }

    match.log.unshift({
      id: crypto.randomUUID(),
      type: "skill_applied",
      playerId: payload.playerId,
      targetPlayerId: payload.targetPlayerId || null,
      skill,
      scoreChanges: applied.scoreChanges,
      note: payload.note || "",
      createdAt: now(),
    });

    await match.save();
    return { ok: true, match: toPlainMatch(match), scoreChanges: applied.scoreChanges };
  }

  async function markQuestionUsed(matchId, { cardCode, difficulty, playerId }) {
    await connect();
    const match = await Match.findOne({ id: matchId });
    if (!match) {
      return { ok: false, status: 404, message: "Match not found" };
    }

    if (playerId) {
      const turnCheck = validatePlayerTurn(match, playerId);
      if (!turnCheck.ok) {
        return turnCheck;
      }
    }

    try {
      await UsedQuestion.create({
        scopeId: match.scopeId,
        cardCode,
        difficulty,
        matchId,
        askedByPlayerId: playerId || null,
      });
    } catch (error) {
      if (error?.code === 11000) {
        return { ok: false, status: 409, message: "Câu hỏi này đã được dùng trong đợt chơi hiện tại." };
      }
      throw error;
    }

    match.log.unshift({
      id: crypto.randomUUID(),
      type: "question_revealed",
      playerId: playerId || null,
      cardCode,
      difficulty,
      createdAt: now(),
    });
    await match.save();

    return { ok: true, match: toPlainMatch(match) };
  }

  async function getUsedQuestions(scopeId) {
    await connect();
    return UsedQuestion.find({ scopeId: normalizeScopeId(scopeId) }).lean();
  }

  async function isQuestionUsed(scopeId, cardCode, difficulty) {
    await connect();
    return Boolean(await UsedQuestion.exists({ scopeId: normalizeScopeId(scopeId), cardCode, difficulty }));
  }

  async function getScopeIdForMatch(matchId) {
    await connect();
    const match = await Match.findOne({ id: matchId }, { scopeId: 1 }).lean();
    return match?.scopeId || null;
  }

  return {
    mode: "mongo",
    create,
    get,
    adjustScore,
    recordAnswer,
    skipTurn,
    recordEvent,
    applySkill,
    markQuestionUsed,
    getUsedQuestions,
    isQuestionUsed,
    getScopeIdForMatch,
  };
}

function createMatchStore() {
  const mongodbUri = process.env.MONGODB_URI;
  if (mongodbUri) {
    return createMongoStore(mongodbUri);
  }

  return createMemoryStore();
}

module.exports = {
  DEFAULT_SCOPE_ID,
  createMatchStore,
  normalizeScopeId,
};
