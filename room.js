// 데이터 저장소
let rooms = {};
let nextSongId = 0;

// 유틸: 초대 코드 생성
function generateInviteCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function cleanupEmptyRooms() {
    for (const [code, room] of Object.entries(rooms)) {
        if (room.members.length === 0) {
            delete rooms[code];
            console.log(`🧹 빈 방 제거됨: ${code}`);
        }
    }
}

// === REST API ===
module.exports = (app, io) => {

    app.get('/', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.stringify(rooms, null, 2));
    });

    app.post('/room/create', (req, res) => {
        const { roomTitle } = req.body;
        const roomCode = generateInviteCode();
        rooms[roomCode] = {
            roomName: roomTitle,
            isPlaying: true,
            repeatMode: 'none',
            currentTime: 0,
            currentIndex: 0,
            members: [],
            playlist: []
        };
        res.json({ success: true, inviteCode: roomCode });
    });

    app.post('/room/join', (req, res) => {
        const { roomCode } = req.body;
        if (rooms[roomCode]) {
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false, message: '방이 존재하지 않습니다.' });
        }
    });

    app.get('/room/:roomCode/title', (req, res) => {
        const { roomCode } = req.params;
        const room = rooms[roomCode];
        if (room) {
            res.json({ success: true, roomName: room.roomName });
        } else {
            res.status(404).json({ success: false, message: '방을 찾을 수 없습니다.' });
        }
    });

    app.get('/room/:roomCode/members', (req, res) => {
        const { roomCode } = req.params;
        const room = rooms[roomCode];
        if (room) {
            const memberNames = room.members.map(member => member.name);
            res.json({ success: true, members: memberNames });
        } else {
            res.status(404).json({ success: false, message: '방을 찾을 수 없습니다.' });
        }
    });

    app.get('/room/:roomCode/playlist', (req, res) => {
        const { roomCode } = req.params;
        const room = rooms[roomCode];
        if (room) {
            res.json({ success: true, playlist: room.playlist });
        } else {
            res.status(404).json({ success: false, message: '방을 찾을 수 없습니다.' });
        }
    });

// === WebSocket ===
    io.on('connection', (socket) => {
        console.log('🔵 유저 연결:', socket.id);

        socket.on('disconnect', () => {
            console.log('🔴 유저 연결 종료:', socket.id);
            for (const [roomCode, room] of Object.entries(rooms)) {
                const before = room.members.length;
                room.members = room.members.filter(member => member.id !== socket.id);
                if (room.members.length !== before) {
                    io.to(roomCode).emit('update-members', room.members.map(m => m.name));
                }
            }
            cleanupEmptyRooms();
        });

        socket.on('connect-room', ({ roomCode, userName }, callback) => {
            const room = rooms[roomCode];
            if (room) {
                const alreadyConnected = room.members.some(m => m.id === socket.id);
                if (!alreadyConnected) {
                    room.members.push({ id: socket.id, name: userName });
                    socket.join(roomCode);
                    io.to(roomCode).emit('update-members', room.members.map(m => m.name));
                }
                callback({
                    success: true,
                    state: {
                        isPlaying: room.isPlaying,
                        repeatMode: room.repeatMode,
                        currentTime: room.currentTime,
                        currentIndex: room.currentIndex
                    }
                });
            } else {
                callback({ success: false, message: '방이 존재하지 않습니다.' });
            }
        });

        socket.on('leave-room', ({ roomCode }) => {
            const room = rooms[roomCode];
            if (room) {
                room.members = room.members.filter(member => member.id !== socket.id);
                io.to(roomCode).emit('update-members', room.members.map(m => m.name));
            }
            cleanupEmptyRooms();
        });

        socket.on('add-to-playlist', (song) => {
            for (const [roomCode, room] of Object.entries(rooms)) {
                const member = room.members.find(m => m.id === socket.id);
                if (member) {
                    const newSong = {
                        ...song,
                        id: ++nextSongId,
                        addedBy: member.name
                    };
                    room.playlist.push(newSong);
                    io.to(roomCode).emit('update-playlist', room.playlist);
                    break;
                }
            }
        });

        socket.on('remove-from-playlist', (songId) => {
            for (const [roomCode, room] of Object.entries(rooms)) {
                const member = room.members.find(m => m.id === socket.id);
                if (member) {
                    room.playlist = room.playlist.filter(song => song.id !== songId);
                    io.to(roomCode).emit('update-playlist', room.playlist);
                    break;
                }
            }
        });

        socket.on('toggle-play-pause', ({ roomCode }) => {
            const room = rooms[roomCode];
            if (!room) return;
            room.isPlaying = !room.isPlaying;
            io.to(roomCode).emit('play-pause-toggled', { isPlaying: room.isPlaying });
        });

        socket.on('update-current-time', ({ roomCode, time }) => {
            const room = rooms[roomCode];
            if (!room) return;
            room.currentTime = time;
        });

        socket.on('seek-to', ({ roomCode, time }) => {
            const room = rooms[roomCode];
            if (!room) return;
            io.to(roomCode).emit('seeked-to', { time });
        });

        socket.on('change-repeat-mode', ({ roomCode, mode }) => {
            const room = rooms[roomCode];
            if (!room) return;

            room.repeatMode = mode;
            io.to(roomCode).emit('repeat-mode-changed', { mode });
        });

        socket.on('play-video-at', ({ roomCode, index, time }) => {
            const room = rooms[roomCode];
            if (!room) return;

            room.currentIndex = index;
            room.currentTime = time;

            io.to(roomCode).emit('play-video-at', { index, time });
        });

        socket.on('request-sync', ({ roomCode }) => {
            const room = rooms[roomCode];
            if (!room) return;
            socket.emit('sync-info', {
                isPlaying: room.isPlaying,
                currentTime: room.currentTime,
                currentIndex: room.currentIndex,
                repeatMode: room.repeatMode,
            });
        });
    });
};