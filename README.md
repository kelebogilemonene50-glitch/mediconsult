# MediConsult — Real-Time Virtual Consultation System

A fully working WebRTC-based telemedicine platform. Patients and doctors connect in real-time video consultations directly in the browser — no plugins, no third-party video service.

---

## How it works

```
Patient              Signaling Server         Doctor
   |                  (Socket.io)               |
   |-- register ------>|                        |
   |                   |<------- register ------|
   |<-- doctors-list --|                        |
   |                   |                        |
   |-- request-consult->|-- incoming-consult -->|
   |                   |                        |
   |<-- waiting -----  |<------- accept --------|
   |                   |                        |
   |<-- room-id -------|-- room-id ------------>|
   |                   |                        |
   |<========= WebRTC P2P (video/audio) =======>|
   |<========= Socket.io (signaling/chat) =====>|
```

The signaling server handles room coordination and relays WebRTC offers/answers/ICE candidates. Once connected, all video/audio is **peer-to-peer** — it never passes through the server.

---

## Quick Start

### 1. Install dependencies
```bash
cd teleconsult
npm install
```

### 2. Start the server
```bash
npm start
```

Server runs at: **http://localhost:3000**

### 3. Open two browser tabs (or two devices on the same network)

**Tab 1 — Doctor:**
- Open http://localhost:3000
- Select "I'm a Doctor"
- Enter your name and speciality
- Click **Join Now**
- Toggle availability **ON**

**Tab 2 — Patient:**
- Open http://localhost:3000
- Select "I'm a Patient"
- Enter your name
- Click **Join Now**
- Describe symptoms
- Select the doctor from the list
- Click **Request Consultation →**

The doctor gets an incoming request notification → accepts → both enter the video room.

---

## Features

| Feature | Status |
|---------|--------|
| Real-time video call (WebRTC) | ✅ |
| Audio (mic on/off) | ✅ |
| Camera (on/off) | ✅ |
| Screen sharing | ✅ |
| Live in-call chat | ✅ |
| Consultation notes (private) | ✅ |
| Call timer | ✅ |
| Doctor availability toggle | ✅ |
| Symptom submission before call | ✅ |
| Incoming call notification | ✅ |
| Auto-cleanup on disconnect | ✅ |

---

## Deploying to production

For production, replace the STUN servers in `index.html` with a TURN server (required for users behind strict NAT/firewalls):

```javascript
const config = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:your-turn-server.com:3478',
      username: 'your-username',
      credential: 'your-password'
    }
  ]
};
```

Free TURN server options: **Metered.ca**, **Twilio Network Traversal**, **Xirsys**

### Deploy on Railway / Render / Heroku
```bash
# Set PORT environment variable — the server uses process.env.PORT automatically
npm start
```

Update `SOCKET_URL` in `index.html` if frontend and backend are on different domains:
```javascript
const SOCKET_URL = 'https://your-server.railway.app';
```

---

## File Structure

```
teleconsult/
├── package.json
├── server/
│   └── server.js        ← Node.js + Socket.io signaling server
└── public/
    └── index.html       ← Full frontend (WebRTC + UI)
```

---

## Adding the AI Assistant (next step)

The consultation room has a `side-panel` with chat and notes. To plug in your AI assistant:
1. Add a "Ask AI" button in the side panel
2. POST the symptom text + chat history to your AI endpoint
3. Render the response in a separate "AI suggestions" section

The server already has `socket.on('chat-message')` — you can hook an AI bot into that event.
