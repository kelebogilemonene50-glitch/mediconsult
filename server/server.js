const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// ══════════════════════════════════════════
//  IN-MEMORY STORAGE
//  (Data lives as long as server is running)
// ══════════════════════════════════════════
const rooms = {};
const waitingRoom = { patients: [], doctors: [] };
const medicalRecords = {};

// Consultation history stored in memory
const consultationLog = [];

io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  socket.on('register', ({ role, name, speciality }) => {
    socket.data.role = role;
    socket.data.name = name;
    socket.data.speciality = speciality || null;

    if (role === 'doctor') {
      waitingRoom.doctors.push({ id: socket.id, name, speciality });
      io.emit('doctors-updated', waitingRoom.doctors);
      console.log(`Doctor registered: ${name}`);
    } else {
      io.emit('doctors-updated', waitingRoom.doctors);
    }
  });

  socket.on('submit-medical-record', ({ record }) => {
    if (socket.data.role !== 'patient') return;
    medicalRecords[socket.id] = {
      record,
      authorisedDoctors: []
    };
    console.log(`Medical record stored for: ${record.personal?.fullName}`);
  });

  socket.on('request-consultation', ({ doctorId, patientName, symptoms }) => {
    const doctorSocket = io.sockets.sockets.get(doctorId);
    if (!doctorSocket) {
      socket.emit('error-msg', 'Doctor is no longer available.');
      return;
    }
    doctorSocket.emit('incoming-consultation', {
      patientId: socket.id,
      patientName,
      symptoms
    });
    doctorSocket.data.pendingPatientName = patientName;
    socket.emit('waiting-for-doctor', { doctorId });
    console.log(`Patient ${patientName} requesting consult with ${doctorId}`);
  });

  socket.on('accept-consultation', ({ patientId }) => {
    const roomToken = crypto.randomBytes(32).toString('hex');
    const roomId = `room-${roomToken}`;

    rooms[roomId] = {
      doctor: socket.id,
      patient: patientId,
      token: roomToken,
      created: new Date().toISOString(),
      doctorName: socket.data.name,
      patientName: socket.data.pendingPatientName || 'Unknown'
    };

    socket.join(roomId);
    socket.data.roomId = roomId;

    if (medicalRecords[patientId]) {
      medicalRecords[patientId].authorisedDoctors.push(socket.id);
    }

    const patientSocket = io.sockets.sockets.get(patientId);
    if (patientSocket) {
      patientSocket.join(roomId);
      patientSocket.data.roomId = roomId;
      patientSocket.emit('consultation-accepted', {
        roomId,
        roomToken,
        doctorName: socket.data.name
      });
    }

    socket.emit('consultation-ready', { roomId, roomToken });

    // Log consultation start
    consultationLog.push({
      roomId,
      doctorName: socket.data.name,
      patientName: socket.data.pendingPatientName || 'Unknown',
      startedAt: new Date().toISOString(),
      endedAt: null,
      notes: [],
      chat: []
    });

    console.log(`Room created: ${roomId}`);
  });

  socket.on('decline-consultation', ({ patientId }) => {
    const patientSocket = io.sockets.sockets.get(patientId);
    if (patientSocket) {
      patientSocket.emit('consultation-declined', { doctorName: socket.data.name });
    }
  });

  function isRoomMember(roomId) {
    const room = rooms[roomId];
    if (!room) return false;
    return socket.id === room.doctor || socket.id === room.patient;
  }

  socket.on('webrtc-offer', ({ roomId, offer }) => {
    if (!isRoomMember(roomId)) { socket.emit('error-msg', 'Unauthorised.'); return; }
    socket.to(roomId).emit('webrtc-offer', { offer, from: socket.id });
  });

  socket.on('webrtc-answer', ({ roomId, answer }) => {
    if (!isRoomMember(roomId)) { socket.emit('error-msg', 'Unauthorised.'); return; }
    socket.to(roomId).emit('webrtc-answer', { answer, from: socket.id });
  });

  socket.on('webrtc-ice', ({ roomId, candidate }) => {
    if (!isRoomMember(roomId)) { socket.emit('error-msg', 'Unauthorised.'); return; }
    socket.to(roomId).emit('webrtc-ice', { candidate, from: socket.id });
  });

  socket.on('chat-message', ({ roomId, message }) => {
    if (!isRoomMember(roomId)) { socket.emit('error-msg', 'Unauthorised.'); return; }
    const timestamp = new Date().toISOString();
    io.to(roomId).emit('chat-message', {
      from: socket.id,
      name: socket.data.name,
      role: socket.data.role,
      message,
      timestamp
    });
    // Log to memory
    const log = consultationLog.find(c => c.roomId === roomId);
    if (log) log.chat.push({ name: socket.data.name, role: socket.data.role, message, timestamp });
  });

  socket.on('send-note', ({ roomId, note }) => {
    if (!isRoomMember(roomId)) { socket.emit('error-msg', 'Unauthorised.'); return; }
    const timestamp = new Date().toISOString();
    io.to(roomId).emit('shared-note', {
      from: socket.id,
      name: socket.data.name,
      role: socket.data.role,
      note,
      timestamp
    });
    // Log to memory
    const log = consultationLog.find(c => c.roomId === roomId);
    if (log) log.notes.push({ name: socket.data.name, role: socket.data.role, note, timestamp });
  });

  socket.on('request-medical-record', ({ patientId }) => {
    if (socket.data.role !== 'doctor') {
      socket.emit('error-msg', 'Access denied.');
      return;
    }
    const entry = medicalRecords[patientId];
    if (!entry) {
      socket.emit('medical-record-response', { error: 'No medical record found.' });
      return;
    }
    if (!entry.authorisedDoctors.includes(socket.id)) {
      socket.emit('error-msg', 'You are not authorised to view this record.');
      return;
    }
    socket.emit('medical-record-response', { record: entry.record });
  });

  socket.on('end-consultation', ({ roomId }) => {
    if (!isRoomMember(roomId)) return;
    io.to(roomId).emit('consultation-ended', { by: socket.data.name, role: socket.data.role });
    const log = consultationLog.find(c => c.roomId === roomId);
    if (log) log.endedAt = new Date().toISOString();
    if (rooms[roomId]) delete rooms[roomId];
  });

  socket.on('disconnect', () => {
    if (socket.data.role === 'doctor') {
      waitingRoom.doctors = waitingRoom.doctors.filter(d => d.id !== socket.id);
      io.emit('doctors-updated', waitingRoom.doctors);
    }
    if (socket.data.roomId) {
      socket.to(socket.data.roomId).emit('peer-disconnected', { name: socket.data.name });
      delete rooms[socket.data.roomId];
    }
    console.log(`Disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n✅ MediConsult running at http://localhost:${PORT}\n`);
});
