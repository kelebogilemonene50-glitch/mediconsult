# MediConsult — GitHub & Deployment Guide
### How to put it on GitHub so anyone, anywhere can use it

---

## PART 1 — Put the project on GitHub

### Step 1 — Create a GitHub account
Go to **github.com** and sign up for a free account if you don't have one.

---

### Step 2 — Create a new repository
1. Click the **+** button at the top right of GitHub
2. Click **New repository**
3. Name it: `mediconsult`
4. Set it to **Private** (so only your team can see the code)
5. Click **Create repository**

---

### Step 3 — Install Git on your computer
Go to **git-scm.com** and download Git. Install it like a normal program.

---

### Step 4 — Open VS Code terminal and run these commands one by one

First, go into your MediConsult folder:
```
cd Desktop/MediConsult
```

Then run these commands in order:

```
git init
```
*(sets up Git in your folder)*

```
git add .
```
*(selects all your files)*

```
git commit -m "Initial commit — MediConsult virtual consultation system"
```
*(saves a snapshot of your code)*

```
git branch -M main
```
*(names your main branch)*

```
git remote add origin https://github.com/YOUR-USERNAME/mediconsult.git
```
*(links your folder to GitHub — replace YOUR-USERNAME with your actual GitHub username)*

```
git push -u origin main
```
*(uploads your code to GitHub)*

GitHub will ask for your username and password. Use your GitHub credentials.

✅ Your code is now on GitHub.

---

### Step 5 — Create a .gitignore file BEFORE pushing (important)
In your MediConsult folder, create a file called `.gitignore` and put this inside it:

```
node_modules/
mediconsult.db
.env
```

This stops the database and node_modules from being uploaded (they don't need to be).

---

## PART 2 — Deploy so anyone can use it (Railway)

### Step 1 — Go to Railway
Go to **railway.app** and sign up using your GitHub account.

---

### Step 2 — Create a new project
1. Click **New Project**
2. Click **Deploy from GitHub repo**
3. Select your `mediconsult` repo
4. Railway will detect it automatically and start deploying

---

### Step 3 — Set the start command
Railway needs to know how to run your app.
1. Click on your project
2. Go to **Settings**
3. Under **Start Command**, type:
```
node server/server.js
```

---

### Step 4 — Get your live URL
1. Go to **Settings → Networking**
2. Click **Generate Domain**
3. Railway gives you a URL like:
```
https://mediconsult-production.up.railway.app
```

**That URL is your live app.** Anyone in the world can open it.

---

### Step 5 — Update SOCKET_URL in index.html
Open `public/index.html` and find this line:
```javascript
const SOCKET_URL = window.location.origin;
```
Leave this as is — `window.location.origin` automatically uses whatever URL the app is running on. No change needed.

---

### Step 6 — Add a TURN server for video across all networks

Go to **metered.ca** → sign up free → go to **TURN Credentials**.

Copy your credentials, then open `public/index.html` and find:
```javascript
const config = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};
```

Replace with:
```javascript
const config = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:YOUR-METERED-URL:3478',
      username: 'YOUR-METERED-USERNAME',
      credential: 'YOUR-METERED-PASSWORD'
    }
  ]
};
```

Then push the update to GitHub:
```
git add .
git commit -m "Add TURN server for global video"
git push
```

Railway automatically redeploys when you push to GitHub.

---

## PART 3 — How your team connects for the demo

1. One person runs the server (or it's on Railway)
2. Everyone opens the same URL in their browser
3. One person joins as **Doctor** — enters name and speciality
4. Another person joins as **Patient** — enters name **Keile Bugrile** to load the dummy medical record
5. Patient describes symptoms and selects the doctor
6. Doctor accepts — both are in a live video consultation
7. Doctor clicks **View Patient Medical Record** to see Keile's full record
8. Both can send notes back and forth
9. Everything is saved to the database automatically

---

## What the database saves

Every time a consultation happens, the system saves:
- Who the doctor was and who the patient was
- When the consultation started and ended
- Every chat message sent during the call
- Every note sent during the call
- The patient's medical record

The database file is called `mediconsult.db` and lives inside your project folder.

---

## Summary of all the commands you need

| What you want to do | Command |
|---|---|
| Run locally | `npm install` then `npm start` |
| Push updates to GitHub | `git add . && git commit -m "update" && git push` |
| Check if server is running | Open `http://localhost:3000` |
| Check live deployment | Open your Railway URL |
