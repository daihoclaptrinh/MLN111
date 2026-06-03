const { WebSocketServer } = require("ws");

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function createIdleState(matchId) {
  return {
    version: 1,
    matchId,
    screen: "idle",
    updatedAt: new Date().toISOString(),
  };
}

function createDisplayHub() {
  const states = new Map();
  const clientsByMatch = new Map();

  function getSubscribers(matchId) {
    if (!clientsByMatch.has(matchId)) {
      clientsByMatch.set(matchId, new Set());
    }
    return clientsByMatch.get(matchId);
  }

  function send(ws, message) {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify(message));
  }

  function broadcast(matchId, state) {
    const clients = clientsByMatch.get(matchId);
    if (!clients) return;
    for (const client of clients) {
      send(client, { type: "display:state", matchId, state });
    }
  }

  function publish(matchId, state) {
    if (!matchId || !state || typeof state !== "object") {
      return null;
    }

    const publicState = {
      ...state,
      version: 1,
      matchId,
      updatedAt: new Date().toISOString(),
    };
    states.set(matchId, publicState);
    broadcast(matchId, publicState);
    return publicState;
  }

  function getState(matchId) {
    return states.get(matchId) || createIdleState(matchId);
  }

  function attach(server) {
    const wss = new WebSocketServer({ server, path: "/ws/display" });

    wss.on("connection", (ws) => {
      ws.matchIds = new Set();

      ws.on("message", (raw) => {
        const message = safeJsonParse(raw.toString());
        if (!message || typeof message !== "object") return;

        if (message.type === "display:subscribe" && message.matchId) {
          const matchId = String(message.matchId);
          ws.matchIds.add(matchId);
          getSubscribers(matchId).add(ws);
          send(ws, { type: "display:state", matchId, state: getState(matchId) });
          return;
        }

        if (message.type === "display:update" && message.matchId && message.state) {
          publish(String(message.matchId), message.state);
        }
      });

      ws.on("close", () => {
        for (const matchId of ws.matchIds) {
          clientsByMatch.get(matchId)?.delete(ws);
        }
      });
    });

    return wss;
  }

  return {
    attach,
    getState,
    publish,
  };
}

module.exports = { createDisplayHub };
