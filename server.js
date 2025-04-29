require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');

const roomHandlers = require('./room');
const youtubeHandlers = require('./youtube');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});
const PORT = process.env.PORT || 3001;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

roomHandlers(app, io);
youtubeHandlers(app, io, YOUTUBE_API_KEY);

server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ 서버 실행 중 http://localhost:${PORT}`);
});