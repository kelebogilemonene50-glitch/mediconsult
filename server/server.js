const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// ══════════════════════════════════════════
//  DATABASE SETUP (SQLite)
//  Creates mediconsult.db automatically
// ══════════════════════════════════════════
const db = new Database(path.join(__dirname, '../mediconsult.db'));

// Create tables if they don't exist yet
db.exec(`
  CREATE TABLE IF NOT EXISTS consultations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    doctor_name TEXT,
    patient_name TEXT,
    patient_id TEXT,
    symptoms TEXT,
    started_at TEXT,
    ended_at TEXT,
    duration_seconds INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS consultation_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    sender_name TEXT,
    sender_role TEXT,
    note TEXT,
    sent_at TEXT
  );

  CREATE TABLE IF NOT EXISTS consultation_chat (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    sender_name TEXT,
    sender_role TEXT,
    message TEXT,
    sent_at TEXT
  );

  CREATE TABLE IF NOT EXISTS medical_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT UNIQUE,
    patient_name TEXT,
    record_json TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

console.log('✅ Database ready: mediconsult.db');

// Track rooms and their participants
const rooms = {};
// Track waiting patients and available doctors
const waitingRoom = { patients: [], doctors: [] };
// Store medical records — keyed by patientId
const medicalRecords = {};

io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  // User registers as patient or doctor
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

  // Patient submits their medical record when they join
  socket.on('submit-medical-record', ({ record }) => {
    if (socket.data.role !== 'patient') return;
    // Store in memory for fast access during the session
    medicalRecords[socket.id] = {
      record,
      authorisedDoctors: []
    };
    // Also persist to database so it survives server restarts
    try {
      db.prepare(`
        INSERT OR REPLACE INTO medical_records (patient_id, patient_name, record_json, created_at)
        VALUES (?, ?, ?, ?)
      `).run(socket.id, record.personal?.fullName || 'Unknown', JSON.stringify(record), new Date().toISOString());
      console.log(`Medical record stored in DB for: ${record.personal?.fullName}`);
    } catch(e) {
      console.error('DB error saving record:', e.message);
    }
  });

  // Patient requests a consultation with a specific doctor
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
    console.log(`Patient ${patientName} requesting consult with doctor ${doctorId}`);
  });

  // Doctor accepts consultation — create a secure room with a random token
  socket.on('accept-consultation', ({ patientId }) => {
    // Generate a cryptographically secure random room ID
    const roomToken = crypto.randomBytes(32).toString('hex');
    const roomId = `room-${roomToken}`;

    rooms[roomId] = {
      doctor: socket.id,
      patient: patientId,
      token: roomToken,
      created: Date.now()
    };

    socket.join(roomId);
    socket.data.roomId = roomId;

    // Authorise this doctor to view the patient's medical record
    if (medicalRecords[patientId]) {
      medicalRecords[patientId].authorisedDoctors.push(socket.id);
      console.log(`Doctor ${socket.data.name} authorised for patient ${patientId} records`);
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
    console.log(`Secure room created: ${roomId}`);

    // Save consultation to database
    try {
      db.prepare(`
        INSERT INTO consultations (room_id, doctor_name, patient_name, patient_id, started_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(roomId, socket.data.name, socket.data.pendingPatientName || 'Unknown', patientId, new Date().toISOString());
    } catch(e) {
      console.error('DB error saving consultation:', e.message);
    }
  });

  // Doctor declines
  socket.on('decline-consultation', ({ patientId }) => {
    const patientSocket = io.sockets.sockets.get(patientId);
    if (patientSocket) {
      patientSocket.emit('consultation-declined', { doctorName: socket.data.name });
    }
  });

  // Helper — validate that the socket belongs to this room
  function isRoomMember(roomId) {
    const room = rooms[roomId];
    if (!room) return false;
    return socket.id === room.doctor || socket.id === room.patient;
  }

  // WebRTC signaling — only room members can send these
  socket.on('webrtc-offer', ({ roomId, offer }) => {
    if (!isRoomMember(roomId)) {
      socket.emit('error-msg', 'Unauthorised.');
      return;
    }
    socket.to(roomId).emit('webrtc-offer', { offer, from: socket.id });
  });

  socket.on('webrtc-answer', ({ roomId, answer }) => {
    if (!isRoomMember(roomId)) {
      socket.emit('error-msg', 'Unauthorised.');
      return;
    }
    socket.to(roomId).emit('webrtc-answer', { answer, from: socket.id });
  });

  socket.on('webrtc-ice', ({ roomId, candidate }) => {
    if (!isRoomMember(roomId)) {
      socket.emit('error-msg', 'Unauthorised.');
      return;
    }
    socket.to(roomId).emit('webrtc-ice', { candidate, from: socket.id });
  });

  // Chat message — only room members can chat
  socket.on('chat-message', ({ roomId, message }) => {
    if (!isRoomMember(roomId)) {
      socket.emit('error-msg', 'Unauthorised.');
      return;
    }
    const senderName = socket.data.name;
    const senderRole = socket.data.role;
    const timestamp = new Date().toISOString();
    io.to(roomId).emit('chat-message', {
      from: socket.id,
      name: senderName,
      role: senderRole,
      message,
      timestamp
    });
    // Save to database
    try {
      db.prepare(`
        INSERT INTO consultation_chat (room_id, sender_name, sender_role, message, sent_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(roomId, senderName, senderRole, message, timestamp);
    } catch(e) { console.error('DB chat error:', e.message); }
  });

  // Shared consultation note — sent by doctor or patient, visible to both
  socket.on('send-note', ({ roomId, note }) => {
    if (!isRoomMember(roomId)) {
      socket.emit('error-msg', 'Unauthorised.');
      return;
    }
    const timestamp = new Date().toISOString();
    io.to(roomId).emit('shared-note', {
      from: socket.id,
      name: socket.data.name,
      role: socket.data.role,
      note,
      timestamp
    });
    // Save to database
    try {
      db.prepare(`
        INSERT INTO consultation_notes (room_id, sender_name, sender_role, note, sent_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(roomId, socket.data.name, socket.data.role, note, timestamp);
    } catch(e) { console.error('DB note error:', e.message); }
  });

  // Doctor requests to view patient's medical record during consultation
  socket.on('request-medical-record', ({ patientId }) => {
    if (socket.data.role !== 'doctor') {
      socket.emit('error-msg', 'Access denied. Only doctors can view medical records.');
      return;
    }
    const entry = medicalRecords[patientId];
    if (!entry) {
      socket.emit('medical-record-response', { error: 'No medical record found for this patient.' });
      return;
    }
    if (!entry.authorisedDoctors.includes(socket.id)) {
      socket.emit('error-msg', 'Access denied. You are not authorised to view this patient\'s records.');
      return;
    }
    socket.emit('medical-record-response', { record: entry.record });
    console.log(`Doctor ${socket.data.name} accessed records for patient ${patientId}`);
  });

  // End consultation
  socket.on('end-consultation', ({ roomId }) => {
    if (!isRoomMember(roomId)) return;
    io.to(roomId).emit('consultation-ended', { by: socket.data.name, role: socket.data.role });
    // Save end time to database
    try {
      db.prepare(`
        UPDATE consultations SET ended_at = ? WHERE room_id = ?
      `).run(new Date().toISOString(), roomId);
    } catch(e) { console.error('DB end error:', e.message); }
    if (rooms[roomId]) delete rooms[roomId];
  });

  // Handle disconnect
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
  console.log(`\n✅ MediConsult server running at http://localhost:${PORT}\n`);
});
