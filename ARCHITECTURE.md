# Backend architecture

## Principle
Mobile keeps calling **stable paths** under `/api/caller/*` so Render and local
are interchangeable via frontend `EXPO_PUBLIC_API_BASE_URL` only.

## Layout
```
src/
  modules/
    auth/          # signup, otp, login, password
    profile/       # get-user, edit-profile
    wallet/        # rewards, recharge
    agent|receiver|chat|calls|notifications|uploads|admin/  # stubs
  controllers/     # request handlers
  services/        # business logic
  models/          # mongoose schemas
  middleware/
  shared/          # re-exports for module imports
  app.js
  server.js
```

## Auth paths (implemented)
- POST `/api/caller/signup`
- POST `/api/caller/verify-otp`
- POST `/api/caller/forgot-password`
- POST `/api/caller/create-new-password`
- POST `/api/caller/login`
- GET  `/api/caller/get-user`
- POST `/api/caller/update-password`
- PATCH `/api/caller/edit-profile`
- Wallet reward + recharge routes

Aliased under `/api/auth`, `/api/profile`, `/api/wallet` for future clients.
