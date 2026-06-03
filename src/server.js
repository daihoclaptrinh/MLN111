require("dotenv").config({ override: true });

const http = require("node:http");
const { createApp } = require("./app");
const { createDisplayHub } = require("./services/displayHub");

const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || "0.0.0.0";
const displayHub = createDisplayHub();
const app = createApp({ displayHub });
const server = http.createServer(app);

displayHub.attach(server);

server.listen(port, host, () => {
  console.log(`TRIET CHIEN API listening on http://${host}:${port}`);
  console.log(`Local: http://localhost:${port}`);
});
