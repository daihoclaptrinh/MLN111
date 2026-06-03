const fs = require("node:fs");
const path = require("node:path");

const eventsPath = path.join(__dirname, "../../data/events.json");

function loadEvents() {
  if (!fs.existsSync(eventsPath)) {
    return [];
  }

  return JSON.parse(fs.readFileSync(eventsPath, "utf8"));
}

const events = loadEvents();

function pickRandomEvent() {
  if (events.length === 0) {
    return null;
  }

  return events[Math.floor(Math.random() * events.length)];
}

module.exports = {
  events,
  pickRandomEvent,
};
