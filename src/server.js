import { setDefaultResultOrder } from "node:dns";
setDefaultResultOrder("ipv4first");

import "dotenv/config";
import http from "http";
import app from "./app.js";
import { initSocketIO } from "./socket/index.js";
import { startScheduledJobs } from "./jobs/index.js";

const PORT = process.env.PORT;

// Wrap Express app with HTTP server for Socket.io WebSocket support
const server = http.createServer(app);
initSocketIO(server);

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV}`);
    console.log(`Frontend URL: ${process.env.FRONTEND_URL}`);
});

startScheduledJobs();