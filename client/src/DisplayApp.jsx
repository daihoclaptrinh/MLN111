import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, BadgeCheck, Clock, Trophy, Wifi, WifiOff } from "lucide-react";
import "./App.css";

const API_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL || "http://localhost:4000");
const WS_BASE_URL = getWebSocketBaseUrl();

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

async function api(path) {
  const response = await fetch(`${API_BASE_URL}${path}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || "API request failed");
  return body.data ?? body;
}

function formatTime(totalSeconds = 0) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getMatchIdFromPath() {
  const [, route, matchId] = window.location.pathname.split("/");
  return route === "display" ? decodeURIComponent(matchId || "") : "";
}

function DisplayApp() {
  const matchId = useMemo(() => getMatchIdFromPath(), []);
  const [state, setState] = useState(null);
  const [connection, setConnection] = useState("connecting");
  const [error, setError] = useState("");
  const socketRef = useRef(null);

  useEffect(() => {
    if (!matchId) return undefined;

    let cancelled = false;
    api(`/api/matches/${encodeURIComponent(matchId)}/display`)
      .then((payload) => {
        if (!cancelled) setState(payload);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [matchId]);

  useEffect(() => {
    if (!matchId || typeof WebSocket === "undefined") return undefined;

    let reconnectTimeoutId = null;
    let closed = false;

    function connect() {
      setConnection("connecting");
      const socket = new WebSocket(`${WS_BASE_URL}/ws/display`);
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        setConnection("online");
        setError("");
        socket.send(JSON.stringify({ type: "display:subscribe", matchId }));
      });

      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "display:state" && message.matchId === matchId) {
          setState(message.state);
        }
      });

      socket.addEventListener("close", () => {
        setConnection("offline");
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
      socketRef.current?.close();
    };
  }, [matchId]);

  if (!matchId) {
    return (
      <main className="display-shell idle">
        <div className="display-empty-card">
          <AlertCircle size={38} />
          <h1>Thiếu mã trận</h1>
          <p>Mở màn hình theo dạng /display/:matchId từ nút Màn hình trên trang GM.</p>
        </div>
      </main>
    );
  }

  const leaderboard = state?.leaderboard || [];
  const question = state?.question;
  const answer = state?.answer;
  const timer = state?.timer || { seconds: 0, status: "idle" };
  const displayEvent = state?.event;
  const eventItems = displayEvent?.items?.length ? displayEvent.items : [{ code: "BC", title: "BIẾN CỐ" }];
  const screen = state?.screen || "idle";

  return (
    <main className={`display-shell ${screen} ${timer.status === "expired" ? "expired" : ""}`}>
      <header className="display-topbar">
        <div>
          <span>TRIẾT CHIẾN</span>
          <strong>{state?.scopeId || "Đang chờ trận"}</strong>
        </div>
        <div className="display-round">
          Vòng {state?.roundNumber || 1}
          {state?.roundProgress && (
            <small>
              {state.roundProgress.processed ?? state.roundProgress.answered}/{state.roundProgress.total} đã xử lý
            </small>
          )}
        </div>
        <div className={`display-connection ${connection}`}>
          {connection === "online" ? <Wifi size={18} /> : <WifiOff size={18} />}
          {connection === "online" ? "Realtime" : "Đang nối lại"}
        </div>
      </header>

      {error && (
        <div className="display-error">
          <AlertCircle size={20} />
          {error}
        </div>
      )}

      {displayEvent?.event && screen !== "event" && (
        <aside className="display-event-banner">
          <span>{displayEvent.event.code}</span>
          <strong>{displayEvent.event.title}</strong>
          <p>{displayEvent.event.effect}</p>
        </aside>
      )}

      {screen === "event" ? (
        <section className="display-event-stage">
          <div className="display-event-layout">
            <div className={`display-event-wheel-wrap ${displayEvent?.spinning ? "spinning" : "revealed"}`}>
              <div className="display-event-pointer" />
              <div className="display-event-wheel">
                <div className="display-event-wheel-center">
                  <span>{displayEvent?.spinning ? "Đang quay" : displayEvent?.event?.code || "BC"}</span>
                  <strong>{displayEvent?.spinning ? "?" : displayEvent?.event?.title || "Biến cố"}</strong>
                </div>
              </div>
              <div className="display-event-ticker" aria-label="Danh sách biến cố đang quay">
                {eventItems.map((event) => (
                  <span key={event.code}>
                    {event.code} · {event.title}
                  </span>
                ))}
              </div>
            </div>

            <div className={`display-event-card ${displayEvent?.spinning ? "spinning" : ""}`}>
              <span>Biến cố vòng {state?.roundNumber || 1}</span>
              {displayEvent?.spinning ? (
                <>
                  <strong>Đang quay...</strong>
                  <p>Chờ GM công bố biến cố của vòng.</p>
                </>
              ) : displayEvent?.event ? (
                <>
                  <em>{displayEvent.event.code}</em>
                  <strong>{displayEvent.event.title}</strong>
                  <p>{displayEvent.event.effect}</p>
                  {displayEvent.event.implementationNote && <small>{displayEvent.event.implementationNote}</small>}
                </>
              ) : (
                <>
                  <strong>Chờ biến cố</strong>
                  <p>GM sẽ quay khi đủ lượt trong vòng.</p>
                </>
              )}
            </div>
          </div>
        </section>
      ) : screen === "scoreboard" ? (
        <section className="display-scoreboard-stage">
          <div className="display-scoreboard-card">
            <span>Bảng điểm</span>
            <h1>Điểm hiện tại</h1>
            <div className="display-scoreboard-list">
              {leaderboard.map((player, index) => (
                <div key={player.id}>
                  <span>#{index + 1}</span>
                  <strong>{player.name}</strong>
                  <b>{player.score}</b>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : question ? (
        <section className="display-question-stage">
          <div className="display-question-meta">
            <div>
              <span>{question.cardCode}</span>
              <strong>{question.cardTitle}</strong>
            </div>
            <div>
              <span>{question.mode === "free" ? "Câu hỏi phụ" : "Đang trả lời"}</span>
              <strong>{question.playerName || "Người chơi"}</strong>
            </div>
            <div className={`display-timer ${timer.status}`}>
              <Clock size={24} />
              <strong>{formatTime(timer.seconds)}</strong>
            </div>
          </div>

          <blockquote className="display-question-text">{question.text}</blockquote>

          {question.answerStatus && (
            <div className={`display-answer-status ${question.answerStatus.phase}`}>
              <span>{question.answerStatus.label}</span>
            </div>
          )}

          <div className="display-options">
            {(question.options || []).map((option) => (
              <div
                className={[
                  "display-option",
                  question.pickedOption === option.label ? "picked" : "",
                  answer?.correctOption === option.label ? "correct" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={option.label}
              >
                <strong>{option.label}</strong>
                <span>{option.text}</span>
              </div>
            ))}
          </div>

          {answer && (
            <div className="display-answer">
              <BadgeCheck size={28} />
              <span>Đáp án đúng</span>
              {answer.correctOption && <strong>{answer.correctOption}</strong>}
              {(answer.expectedAnswer || answer.explanation) && <p>{answer.expectedAnswer || answer.explanation}</p>}
            </div>
          )}
        </section>
      ) : (
        <section className="display-idle-stage">
          <div className="display-empty-card">
            <Trophy size={44} />
            <h1>Chờ GM mở nội dung</h1>
            <p>Màn hình này chỉ hiển thị câu hỏi, timer, đáp án đã công bố, biến cố và bảng điểm.</p>
          </div>
        </section>
      )}

      <footer className="display-score-strip">
        <Trophy size={22} />
        {leaderboard.length > 0 ? (
          leaderboard.map((player, index) => (
            <div key={player.id}>
              <span>#{index + 1}</span>
              <strong>{player.name}</strong>
              <b>{player.score}</b>
            </div>
          ))
        ) : (
          <p>Chưa có bảng điểm</p>
        )}
      </footer>
    </main>
  );
}

export default DisplayApp;
