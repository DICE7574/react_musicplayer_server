// 데이터 저장소
let rooms = {};
let nextSongId = 1;

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
        res.send(JSON.stringify(rooms, null, 2)); // 들여쓰기 2칸
    });

    app.post('/room/create', (req, res) => {
        const { roomTitle } = req.body;
        const roomCode = generateInviteCode();
        rooms[roomCode] = {
            roomName: roomTitle,
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
            if (rooms[roomCode]) {
                const alreadyConnected = rooms[roomCode].members.some(m => m.id === socket.id);
                if (!alreadyConnected) {
                    rooms[roomCode].members.push({ id: socket.id, name: userName });
                    socket.join(roomCode);
                    io.to(roomCode).emit('update-members', rooms[roomCode].members.map(m => m.name));
                }
                callback({ success: true });
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
                        id: nextSongId++,
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

    });
};