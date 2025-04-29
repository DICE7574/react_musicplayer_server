const fs = require('fs');
// 데이터 저장소
let rooms = {};
let nextSongId = 0;

try {
    const data = fs.readFileSync('./testRoom.json', 'utf-8');
    rooms = JSON.parse(data);
    console.log('테스트 룸 불러오기 진행 성공');
} catch (err) {
    console.error('테스트 룸 불러오기 진행 실패', err);
    rooms = {};
}
// 초대 코드 생성
function generateInviteCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    if (rooms[code]) {
        console.log(`🟡중복 코드 당첨: ${code}`);
    }
    return code;
}

function cleanupEmptyRooms() {
    for (const [code, room] of Object.entries(rooms)) {
        if (room.members.length === 0 && code !== 'test') {
            delete rooms[code];
            console.log(`🔴 빈 방 제거됨: ${code}`);
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
        let roomCode;
        do {
            roomCode = generateInviteCode();
        } while (rooms[roomCode]);
        console.log(`🔵 방 생성: ${roomCode}`);
        rooms[roomCode] = {
            roomName: roomTitle,
            isPlaying: true,
            isEnded: false,
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
            const memberInfos = room.members.map(member => ({
                id: member.id,
                name: member.name
            }));
            res.json({ success: true, members: memberInfos });
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
                    io.to(roomCode).emit('update-members', room.members.map(m => ({ id: m.id, name: m.name })));
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
                    io.to(roomCode).emit('update-members', room.members.map(m => ({ id: m.id, name: m.name })));
                }
                callback({
                    success: true,
                    state: {
                        isPlaying: room.isPlaying,
                        isEnded: room.isEnded,
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
                io.to(roomCode).emit('update-members', room.members.map(m => ({ id: m.id, name: m.name })));
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
                    if (room.isEnded) {
                        const newIndex = room.playlist.length - 1;
                        room.currentIndex = newIndex;
                        room.currentTime = 0;
                        io.to(roomCode).emit('play-video-at', { index: newIndex, time: 0, plist: room.playlist });
                    }
                    break;
                }
            }
        });

        socket.on('remove-from-playlist', (songId) => {
            for (const [roomCode, room] of Object.entries(rooms)) {
                const member = room.members.find(m => m.id === socket.id);
                if (member) {
                    const removingIndex = room.playlist.findIndex(song => song.id === songId);

                    if (removingIndex !== -1) {
                        room.playlist = room.playlist.filter(song => song.id !== songId);
                        io.to(roomCode).emit('update-playlist', room.playlist);
                        if (room.currentIndex === removingIndex) { // 현재 재생중인 곡을 삭제한 경우
                            if (room.playlist.length === 0) { // 플레이리스트가 비었을 때
                                room.currentIndex = 0;
                                room.currentTime = 0;
                                room.isEnded = true;
                                io.to(roomCode).emit('update-current-index', room.currentIndex);
                                io.to(roomCode).emit('update-is-ended', { isEnded: room.isEnded });
                            }
                            else if (removingIndex >= room.playlist.length) { // 마지막 곡 삭제했으면, 이전 곡으로 이동
                                room.currentIndex = room.playlist.length - 1;
                                io.to(roomCode).emit('update-current-index', room.currentIndex);

                                io.to(roomCode).emit('play-video-at', { index: room.currentIndex, time: 0, plist: room.playlist  });
                            }
                            else {
                                io.to(roomCode).emit('play-video-at', { index: room.currentIndex, time: 0, plist: room.playlist });
                            }
                        }
                        else if (room.currentIndex > removingIndex) {
                            // 지금 보는 것보다 앞에 있는 곡을 삭제했다면 인덱스를 하나 줄인다
                            room.currentIndex -= 1;
                            io.to(roomCode).emit('update-current-index', { index: room.currentIndex });
                        }

                    }
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

        socket.on('update-is-ended', ({ roomCode, isEnded }) => {
            const room = rooms[roomCode];
            if (!room) return;
            room.isEnded = isEnded;
            socket.to(roomCode).emit('update-is-ended', { isEnded: room.isEnded });
        });

        socket.on('update-current-time', ({ roomCode, time }) => {
            const room = rooms[roomCode];
            if (!room) return;
            room.currentTime = time;
        });

        socket.on('update-current-index', ({ roomCode, index }) => {
            const room = rooms[roomCode];
            if (!room) return;
            room.currentIndex = index;

            io.to(roomCode).emit('update-current-index', { index: room.currentIndex });
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

            io.to(roomCode).emit('play-video-at', { index, time, plist : room.playlist });
        });

        socket.on('request-sync', ({ roomCode }) => {
            const room = rooms[roomCode];
            if (!room) return;
            socket.emit('sync-info', {
                isPlaying: room.isPlaying,
                isEnded: room.isEnded,
                currentTime: room.currentTime,
                currentIndex: room.currentIndex,
                repeatMode: room.repeatMode,
            });
        });
    });
};