import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BadgeCheck,
  BookOpen,
  Check,
  CircleHelp,
  ClipboardList,
  Loader2,
  Minus,
  Monitor,
  Play,
  Plus,
  RefreshCcw,
  Search,
  Shuffle,
  Swords,
  Trophy,
  UserCircle,
  Users,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import "./App.css";

const API_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL || "http://localhost:4000");
const WS_BASE_URL = getWebSocketBaseUrl();

const difficultyMeta = {
  easy: { label: "Dễ", tone: "green", fallbackSeconds: 30 },
  medium: { label: "Trung bình", tone: "amber", fallbackSeconds: 45 },
  hard: { label: "Khó", tone: "red", fallbackSeconds: 60 },
};

const timerPresets = [15, 30, 45, 60, 90];
const EVENT_SPIN_DURATION_MS = 5000;

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function getWebSocketBaseUrl() {
  if (import.meta.env.VITE_WS_BASE_URL) return normalizeBaseUrl(import.meta.env.VITE_WS_BASE_URL);

  try {
    const url = new URL(API_BASE_URL);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return normalizeBaseUrl(url.origin);
  } catch {
    return "ws://localhost:4000";
  }
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || "API request failed");
  return body.data ?? body;
}

function normalizeCardCode(value) {
  const raw = value.trim().toUpperCase();
  if (/^\d+$/.test(raw)) return `TH${String(Number(raw)).padStart(2, "0")}`;
  const match = raw.match(/^TH\s*0*(\d+)$/);
  return match ? `TH${String(Number(match[1])).padStart(2, "0")}` : raw;
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function App() {
  const [apiStatus, setApiStatus] = useState("checking");
  const [cards, setCards] = useState([]);
  const [events, setEvents] = useState([]);
  const [match, setMatch] = useState(null);
  const [playerNamesText, setPlayerNamesText] = useState("An\nBình\nChi");
  const [scopeId, setScopeId] = useState("MLN111-2026");
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [cardCode, setCardCode] = useState("TH01");
  const [currentCard, setCurrentCard] = useState(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState("easy");
  const [revealedQuestion, setRevealedQuestion] = useState(null);
  const [questionPlayerId, setQuestionPlayerId] = useState("");
  const [questionModalOpen, setQuestionModalOpen] = useState(false);
  const [selectedOptionLabel, setSelectedOptionLabel] = useState("");
  const [answerLocked, setAnswerLocked] = useState(false);
  const [questionMode, setQuestionMode] = useState("turn");
  const [displayQuestion, setDisplayQuestion] = useState(null);
  const [displayAnswer, setDisplayAnswer] = useState(null);
  const [displayAnswerStatus, setDisplayAnswerStatus] = useState(null);
  const [displayPickedOption, setDisplayPickedOption] = useState("");
  const [quickScoreDeltas, setQuickScoreDeltas] = useState({});
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [timerOverrideSeconds, setTimerOverrideSeconds] = useState("");
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerStatus, setTimerStatus] = useState("idle");
  const [result, setResult] = useState(null);
  const [currentEvent, setCurrentEvent] = useState(null);
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [scoreModalOpen, setScoreModalOpen] = useState(false);
  const [eventSpinning, setEventSpinning] = useState(false);
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const audioContextRef = useRef(null);
  const lotteryAudioRef = useRef(null);
  const displaySocketRef = useRef(null);
  const pendingDisplayMessageRef = useRef(null);

  useEffect(() => {
    async function bootstrap() {
      try {
        await api("/health");
        setApiStatus("online");
        const [cardList, eventList] = await Promise.all([api("/api/cards"), api("/api/events")]);
        setCards(Array.isArray(cardList) ? cardList : []);
        setEvents(Array.isArray(eventList) ? eventList : []);
      } catch (err) {
        setApiStatus("offline");
        setError(`Không kết nối được backend tại ${API_BASE_URL}. ${err.message}`);
      }
    }
    bootstrap();
  }, []);

  const selectedQuestionMeta = useMemo(
    () => currentCard?.questions?.find((question) => question.difficulty === selectedDifficulty) || null,
    [currentCard, selectedDifficulty],
  );
  const selectedQuestion = revealedQuestion;
  const isFreeQuestion = questionMode === "free";
  const leaderboard = match?.leaderboard || match?.players || [];
  const roundProgress = useMemo(
    () => match?.roundProgress || { answered: 0, total: match?.players?.length || 0 },
    [match?.players?.length, match?.roundProgress],
  );
  const turnOrder = match?.turnOrder || { currentPlayerId: null, order: [] };
  const selectedTurnPlayer = match?.players?.find((player) => player.id === selectedPlayerId) || null;
  const selectedTurnState = turnOrder.order.find((player) => player.id === selectedPlayerId) || null;
  const currentTurnPlayer = selectedTurnPlayer || match?.players?.find((player) => player.id === turnOrder.currentPlayerId) || null;
  const activePlayerId = selectedPlayerId || turnOrder.currentPlayerId;
  const activePlayer = currentTurnPlayer || match?.players?.find((player) => player.id === activePlayerId);
  const questionPlayer = match?.players?.find((player) => player.id === questionPlayerId) || currentTurnPlayer;
  const scoringPlayerId = result?.playerId || questionPlayerId;
  const scoringPlayer = match?.players?.find((player) => player.id === scoringPlayerId) || null;
  const eventWheelItems = useMemo(() => (events.length > 0 ? events : currentEvent ? [currentEvent] : []), [currentEvent, events]);
  const changedScoreByPlayer = new Map((currentEvent?.scoreChanges || []).map((change) => [change.playerId, change]));
  const isTimerRunning = timerStatus === "running";
  const isTimeExpired = timerStatus === "expired";
  const answerIsRevealed = result?.revealed || result?.mode === "free";
  const displayUrl = match ? `/display/${encodeURIComponent(match.id)}` : "";
  const publicDisplayState = useMemo(() => {
    if (!match) return null;

    const publicQuestion = displayQuestion
      ? {
          ...displayQuestion,
          pickedOption: displayPickedOption,
          answerStatus: displayAnswerStatus,
        }
      : null;

    const publicAnswer = displayAnswer;
    const publicEvent = currentEvent || null;

    return {
      screen: eventModalOpen
        ? "event"
        : scoreModalOpen
          ? "scoreboard"
          : displayQuestion
            ? "question"
            : "idle",
      scopeId: match.scopeId,
      roundNumber: match.roundNumber || 1,
      roundProgress,
      pendingEvent: Boolean(match.pendingEvent),
      leaderboard: (match.leaderboard || match.players || []).map((player) => ({
        id: player.id,
        name: player.name,
        score: player.score,
      })),
      question: publicQuestion,
      answer: publicAnswer,
      timer: {
        seconds: timerSeconds,
        status: timerStatus,
      },
      event: eventModalOpen
        ? {
            spinning: eventSpinning,
            event: eventSpinning ? null : currentEvent,
            items: eventWheelItems.map((event) => ({
              code: event.code,
              title: event.title,
            })),
          }
        : publicEvent
          ? {
              spinning: false,
              event: publicEvent,
              items: eventWheelItems.map((event) => ({
                code: event.code,
                title: event.title,
              })),
            }
          : null,
    };
  }, [
    currentEvent,
    displayAnswer,
    displayAnswerStatus,
    displayPickedOption,
    displayQuestion,
    eventModalOpen,
    eventSpinning,
    eventWheelItems,
    match,
    roundProgress,
    scoreModalOpen,
    timerSeconds,
    timerStatus,
  ]);

  useEffect(() => {
    if (!match?.id || typeof WebSocket === "undefined") return undefined;

    let reconnectTimeoutId = null;
    let closed = false;

    function connect() {
      const socket = new WebSocket(`${WS_BASE_URL}/ws/display`);
      displaySocketRef.current = socket;

      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "display:subscribe", matchId: match.id }));
        if (pendingDisplayMessageRef.current) {
          socket.send(pendingDisplayMessageRef.current);
          pendingDisplayMessageRef.current = null;
        }
      });

      socket.addEventListener("close", () => {
        if (!closed) {
          reconnectTimeoutId = window.setTimeout(connect, 1500);
        }
      });

      socket.addEventListener("error", () => {
        socket.close();
      });
    }

    connect();

    return () => {
      closed = true;
      if (reconnectTimeoutId) window.clearTimeout(reconnectTimeoutId);
      displaySocketRef.current?.close();
      displaySocketRef.current = null;
    };
  }, [match?.id]);

  useEffect(() => {
    if (!match?.id || !publicDisplayState) return;

    const message = JSON.stringify({
      type: "display:update",
      matchId: match.id,
      state: publicDisplayState,
    });
    pendingDisplayMessageRef.current = message;

    if (displaySocketRef.current?.readyState === WebSocket.OPEN) {
      displaySocketRef.current.send(message);
      pendingDisplayMessageRef.current = null;
    }
  }, [match?.id, publicDisplayState]);

  function getTimerOverride() {
    const value = Number(timerOverrideSeconds);
    return Number.isFinite(value) && value >= 5 ? Math.trunc(value) : null;
  }

  function getQuestionDuration(question) {
    return getTimerOverride() || question?.timeLimitSeconds || difficultyMeta[question?.difficulty]?.fallbackSeconds || 45;
  }

  function showQuestionOnDisplay({ card, question, mode, playerName }) {
    setDisplayQuestion({
      cardCode: card?.code || "",
      cardTitle: card?.title || "",
      situation: card?.situation || "",
      difficulty: question.difficulty,
      label: question.label,
      points: question.points,
      type: question.type,
      text: question.text,
      options: question.options || [],
      mode,
      playerName,
    });
    setDisplayAnswer(null);
    setDisplayPickedOption("");
    setDisplayAnswerStatus({ phase: "waiting", label: "Chờ chọn đáp án" });
  }

  function clearDisplayQuestion() {
    setDisplayQuestion(null);
    setDisplayAnswer(null);
    setDisplayAnswerStatus(null);
    setDisplayPickedOption("");
  }

  function getNextOpenPlayerId(nextMatch, exceptPlayerId = "") {
    const processed = new Set([...(nextMatch?.answeredPlayerIds || []), ...(nextMatch?.skippedPlayerIds || [])]);
    return nextMatch?.players?.find((player) => player.id !== exceptPlayerId && !processed.has(player.id))?.id || "";
  }

  async function runAction(name, action) {
    setLoading(name);
    setError("");
    try {
      return await action();
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setLoading("");
    }
  }

  async function refreshCards(matchId = match?.id) {
    const query = matchId ? `?matchId=${encodeURIComponent(matchId)}` : "";
    const list = await api(`/api/cards${query}`);
    setCards(Array.isArray(list) ? list : []);
  }

  function clearTimer() {
    setTimerSeconds(0);
    setTimerStatus("idle");
  }

  function stopTimer() {
    if (timerStatus === "running") setTimerStatus("stopped");
  }

  const getAudioContext = useCallback(() => {
    if (!soundEnabled) return null;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioContextRef.current) audioContextRef.current = new AudioContextClass();
    if (audioContextRef.current.state === "suspended") audioContextRef.current.resume();
    return audioContextRef.current;
  }, [soundEnabled]);

  const playTone = useCallback((frequency, duration = 0.12, type = "sine", volume = 0.08, delay = 0) => {
    const context = getAudioContext();
    if (!context) return;

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startAt = context.currentTime + delay;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.03);
  }, [getAudioContext]);

  const playStartSound = useCallback(() => {
    playTone(392, 0.1, "triangle", 0.08, 0);
    playTone(523, 0.14, "triangle", 0.08, 0.11);
    playTone(784, 0.16, "triangle", 0.08, 0.24);
  }, [playTone]);

  const playTickSound = useCallback(() => {
    playTone(880, 0.055, "square", 0.035);
  }, [playTone]);

  const playEndSound = useCallback(() => {
    playTone(220, 0.16, "sawtooth", 0.08, 0);
    playTone(165, 0.2, "sawtooth", 0.08, 0.18);
  }, [playTone]);

  const playLotteryLoop = useCallback(() => {
    playTone(523, 0.055, "square", 0.035, 0);
    playTone(659, 0.055, "square", 0.03, 0.11);
    playTone(784, 0.055, "square", 0.03, 0.22);
    playTone(1046, 0.07, "triangle", 0.035, 0.36);
  }, [playTone]);

  const stopLotteryMusic = useCallback(() => {
    const audio = lotteryAudioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  }, []);

  const playLotteryMusic = useCallback(async () => {
    if (!soundEnabled) return false;
    if (!lotteryAudioRef.current) {
      const audio = new Audio("/audio/xoso-mien-bac.mp3");
      audio.loop = true;
      audio.volume = 0.72;
      lotteryAudioRef.current = audio;
    }

    try {
      lotteryAudioRef.current.currentTime = 0;
      await lotteryAudioRef.current.play();
      return true;
    } catch {
      stopLotteryMusic();
      return false;
    }
  }, [soundEnabled, stopLotteryMusic]);

  useEffect(() => {
    if (!selectedQuestion || !isTimerRunning) return undefined;
    const intervalId = window.setInterval(() => {
      setTimerSeconds((current) => {
        if (current <= 1) {
          window.clearInterval(intervalId);
          setTimerStatus("expired");
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [isTimerRunning, selectedQuestion]);

  useEffect(() => {
    if (questionModalOpen && isTimerRunning && timerSeconds > 0 && timerSeconds <= 10) {
      playTickSound();
    }
  }, [isTimerRunning, playTickSound, questionModalOpen, timerSeconds]);

  useEffect(() => {
    if (!questionModalOpen || !isTimerRunning || isTimeExpired) return undefined;
    playLotteryLoop();
    const intervalId = window.setInterval(playLotteryLoop, 720);
    return () => window.clearInterval(intervalId);
  }, [isTimeExpired, isTimerRunning, playLotteryLoop, questionModalOpen]);

  useEffect(() => {
    if (!questionModalOpen || !isTimeExpired) return undefined;
    playEndSound();
    const timeoutId = window.setTimeout(() => setQuestionModalOpen(false), 1600);
    return () => window.clearTimeout(timeoutId);
  }, [isTimeExpired, playEndSound, questionModalOpen]);

  useEffect(() => {
    if (!eventModalOpen || !eventSpinning) return undefined;
    let intervalId = null;
    let cancelled = false;

    playLotteryMusic().then((usingAudioFile) => {
      if (cancelled || usingAudioFile) return;
      playLotteryLoop();
      intervalId = window.setInterval(playLotteryLoop, 520);
    });

    return () => {
      cancelled = true;
      stopLotteryMusic();
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [eventModalOpen, eventSpinning, playLotteryLoop, playLotteryMusic, stopLotteryMusic]);

  useEffect(() => {
    if (!eventModalOpen || eventSpinning || !currentEvent) return;
    stopLotteryMusic();
    playEndSound();
  }, [currentEvent, eventModalOpen, eventSpinning, playEndSound, stopLotteryMusic]);

  async function createMatch(event) {
    event.preventDefault();
    const playerNames = playerNamesText
      .split(/\r?\n|,/)
      .map((name) => name.trim())
      .filter(Boolean);
    if (!playerNames.length) {
      setError("Cần ít nhất 1 người chơi.");
      return;
    }

    await runAction("create-match", async () => {
      const created = await api("/api/matches", {
        method: "POST",
        body: JSON.stringify({ playerNames, scopeId }),
      });
      setMatch(created);
      setSelectedPlayerId(created.turnOrder?.currentPlayerId || created.players[0]?.id || "");
      setCurrentCard(null);
      setRevealedQuestion(null);
      setQuestionPlayerId("");
      setQuestionModalOpen(false);
      setSelectedOptionLabel("");
      setAnswerLocked(false);
      setQuestionMode("turn");
      setCurrentEvent(null);
      setResult(null);
      clearDisplayQuestion();
      clearTimer();
      await refreshCards(created.id);
    });
  }

  async function loadCard(event, forcedCode) {
    event?.preventDefault();
    const code = normalizeCardCode(forcedCode || cardCode);
    if (!code) return;
    if (!match) {
      setError("Hãy tạo trận trước để hệ thống biết mã lớp/đợt chơi.");
      return;
    }

    await runAction("load-card", async () => {
      const card = await api(`/api/cards/${code}?matchId=${encodeURIComponent(match.id)}&hideUsed=true`);
      setCurrentCard(card);
      setCardCode(card.code);
      setSelectedDifficulty(card.questions[0]?.difficulty || "");
      setRevealedQuestion(null);
      setQuestionPlayerId("");
      setQuestionModalOpen(false);
      setSelectedOptionLabel("");
      setAnswerLocked(false);
      setQuestionMode("turn");
      setResult(null);
      clearTimer();
    });
  }

  async function revealQuestion() {
    if (!match || !currentCard || !selectedDifficulty) return;
    if (!selectedPlayerId) {
      setError("Hãy chọn người đang trả lời.");
      return;
    }
    if (selectedTurnState?.processed) {
      setError("Người chơi này đã được xử lý trong vòng hiện tại.");
      return;
    }
    if (match.pendingEvent) {
      setError("Vòng này đã đủ lượt. Hãy quay biến cố trước khi mở câu hỏi tiếp theo.");
      return;
    }
    await runAction("reveal-question", async () => {
      const payload = await api(`/api/matches/${match.id}/questions/reveal`, {
        method: "POST",
        body: JSON.stringify({
          playerId: selectedPlayerId,
          cardCode: currentCard.code,
          difficulty: selectedDifficulty,
        }),
      });
      setMatch(payload.match);
      setRevealedQuestion(payload.question);
      setQuestionPlayerId(selectedPlayerId);
      setQuestionMode("turn");
      setSelectedOptionLabel("");
      setAnswerLocked(false);
      setTimerSeconds(getQuestionDuration(payload.question));
      setTimerStatus("running");
      setQuestionModalOpen(true);
      playStartSound();
      setResult(null);
      showQuestionOnDisplay({
        card: currentCard,
        question: payload.question,
        mode: "turn",
        playerName: selectedTurnPlayer?.name || currentTurnPlayer?.name || "",
      });
      await refreshCards(payload.match.id);
    });
  }

  async function revealFreeQuestion() {
    if (!match || !currentCard || !selectedDifficulty) return;

    await runAction("free-question", async () => {
      const payload = await api(`/api/matches/${match.id}/questions/reveal?includeAnswers=true`, {
        method: "POST",
        body: JSON.stringify({
          cardCode: currentCard.code,
          difficulty: selectedDifficulty,
        }),
      });
      setMatch(payload.match);
      setRevealedQuestion(payload.question);
      setQuestionPlayerId("");
      setQuestionMode("free");
      setSelectedOptionLabel("");
      setAnswerLocked(false);
      setResult(null);
      setTimerSeconds(getQuestionDuration(payload.question));
      setTimerStatus("running");
      setQuestionModalOpen(true);
      playStartSound();
      showQuestionOnDisplay({
        card: currentCard,
        question: payload.question,
        mode: "free",
        playerName: "Câu hỏi phụ",
      });
      const updatedCard = await api(`/api/cards/${currentCard.code}?matchId=${encodeURIComponent(payload.match.id)}&hideUsed=true`);
      setCurrentCard(updatedCard);
      setSelectedDifficulty(updatedCard.questions[0]?.difficulty || selectedDifficulty);
      await refreshCards(payload.match.id);
    });
  }

  function revealFreeAnswer() {
    if (!selectedQuestion) return;

    const correctOption = selectedQuestion.correctOption || null;
    setAnswerLocked(true);
    setResult({
      mode: "free",
      correct: selectedOptionLabel && correctOption ? selectedOptionLabel === correctOption : null,
      correctOption,
      expectedAnswer:
        selectedQuestion.answer ||
        selectedQuestion.explanation ||
        selectedQuestion.suggestedAnswer ||
        selectedQuestion.gradingGuide ||
        "",
      points: 0,
      questionPoints: selectedQuestion.points,
      timerExpired: isTimeExpired,
    });
    setDisplayPickedOption(selectedOptionLabel || "");
    setDisplayAnswer({
      correctOption,
      expectedAnswer:
        selectedQuestion.answer ||
        selectedQuestion.explanation ||
        selectedQuestion.suggestedAnswer ||
        selectedQuestion.gradingGuide ||
        "",
      explanation: selectedQuestion.explanation || "",
    });
    setDisplayAnswerStatus({ phase: "revealed", label: "Đáp án đã hiển thị" });
    stopTimer();
  }

  async function submitLockedAnswer({ reveal = false } = {}) {
    if (!match || !selectedQuestion || !questionPlayerId) return;
    if (!selectedOptionLabel) {
      setError("Hãy chọn một đáp án A/B/C/D trước khi chấm.");
      return;
    }
    if (!answerLocked) {
      setError("Hãy chốt đáp án trước khi chấm.");
      return;
    }

    const gradedPlayerId = questionPlayerId;
    const gradedPlayerName = questionPlayer?.name || "Người chơi";
    await runAction("reveal-answer", async () => {
      const payload = await api(`/api/matches/${match.id}/answers`, {
        method: "POST",
        body: JSON.stringify({
          playerId: gradedPlayerId,
          cardCode: currentCard.code,
          difficulty: selectedDifficulty,
          answer: selectedOptionLabel,
        }),
      });
      const gradedPlayer = payload.match.players.find((player) => player.id === gradedPlayerId);
      const nextResult = {
        ...payload.grading,
        correctOption: reveal ? payload.grading.correctOption : null,
        expectedAnswer: reveal ? payload.grading.expectedAnswer : null,
        explanation: reveal ? payload.grading.explanation : null,
        revealed: reveal,
        playerId: gradedPlayerId,
        playerName: gradedPlayerName,
        playerScore: gradedPlayer?.score ?? 0,
        questionPoints: selectedQuestion.points,
      };
      setMatch(payload.match);
      setResult(nextResult);
      setDisplayPickedOption(selectedOptionLabel);
      if (reveal) {
        setDisplayAnswer({
          correctOption: payload.grading.correctOption || "",
          expectedAnswer: payload.grading.expectedAnswer || "",
          explanation: payload.grading.explanation || "",
        });
        setDisplayAnswerStatus({ phase: "revealed", label: "Đáp án đã hiển thị" });
      } else if (payload.grading.correct === true) {
        setDisplayAnswer(null);
        setDisplayAnswerStatus({ phase: "correct", label: "Đúng - GM nhập điểm" });
      } else {
        setDisplayAnswer(null);
        setDisplayAnswerStatus({ phase: "review", label: "GM xử lý đáp án" });
      }
      stopTimer();
      setSelectedPlayerId(getNextOpenPlayerId(payload.match, gradedPlayerId));
      if (reveal) {
        const updatedCard = await api(`/api/cards/${currentCard.code}?matchId=${encodeURIComponent(payload.match.id)}&hideUsed=true`);
        setCurrentCard(updatedCard);
        setSelectedDifficulty(updatedCard.questions[0]?.difficulty || selectedDifficulty);
        setQuestionModalOpen(true);
      } else {
        setQuestionModalOpen(false);
        const updatedCard = await api(`/api/cards/${currentCard.code}?matchId=${encodeURIComponent(payload.match.id)}&hideUsed=true`);
        setCurrentCard(updatedCard);
        setSelectedDifficulty(updatedCard.questions[0]?.difficulty || "");
        setRevealedQuestion(null);
        setQuestionPlayerId("");
        setAnswerLocked(false);
        setQuestionMode("turn");
      }
      await refreshCards(payload.match.id);
    });
  }

  async function checkLockedAnswer() {
    if (isFreeQuestion) {
      revealFreeAnswer();
      return;
    }

    if (!match || !selectedQuestion || !questionPlayerId) return;
    if (!selectedOptionLabel) {
      setError("Hãy chọn một đáp án A/B/C/D trước khi chấm.");
      return;
    }
    if (!answerLocked) {
      setError("Hãy chốt đáp án trước khi chấm.");
      return;
    }

    await runAction("check-answer", async () => {
      const checked = await api("/api/answers/check", {
        method: "POST",
        body: JSON.stringify({
          cardCode: currentCard.code,
          difficulty: selectedDifficulty,
          answer: selectedOptionLabel,
        }),
      });

      if (checked.correct === true) {
        await submitLockedAnswer({ reveal: false });
        return;
      }

      setResult({
        ...checked,
        mode: "checked",
        correctOption: null,
        expectedAnswer: null,
        explanation: null,
        revealed: false,
        playerId: questionPlayerId,
        playerName: questionPlayer?.name || "Người chơi",
        playerScore: questionPlayer?.score ?? 0,
        questionPoints: selectedQuestion.points,
      });
      setDisplayPickedOption(selectedOptionLabel);
      setDisplayAnswer(null);
      setDisplayAnswerStatus({ phase: "retry", label: "Sai - có thể chọn lại" });
    });
  }

  function retryAnswer() {
    setResult(null);
    setSelectedOptionLabel("");
    setAnswerLocked(false);
    setDisplayPickedOption("");
    setDisplayAnswer(null);
    setDisplayAnswerStatus({ phase: "waiting", label: "Chờ chọn đáp án" });
    setError("");
  }

  function closeQuestionModal() {
    setQuestionModalOpen(false);
    if (result?.revealed && !isFreeQuestion) {
      setRevealedQuestion(null);
      setQuestionPlayerId("");
      setAnswerLocked(false);
      setQuestionMode("turn");
    }
  }

  function lockAnswer() {
    if (!selectedOptionLabel) {
      setError("Hãy chọn một đáp án A/B/C/D trước khi chốt.");
      return;
    }
    setError("");
    setAnswerLocked(true);
    setDisplayPickedOption(selectedOptionLabel);
    setDisplayAnswerStatus({ phase: "locked", label: `Đã chốt ${selectedOptionLabel}` });
  }

  async function adjustPlayerScore(playerId, delta) {
    if (!match || !playerId) {
      setError("Hãy tạo trận trước khi chỉnh điểm.");
      return;
    }

    await runAction(`score-${playerId}-${delta}`, async () => {
      const payload = await api(`/api/matches/${match.id}/score`, {
        method: "POST",
        body: JSON.stringify({
          playerId,
          delta,
          reason: "quick_score",
        }),
      });
      setMatch(payload);
    });
  }

  async function applyQuickScoreDelta(playerId) {
    const delta = Number(quickScoreDeltas[playerId]);
    if (!Number.isFinite(delta) || delta === 0) {
      setError("Hãy nhập số điểm khác 0.");
      return;
    }

    await adjustPlayerScore(playerId, Math.trunc(delta));
    setQuickScoreDeltas((current) => ({ ...current, [playerId]: "" }));
  }

  async function skipSelectedTurn() {
    if (!match || !selectedPlayerId) {
      setError("Hãy chọn người chơi cần bỏ qua lượt.");
      return;
    }
    if (selectedTurnState?.processed) {
      setError("Người chơi này đã được xử lý trong vòng hiện tại.");
      return;
    }

    await runAction(`skip-${selectedPlayerId}`, async () => {
      const payload = await api(`/api/matches/${match.id}/turns/skip`, {
        method: "POST",
        body: JSON.stringify({
          playerId: selectedPlayerId,
          reason: "manual_skip",
        }),
      });
      setMatch(payload);
      setSelectedPlayerId(getNextOpenPlayerId(payload, selectedPlayerId));
      setResult(null);
      setRevealedQuestion(null);
      setQuestionPlayerId("");
      setQuestionModalOpen(false);
      setSelectedOptionLabel("");
      setAnswerLocked(false);
      setQuestionMode("turn");
      clearTimer();
    });
  }

  async function drawRandomEvent() {
    if (!match?.pendingEvent) {
      setError("Cần hoàn thành một lượt trước khi quay biến cố.");
      return;
    }

    setCurrentEvent(null);
    setEventModalOpen(true);
    setScoreModalOpen(false);
    setEventSpinning(true);
    setError("");
    try {
      await new Promise((resolve) => window.setTimeout(resolve, EVENT_SPIN_DURATION_MS));
      const payload = await api(`/api/matches/${match.id}/events/random`, { method: "POST" });
      setMatch(payload.match);
      setCurrentEvent(payload.event);
    } catch (err) {
      setError(err.message);
      setEventModalOpen(false);
    } finally {
      setEventSpinning(false);
    }
  }

  function resetTurn() {
    setResult(null);
    setRevealedQuestion(null);
    setQuestionPlayerId("");
    setQuestionModalOpen(false);
    setSelectedOptionLabel("");
    setAnswerLocked(false);
    setQuestionMode("turn");
    setCurrentEvent(null);
    clearDisplayQuestion();
    clearTimer();
  }

  if (!match) {
    return (
      <main className="setup-shell">
        <div className="setup-top">
          <div className="brand-lockup">
            <div className="brand-icon">
              <Swords size={28} />
            </div>
            <div>
              <p>TRIẾT CHIẾN</p>
              <h1>Khởi tạo đấu trường</h1>
            </div>
          </div>
          <div className={`api-pill ${apiStatus}`}>
            <span />
            {apiStatus === "online" ? "Backend Online" : apiStatus === "offline" ? "Backend Offline" : "Đang kiểm tra"}
          </div>
        </div>

        {error && (
          <div className="notice error" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <section className="setup-stage">
          <form className="setup-card" onSubmit={createMatch}>
            <div className="section-title">
              <Users size={20} />
              <h2>Tạo trận mới</h2>
            </div>
            <label>
              Danh sách người chơi
              <textarea value={playerNamesText} onChange={(event) => setPlayerNamesText(event.target.value)} rows={6} />
            </label>
            <div className="setup-grid">
              <label>
                Mã trận / lớp
                <input value={scopeId} onChange={(event) => setScopeId(event.target.value)} />
              </label>
            </div>
            <button type="submit" className="primary-action" disabled={loading === "create-match"}>
              {loading === "create-match" ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
              Vào màn chơi
            </button>
          </form>

          <div className="setup-brief">
            <span>Game Master Console</span>
            <h2>Luồng chơi đã tách gọn</h2>
            <p>Tạo trận một lần, sau đó chuyển sang màn điều phối chính với câu hỏi, timer, chấm điểm nhanh và biến cố.</p>
            <div className="brief-stats">
              <strong>{cards.length || 40}</strong>
              <small>lá tình huống</small>
              <strong>±1</strong>
              <small>điểm nhanh</small>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="game-shell">
      <header className="game-topbar">
        <div className="game-brand">TRIẾT CHIẾN</div>
        <div className="match-meta">
          <span>Mã trận: {match.scopeId}</span>
          <span>
            Vòng {match.roundNumber || 1}: {roundProgress.processed ?? roundProgress.answered}/{roundProgress.total} đã xử lý
          </span>
          {match.pendingEvent && <strong>Đủ lượt - quay biến cố</strong>}
        </div>
        <div className={`api-pill ${apiStatus}`}>
          <span />
          {apiStatus === "online" ? "Backend Online" : "Backend Offline"}
        </div>
        <div className="top-icons">
          <div className="header-event-control">
            <Shuffle size={18} />
            <div>
              <span>Biến cố</span>
              <strong>
                {eventSpinning
                  ? "Đang quay..."
                  : currentEvent || match.lastEvent
                    ? `${(currentEvent || match.lastEvent).code} - ${(currentEvent || match.lastEvent).title}`
                    : match.pendingEvent
                      ? "Đủ lượt"
                      : "Chưa đủ lượt"}
              </strong>
            </div>
            <button type="button" onClick={drawRandomEvent} disabled={!match.pendingEvent || eventSpinning}>
              {eventSpinning ? <Loader2 className="spin" size={16} /> : <Shuffle size={16} />}
              Quay
            </button>
          </div>
          <button type="button" className="ghost-action top-scoreboard-button" onClick={() => setScoreModalOpen(true)}>
            <Trophy size={18} />
            Bảng điểm
          </button>
          {displayUrl && (
            <a className="ghost-action top-scoreboard-button" href={displayUrl} target="_blank" rel="noreferrer">
              <Monitor size={18} />
              Màn hình
            </a>
          )}
          <strong>GAME MASTER</strong>
          <UserCircle size={24} />
        </div>
      </header>

      {error && (
        <div className="notice error floating" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {questionModalOpen && selectedQuestion && currentCard && (
        <div className={`question-focus ${isTimeExpired ? "expired" : timerSeconds <= 10 ? "urgent" : ""}`}>
          <div className="focus-toolbar">
            <div>
              <span>{isFreeQuestion ? "Câu hỏi phụ" : "Đang vào lượt"}</span>
              <strong>{isFreeQuestion ? "GM điều phối" : questionPlayer?.name || "Người chơi"}</strong>
            </div>
            <button
              type="button"
              className="focus-icon-button"
              onClick={() => setSoundEnabled((enabled) => !enabled)}
              aria-label={soundEnabled ? "Tắt âm thanh" : "Bật âm thanh"}
            >
              {soundEnabled ? <Volume2 size={24} /> : <VolumeX size={24} />}
            </button>
            <button
              type="button"
              className="focus-icon-button"
              onClick={closeQuestionModal}
              aria-label="Thoát màn câu hỏi"
            >
              <X size={26} />
            </button>
          </div>

          <div className="focus-content">
            <div className="focus-status-row">
              <div className="focus-card-meta">
                <span>{currentCard.code}</span>
                <strong>{currentCard.title}</strong>
              </div>
              <div className="focus-timer">
                <span>{isTimeExpired ? "Hết giờ" : "Timer"}</span>
                <strong>{formatTime(timerSeconds)}</strong>
              </div>
              <div className="focus-answer-actions">
                {isFreeQuestion ? (
                  result ? (
                    <button type="button" className="focus-answer-action" onClick={closeQuestionModal}>
                      Đóng câu hỏi
                    </button>
                  ) : (
                    <button type="button" className="focus-answer-action" onClick={revealFreeAnswer}>
                      Hiện đáp án
                    </button>
                  )
                ) : !answerLocked ? (
                  <button type="button" className="focus-answer-action" onClick={lockAnswer} disabled={!selectedOptionLabel}>
                    Chốt đáp án
                  </button>
                ) : result?.revealed ? (
                  <button type="button" className="focus-answer-action" onClick={closeQuestionModal}>
                    Đóng câu hỏi
                  </button>
                ) : result?.mode === "checked" && result.correct === false ? (
                  <>
                    <button type="button" className="focus-answer-action secondary" onClick={retryAnswer}>
                      Chọn lại
                    </button>
                    <button type="button" className="focus-answer-action" onClick={() => submitLockedAnswer({ reveal: true })} disabled={loading === "reveal-answer"}>
                      Hiện đáp án
                    </button>
                  </>
                ) : (
                  <button type="button" className="focus-answer-action" onClick={checkLockedAnswer} disabled={loading === "check-answer" || loading === "reveal-answer"}>
                    {loading === "check-answer" || loading === "reveal-answer" ? "Đang chấm..." : "Chấm đáp án"}
                  </button>
                )}
              </div>
            </div>
            <div className="focus-question-area">
              {currentCard.situation && <p className="focus-situation">{currentCard.situation}</p>}
              <blockquote className="focus-question">{selectedQuestion.text}</blockquote>
            </div>
            <div className="focus-response-area">
              {selectedQuestion.options?.length > 0 && (
                <div className="focus-options">
                  {selectedQuestion.options.map((option) => (
                    <button
                      type="button"
                      key={option.label}
                      className={[
                        "focus-option",
                        selectedOptionLabel === option.label ? "selected" : "",
                        (result?.revealed || result?.mode === "free") && result?.correctOption === option.label ? "correct-answer" : "",
                        (result?.mode === "free" || result?.mode === "checked" || result?.revealed) &&
                        selectedOptionLabel === option.label &&
                        result.correct === false
                          ? "wrong-answer"
                          : "",
                        answerLocked || result ? "locked" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => setSelectedOptionLabel(option.label)}
                      disabled={answerLocked || Boolean(result)}
                    >
                      <strong>{option.label}</strong>
                      <span>{option.text}</span>
                    </button>
                  ))}
                </div>
              )}
              {(result?.mode === "free" || result?.revealed) && (
                <div className="focus-answer-reveal">
                  <span>Đáp án</span>
                  {result.correctOption && <strong>{result.correctOption}</strong>}
                  {result.expectedAnswer && <p>{result.expectedAnswer}</p>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {eventModalOpen && (
        <div className={`event-modal ${eventSpinning ? "spinning" : "revealed"}`}>
          <div className="event-modal-card">
            <div className="event-modal-top">
              <div>
                <span>Biến cố vòng {match.roundNumber || 1}</span>
                <strong>{eventSpinning ? "Đang xoay chuyển cục diện" : "Biến cố xuất hiện"}</strong>
              </div>
              <button
                type="button"
                className="focus-icon-button"
                onClick={() => setSoundEnabled((enabled) => !enabled)}
                aria-label={soundEnabled ? "Tắt âm thanh" : "Bật âm thanh"}
              >
                {soundEnabled ? <Volume2 size={24} /> : <VolumeX size={24} />}
              </button>
            </div>

            <div className="event-modal-body">
              <div className="event-left-stage">
                <div className="event-wheel-wrap">
                  <div className="event-pointer" />
                  <div className="event-wheel">
                    <div className="event-wheel-center">
                      <span>{eventSpinning ? "ĐANG QUAY" : currentEvent?.code}</span>
                      <strong>{eventSpinning ? "?" : currentEvent?.title}</strong>
                    </div>
                  </div>
                </div>

                {eventSpinning && (
                  <div className="event-ticker" aria-label="Danh sách biến cố đang quay">
                    {(eventWheelItems.length ? eventWheelItems : [{ code: "BC", title: "BIẾN CỐ" }]).map((event) => (
                      <span key={event.code}>
                        {event.code} · {event.title}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="event-right-stage">
                {eventSpinning ? (
                  <div className="event-wait-card">
                    <span>Đang chọn biến cố</span>
                    <strong>Chờ kết quả...</strong>
                  </div>
                ) : (
                  currentEvent && (
                    <div className="event-result-card">
                      <div className="event-result-head">
                        <span>{currentEvent.code}</span>
                        <small>GM nhập điểm tay</small>
                      </div>
                      <h3>{currentEvent.title}</h3>
                      <p>{currentEvent.effect}</p>
                      {currentEvent.implementationNote && <small>{currentEvent.implementationNote}</small>}
                      {currentEvent.scoreChanges?.length > 0 && (
                        <div className="event-score-changes">
                          {currentEvent.scoreChanges.map((change) => (
                            <span key={change.playerId}>
                              {change.name}: {change.delta > 0 ? "+" : ""}
                              {change.delta}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                )}

                {!eventSpinning && (
                  <button
                    type="button"
                    className="primary-action event-close-button"
                    onClick={() => {
                      setEventModalOpen(false);
                      setScoreModalOpen(true);
                    }}
                  >
                    Xem bảng điểm
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {scoreModalOpen && (
        <div className="score-modal">
          <div className="score-modal-card">
            <div className="score-modal-top">
              <div>
                <span>Vòng {match.roundNumber || 1}</span>
                <strong>Bảng điểm</strong>
              </div>
              <button type="button" className="focus-icon-button" onClick={() => setScoreModalOpen(false)} aria-label="Đóng bảng điểm">
                <X size={26} />
              </button>
            </div>

            {currentEvent && (
              <div className="score-event-summary">
                <span>{currentEvent.code}</span>
                <strong>{currentEvent.title}</strong>
                <small>GM xử lý điểm bằng bảng nhập tay</small>
              </div>
            )}

            <div className="scoreboard-rank-list">
              {(match.leaderboard || match.players || []).map((player, index) => {
                const scoreChange = changedScoreByPlayer.get(player.id);
                return (
                  <div
                    className={[
                      "scoreboard-rank",
                      scoreChange ? "changed" : "",
                      scoreChange?.delta > 0 ? "positive" : "",
                      scoreChange?.delta < 0 ? "negative" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={player.id}
                  >
                    <span>#{index + 1}</span>
                    <strong>{player.name}</strong>
                    {scoreChange && (
                      <em>
                        {scoreChange.delta > 0 ? "+" : ""}
                        {scoreChange.delta}
                      </em>
                    )}
                    <b>{player.score}</b>
                  </div>
                );
              })}
            </div>

            <button type="button" className="primary-action score-modal-action" onClick={() => setScoreModalOpen(false)}>
              Đóng bảng điểm
            </button>
          </div>
        </div>
      )}

      <section className="game-board">
        <aside className="left-column">
          <div className="panel control-panel">
            <div className="section-title">
              <ClipboardList size={20} />
              <h2>Điều khiển</h2>
            </div>

            <form className="control-form" onSubmit={loadCard}>
              <label>
                Mã bài
                <div className="search-row">
                  <input value={cardCode} onChange={(event) => setCardCode(event.target.value)} placeholder="TH05" />
                  <button type="submit" aria-label="Tải lá bài">
                    {loading === "load-card" ? <Loader2 className="spin" size={18} /> : <Search size={18} />}
                  </button>
                </div>
              </label>

              <label>
                Độ khó
                <select
                  value={selectedDifficulty}
                  onChange={(event) => {
                    setSelectedDifficulty(event.target.value);
                    setRevealedQuestion(null);
                    setQuestionPlayerId("");
                    setResult(null);
                    setSelectedOptionLabel("");
                    setAnswerLocked(false);
                    setQuestionMode("turn");
                    clearTimer();
                  }}
                >
                  {currentCard?.questions?.map((question) => (
                    <option key={question.difficulty} value={question.difficulty}>
                      {difficultyMeta[question.difficulty]?.label} · {question.points} điểm
                    </option>
                  ))}
                </select>
              </label>

              <label className="timer-field">
                Timer
                <div className="timer-control">
                  <div className="timer-presets">
                    <button
                      type="button"
                      className={timerOverrideSeconds === "" ? "active" : ""}
                      onClick={() => setTimerOverrideSeconds("")}
                    >
                      Auto {difficultyMeta[selectedDifficulty]?.fallbackSeconds || 45}s
                    </button>
                    {timerPresets.map((seconds) => (
                      <button
                        type="button"
                        key={seconds}
                        className={Number(timerOverrideSeconds) === seconds ? "active" : ""}
                        onClick={() => setTimerOverrideSeconds(String(seconds))}
                      >
                        {seconds}s
                      </button>
                    ))}
                  </div>
                  <input
                    type="number"
                    min="5"
                    max="300"
                    step="5"
                    value={timerOverrideSeconds}
                    onChange={(event) => setTimerOverrideSeconds(event.target.value)}
                    placeholder="Tùy chỉnh"
                    aria-label="Timer tùy chỉnh theo giây"
                  />
                </div>
              </label>

              <label>
                Người trả lời
                <select value={selectedPlayerId} onChange={(event) => setSelectedPlayerId(event.target.value)} disabled={match.pendingEvent}>
                  <option value="">Chọn người chơi</option>
                  {match.players.map((player) => {
                    const state = turnOrder.order.find((item) => item.id === player.id);
                    return (
                      <option key={player.id} value={player.id} disabled={state?.processed}>
                        {player.name}
                        {state?.answered ? " - đã trả lời" : state?.skipped ? " - bỏ qua" : ""}
                      </option>
                    );
                  })}
                </select>
              </label>
            </form>

            <div className="turn-order-list" aria-label="Trạng thái vòng">
              {turnOrder.order.map((player) => (
                <span
                  key={player.id}
                  className={[
                    player.id === selectedPlayerId ? "current" : "",
                    player.answered ? "done" : "",
                    player.skipped ? "skipped" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {player.name}
                  {player.answered ? " - đã trả lời" : player.skipped ? " - bỏ qua" : " - chờ"}
                </span>
              ))}
            </div>

            <button
              className="primary-action large"
              type="button"
              onClick={revealQuestion}
              disabled={!selectedQuestionMeta || !selectedPlayerId || selectedTurnState?.processed || match.pendingEvent}
            >
              <Play size={18} />
              Bắt đầu lượt
            </button>
            <button
              className="ghost-action large"
              type="button"
              onClick={skipSelectedTurn}
              disabled={!selectedPlayerId || selectedTurnState?.processed || match.pendingEvent || loading === `skip-${selectedPlayerId}`}
            >
              {loading === `skip-${selectedPlayerId}` ? <Loader2 className="spin" size={18} /> : <Minus size={18} />}
              Bỏ qua lượt
            </button>
            <button className="ghost-action large" type="button" onClick={revealFreeQuestion} disabled={!selectedQuestionMeta || loading === "free-question"}>
              {loading === "free-question" ? <Loader2 className="spin" size={18} /> : <CircleHelp size={18} />}
              Câu hỏi phụ
            </button>
            <button className="ghost-action large" type="button" onClick={resetTurn}>
              <RefreshCcw size={18} />
              Lượt mới
            </button>

            <div className="deck-strip">
              {cards.slice(0, 40).map((card) => (
                <button
                  type="button"
                  key={card.code}
                  className={[
                    "deck-chip",
                    currentCard?.code === card.code ? "active" : "",
                    card.availableCount === 0 ? "empty" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => loadCard(null, card.code)}
                >
                  <span>{card.code}</span>
                  <small>{card.availableCount ?? 3}/3</small>
                </button>
              ))}
            </div>
          </div>

          <div className="gm-tile">
            <UserCircle size={44} />
            <div>
              <strong>Game Master</strong>
              <span>Quyền năng tối thượng</span>
            </div>
          </div>
        </aside>

        <section className="arena-panel admin-grade-panel">
          <div className="arena-heading admin-grade-heading">
            <div>
              <span className="current-badge">Điều phối chấm</span>
              <h1>{selectedQuestion ? "Bàn chấm đáp án" : currentCard ? `${currentCard.code} - ${currentCard.title}` : "Chọn một lá để bắt đầu"}</h1>
            </div>
            <div className={`timer-display ${isTimeExpired ? "expired" : isTimerRunning ? "running" : "idle"}`}>
              <span>Timer</span>
              <strong>{formatTime(timerSeconds)}</strong>
            </div>
          </div>

          {answerIsRevealed ? (
            <div className={`grade-result-card ${result?.correct === true ? "correct" : result?.correct === false ? "wrong" : "review"}`}>
              <div className="grade-result-head">
                <span>{isFreeQuestion ? "Câu hỏi phụ" : scoringPlayer?.name || result?.playerName || "Người chơi"}</span>
                <strong>
                  {result?.correct === true
                    ? "Đúng - GM nhập điểm"
                    : result?.correct === false
                      ? "Sai - GM xử lý điểm"
                      : "Đáp án đã hiển thị"}
                </strong>
              </div>

              <div className="grade-result-meta">
                <div>
                  <span>Thẻ bài</span>
                  <strong>{currentCard ? `${currentCard.code} - ${currentCard.title}` : "Câu hỏi"}</strong>
                </div>
                <div>
                  <span>Mức độ</span>
                  <strong>{selectedQuestion ? `${difficultyMeta[selectedQuestion.difficulty]?.label || selectedQuestion.difficulty} · ${selectedQuestion.points} điểm` : "Tay"}</strong>
                </div>
                <div>
                  <span>Đã chọn</span>
                  <strong>{selectedOptionLabel || "Chưa chọn"}</strong>
                </div>
              </div>

              <div className="grade-answer-card">
                <span>Đáp án đúng</span>
                {result?.correctOption && <strong>{result.correctOption}</strong>}
                {result?.expectedAnswer && <p>{result.expectedAnswer}</p>}
              </div>

              {scoringPlayer && (
                <div className="grade-score-control">
                  <div>
                    <span>Nhập điểm cho</span>
                    <strong>{scoringPlayer.name}</strong>
                    <small>{scoringPlayer.score} điểm hiện tại</small>
                  </div>
                  <div className="quick-score-actions">
                    <button
                      type="button"
                      className="minus-score"
                      onClick={() => adjustPlayerScore(scoringPlayer.id, -1)}
                      disabled={loading === `score-${scoringPlayer.id}--1`}
                      aria-label={`Trừ 1 điểm của ${scoringPlayer.name}`}
                    >
                      <Minus size={17} />
                    </button>
                    <button
                      type="button"
                      className="plus-score"
                      onClick={() => adjustPlayerScore(scoringPlayer.id, 1)}
                      disabled={loading === `score-${scoringPlayer.id}-1`}
                      aria-label={`Cộng 1 điểm cho ${scoringPlayer.name}`}
                    >
                      <Plus size={17} />
                    </button>
                    <input
                      type="number"
                      step="1"
                      value={quickScoreDeltas[scoringPlayer.id] || ""}
                      onChange={(event) =>
                        setQuickScoreDeltas((current) => ({
                          ...current,
                          [scoringPlayer.id]: event.target.value,
                        }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          applyQuickScoreDelta(scoringPlayer.id);
                        }
                      }}
                      placeholder="± điểm"
                      aria-label={`Nhập điểm cộng hoặc trừ cho ${scoringPlayer.name}`}
                    />
                    <button
                      type="button"
                      className="apply-score"
                      onClick={() => applyQuickScoreDelta(scoringPlayer.id)}
                      disabled={loading.startsWith(`score-${scoringPlayer.id}-`) || !quickScoreDeltas[scoringPlayer.id]}
                      aria-label={`Áp dụng điểm tay cho ${scoringPlayer.name}`}
                    >
                      <Check size={17} />
                    </button>
                  </div>
                </div>
              )}

              <button type="button" className="primary-action" onClick={closeQuestionModal}>
                Đóng admin
              </button>
            </div>
          ) : selectedQuestion ? (
            <div className="grade-workspace">
              <div className="question-summary-card">
                <div className={`question-kind ${difficultyMeta[selectedQuestion.difficulty]?.tone}`}>
                  <CircleHelp size={18} />
                  <span>{currentCard?.code} · {selectedQuestion.label}</span>
                </div>
                <strong>{currentCard?.title || "Câu hỏi đang mở"}</strong>
                <p>{selectedQuestion.text}</p>
              </div>

              {selectedQuestion.options?.length > 0 && (
                <div className="admin-choice-grid">
                  {selectedQuestion.options.map((option) => (
                    <button
                      type="button"
                      key={option.label}
                      className={[
                        "option",
                        selectedOptionLabel === option.label ? "selected" : "",
                        (result?.revealed || result?.mode === "free") && result?.correctOption === option.label ? "correct-answer" : "",
                        (result?.correct === false || result?.mode === "free") && selectedOptionLabel === option.label
                          ? "wrong-answer"
                          : "",
                        answerLocked ? "locked" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => setSelectedOptionLabel(option.label)}
                      disabled={Boolean(result) || answerLocked}
                    >
                      <strong>{option.label}</strong>
                      <span>{option.text}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : currentCard ? (
            <div className="card-ready-panel">
              <div className="card-ready-main">
                <span>{currentCard.code}</span>
                <strong>{currentCard.title}</strong>
                <p>{currentCard.situation || "Chọn mức độ và người trả lời ở bảng điều khiển bên trái, sau đó bắt đầu lượt."}</p>
              </div>
              <div className="card-ready-grid">
                <div>
                  <span>Mức độ</span>
                  <strong>{selectedQuestionMeta ? difficultyMeta[selectedQuestionMeta.difficulty]?.label : "Hết câu"}</strong>
                  <small>{selectedQuestionMeta ? `${selectedQuestionMeta.points} điểm gợi ý` : "Chọn thẻ khác"}</small>
                </div>
                <div>
                  <span>Người trả lời</span>
                  <strong>{selectedTurnPlayer?.name || "Chưa chọn"}</strong>
                  <small>{selectedTurnState?.processed ? "Đã xử lý vòng này" : "Sẵn sàng"}</small>
                </div>
                <div>
                  <span>Timer</span>
                  <strong>{getTimerOverride() || selectedQuestionMeta?.timeLimitSeconds || difficultyMeta[selectedDifficulty]?.fallbackSeconds || 45}s</strong>
                  <small>{getTimerOverride() ? "Tùy chỉnh" : "Auto"}</small>
                </div>
              </div>
            </div>
          ) : (
            <div className="arena-empty admin-grade-empty">
              <BookOpen size={42} />
              <p>{currentCard ? "Mở câu hỏi để bắt đầu chấm. Câu hỏi đầy đủ sẽ nằm trên màn hình trình chiếu." : "Chọn mã bài ở bảng điều khiển."}</p>
            </div>
          )}

          {selectedQuestion && !answerIsRevealed && (
          <div className="score-panel central-score-panel">
            <div className="section-title">
              <BadgeCheck size={20} />
              <h2>Chấm đáp án</h2>
            </div>
            {isFreeQuestion ? (
              <div className="free-answer-panel">
                <span>Câu hỏi phụ</span>
                {!result ? (
                  <button type="button" className="primary-action reveal-answer-button" onClick={revealFreeAnswer} disabled={!selectedQuestion}>
                    <Check size={20} />
                    Hiện đáp án
                  </button>
                ) : (
                  <div className="answer-reveal">
                    <span>Đáp án đúng</span>
                    {result.correctOption && <strong>{result.correctOption}</strong>}
                    {result.expectedAnswer && <p>{result.expectedAnswer}</p>}
                  </div>
                )}
                <small>Điểm xử lý bằng Điểm nhanh.</small>
              </div>
            ) : (
              <>
                <div className="score-target">
                  <label>
                    {result && result.mode !== "checked" ? "Vừa trả lời" : "Đang trả lời"}
                    <div className="score-player-readonly">
                      {result?.playerName || questionPlayer?.name || currentTurnPlayer?.name || "Chọn người chơi"}
                    </div>
                  </label>
                  <div>
                    <span>Điểm số</span>
                    <strong>{result ? result.playerScore : questionPlayer?.score ?? activePlayer?.score ?? 0}</strong>
                  </div>
                </div>
                <div className="answer-pick">
                  <span>{answerLocked ? "Đáp án đã chốt" : "Lựa chọn"}</span>
                  <strong>{selectedOptionLabel || "Chưa chọn"}</strong>
                </div>
                {result ? (
                  <div className={`verdict ${result.correct === true ? "correct" : result.correct === false ? "wrong" : "review"}`}>
                    {result.correct === true ? <Check size={22} /> : result.correct === false ? <X size={22} /> : <AlertCircle size={22} />}
                    <strong>
                      {result.mode === "checked" && result.correct === false
                        ? "Sai - có thể chọn lại"
                        : result.timerExpired
                          ? "Hết giờ - GM xử lý điểm"
                          : result.correct === true
                            ? "Đúng - GM nhập điểm"
                            : result.correct === false
                              ? result.points < 0
                                ? `Sai, ${result.points} điểm`
                                : "Sai - GM xử lý điểm"
                              : "Chưa có kết quả"}
                    </strong>
                  </div>
                ) : null}
                {result?.revealed && result?.correctOption && (
                  <div className="answer-reveal">
                    <span>Đáp án đúng</span>
                    <strong>{result.correctOption}</strong>
                    {result.expectedAnswer && <p>{result.expectedAnswer}</p>}
                  </div>
                )}
                {selectedQuestion && (
                  <div className="answer-panel-actions">
                    {!answerLocked ? (
                      <button type="button" className="primary-action reveal-answer-button" onClick={lockAnswer} disabled={!selectedOptionLabel || Boolean(result)}>
                        <Check size={20} />
                        Chốt đáp án
                      </button>
                    ) : result?.revealed ? (
                      <button type="button" className="primary-action reveal-answer-button" onClick={closeQuestionModal}>
                        Đóng câu hỏi
                      </button>
                    ) : result?.mode === "checked" && result.correct === false ? (
                      <>
                        <button type="button" className="ghost-action reveal-answer-button" onClick={retryAnswer}>
                          Chọn lại
                        </button>
                        <button type="button" className="primary-action reveal-answer-button" onClick={() => submitLockedAnswer({ reveal: true })} disabled={loading === "reveal-answer"}>
                          Hiện đáp án
                        </button>
                      </>
                    ) : (
                      <button type="button" className="primary-action reveal-answer-button" onClick={checkLockedAnswer} disabled={loading === "check-answer" || loading === "reveal-answer" || Boolean(result)}>
                        {loading === "check-answer" || loading === "reveal-answer" ? <Loader2 className="spin" size={18} /> : <Check size={20} />}
                        Chấm đáp án
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          )}
        </section>

        <aside className="right-column">
          <div className="panel quick-score-panel">
            <div className="section-title">
              <Plus size={20} />
              <h2>Điểm nhanh</h2>
            </div>
            <div className="quick-score-list">
              {match.players.map((player) => (
                <div className="quick-score-row" key={player.id}>
                  <div>
                    <strong>{player.name}</strong>
                    <span>{player.score} điểm</span>
                  </div>
                  <div className="quick-score-actions">
                    <button
                      type="button"
                      className="minus-score"
                      onClick={() => adjustPlayerScore(player.id, -1)}
                      disabled={loading === `score-${player.id}--1`}
                      aria-label={`Trừ 1 điểm của ${player.name}`}
                    >
                      <Minus size={17} />
                    </button>
                    <button
                      type="button"
                      className="plus-score"
                      onClick={() => adjustPlayerScore(player.id, 1)}
                      disabled={loading === `score-${player.id}-1`}
                      aria-label={`Cộng 1 điểm cho ${player.name}`}
                    >
                      <Plus size={17} />
                    </button>
                    <input
                      type="number"
                      step="1"
                      value={quickScoreDeltas[player.id] || ""}
                      onChange={(event) =>
                        setQuickScoreDeltas((current) => ({
                          ...current,
                          [player.id]: event.target.value,
                        }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          applyQuickScoreDelta(player.id);
                        }
                      }}
                      placeholder="± điểm"
                      aria-label={`Nhập điểm cộng hoặc trừ cho ${player.name}`}
                    />
                    <button
                      type="button"
                      className="apply-score"
                      onClick={() => applyQuickScoreDelta(player.id)}
                      disabled={loading.startsWith(`score-${player.id}-`) || !quickScoreDeltas[player.id]}
                      aria-label={`Áp dụng điểm tay cho ${player.name}`}
                    >
                      <Check size={17} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </aside>
      </section>

      <footer className="game-log">
        <div className="leaderboard-strip">
          <Trophy size={17} />
          {leaderboard.map((player) => (
            <span key={player.id}>
              {player.name}: <strong>{player.score}</strong>
            </span>
          ))}
        </div>
      </footer>
    </main>
  );
}

export default App;
