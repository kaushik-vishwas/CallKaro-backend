# Callkaro Backend (MongoDB)

Local Express API backed by **MongoDB Atlas**.
Frontend can use this local API **or** your friend's Render API later — switch in frontend `.env`.

## Setup

1. Put Atlas URI in `backend/.env`:
```env
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/callkaro?appName=Cluster0
```

2. Install & run:
```bash
cd backend
npm install
npm run seed
npm run dev
```

Server: `http://localhost:5000/api`

Demo user:
- email: `demo@callkaro.local`
- password: `password123`
- OTP: `1234`

## Manage both APIs (frontend)

In `caller-frontend/.env` use **one** base URL:

```env
# A) Your local backend (this repo)
EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:5000/api

# B) Friend's Render API (when ready)
# EXPO_PUBLIC_API_BASE_URL=https://call-karo-backend.onrender.com/api
```

Then restart Expo: `npx expo start -c`

| Target | When to use |
|--------|-------------|
| Local (`:5000`) | Your MongoDB backend while developing |
| Render URL | When friend's deployed API is ready |

## Auth APIs (same as Render / frontend)

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/caller/signup` | Creates pending user + emails OTP |
| POST | `/api/caller/verify-otp` | Body: `email`, `otp`, optional `flow` (`signup` \| `forgot-password`) |
| POST | `/api/caller/forgot-password` | Emails reset OTP |
| POST | `/api/caller/create-new-password` | After forgot OTP |
| POST | `/api/caller/login` | Returns JWT |
| GET | `/api/caller/get-user` | Bearer token |
| POST | `/api/caller/update-password` | Bearer token |

OTP is **4 digits** (matches the app). Set Gmail in `.env`:
```env
EMAIL_USER=your-email@gmail.com
EMAIL_APP_PASSWORD=your-16-char-app-password
```
If email is not configured, OTP is logged in the server console and `debugOtp` is returned (local only).

## Other endpoints
- Profile: PATCH edit-profile
- Rewards: daily-reward-status, claim-daily-reward
- Recharge: create-order, verify-payment
