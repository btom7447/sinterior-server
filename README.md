# Sintherior — Server

The Express.js REST API backend for **Sintherior**, a marketplace connecting verified artisans, trusted suppliers, and clients across the Nigerian construction and interior design industry.

---

## Tech Stack

| Layer            | Technology                                        |
| ---------------- | ------------------------------------------------- |
| Runtime          | Node.js 22                                        |
| Framework        | Express 4.19                                      |
| Database         | MongoDB (Mongoose 8.4 ODM)                        |
| Authentication   | JWT (access + refresh tokens), bcryptjs            |
| File Uploads     | Multer + Sharp (resize to 400x400 WebP)           |
| Validation       | express-validator                                 |
| Real-Time        | Socket.IO (chat, typing indicators, presence)     |
| Security         | Helmet, CORS, express-mongo-sanitize, HPP         |
| Rate Limiting    | express-rate-limit                                |
| Logging          | Morgan                                            |
| Module System    | ES Modules (`"type": "module"`)                   |

---

## Getting Started

### Prerequisites

- Node.js 22+ (with npm >= 9)
- MongoDB instance (local or Atlas)

### Install

```bash
cd server
npm install
```

### Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable                | Description                              | Default         |
| ----------------------- | ---------------------------------------- | --------------- |
| `NODE_ENV`              | `development`, `production`, or `test`   | `development`   |
| `PORT`                  | Server port                              | `5000`          |
| `CLIENT_URL`            | Frontend URL (CORS origin)               | `http://localhost:3000` |
| `MONGO_URI`             | MongoDB connection string                | —               |
| `JWT_ACCESS_SECRET`     | Access token secret (min 64 chars)       | —               |
| `JWT_REFRESH_SECRET`    | Refresh token secret (min 64 chars)      | —               |
| `JWT_ACCESS_EXPIRES_IN` | Access token TTL                         | `15m`           |
| `JWT_REFRESH_EXPIRES_IN`| Refresh token TTL                        | `7d`            |
| `UPLOAD_DIR`            | Directory for uploaded files             | `uploads`       |
| `MAX_FILE_SIZE_MB`      | Max upload size in MB                    | `5`             |
| `SMTP_HOST`             | SMTP server hostname                     | —               |
| `SMTP_PORT`             | SMTP port                                | `587`           |
| `SMTP_USER`             | SMTP username                            | —               |
| `SMTP_PASS`             | SMTP password                            | —               |
| `EMAIL_FROM`            | Sender email display                     | —               |
| `RATE_LIMIT_WINDOW_MS`  | Rate limit window                        | `900000` (15m)  |
| `RATE_LIMIT_MAX`        | Max requests per window                  | `100`           |
| `AUTH_RATE_LIMIT_MAX`   | Max auth requests per window             | `10`            |

### Development

```bash
npm run dev
```

Runs with nodemon on `http://localhost:5000`. Health check at `/health`.

### Production

```bash
npm start
```

---

## Project Structure

```
server.js                       # Entry point — env validation, DB connect, Socket.IO attach, graceful shutdown
src/
├── app.js                      # Express setup — middleware stack, route registration, error handling
├── config/
│   ├── db.js                   # MongoDB connection via Mongoose
│   └── env.js                  # Environment variable validation & config object
├── controllers/
│   ├── auth.controller.js      # Login, register, refresh, password reset/change
│   ├── profile.controller.js   # Profile CRUD, avatar upload
│   ├── artisan.controller.js   # Artisan listing, detail, nearby search, onboarding
│   ├── supplier.controller.js  # Supplier onboarding, profile
│   ├── product.controller.js   # Product CRUD & search
│   ├── property.controller.js  # Property CRUD & search
│   ├── order.controller.js     # Order creation, status updates
│   ├── job.controller.js       # Job posting, status transitions
│   ├── project.controller.js   # Project management
│   ├── appointment.controller.js # Appointment scheduling
│   ├── chat.controller.js      # Conversations, messages, user search, chat access control
│   ├── notification.controller.js # Notification management
│   ├── review.controller.js    # Review submission & retrieval
│   ├── bookmark.controller.js  # Save/unsave items
│   └── dashboard.controller.js # Dashboard stats & recent orders
├── middleware/
│   ├── auth.js                 # JWT verification, role-based access (protect, authorize)
│   ├── errorHandler.js         # Global error handler with status codes
│   ├── rateLimiter.js          # General & auth-specific rate limiting
│   ├── upload.js               # Multer config + Sharp image processing
│   └── validate.js             # express-validator middleware
├── models/
│   ├── User.js                 # User accounts (email, password, role, refresh tokens)
│   ├── Profile.js              # User profiles (name, avatar, phone, bio, city, state, settings)
│   ├── ArtisanProfile.js       # Artisan-specific (skill, portfolio, certs, location, rates)
│   ├── SupplierProfile.js      # Supplier-specific (business info, delivery, banking)
│   ├── Product.js              # Marketplace products
│   ├── Property.js             # Real estate listings
│   ├── Order.js                # Customer orders
│   ├── OrderItem.js            # Individual order line items
│   ├── Job.js                  # Job postings between clients & artisans
│   ├── Project.js              # Project tracking
│   ├── Appointment.js          # Scheduled appointments
│   ├── Message.js              # Chat messages
│   ├── Notification.js         # User notifications
│   ├── Review.js               # Ratings & reviews
│   ├── Bookmark.js             # Saved items / wishlists
│   └── ContactInquiry.js       # Contact form submissions
├── routes/
│   ├── auth.routes.js          # POST /login, /register, /refresh, /logout, /forgot-password, etc.
│   ├── profile.routes.js       # GET/PATCH /profiles/me, POST /profiles/me/avatar
│   ├── artisan.routes.js       # GET /artisans, /artisans/nearby, /artisans/:id, PATCH /onboarding
│   ├── supplier.routes.js      # GET /suppliers/me, PATCH /suppliers/onboarding
│   ├── product.routes.js       # CRUD /products
│   ├── property.routes.js      # CRUD /properties
│   ├── order.routes.js         # POST /orders, GET /orders, PATCH /orders/:id/status
│   ├── job.routes.js           # CRUD /jobs, PATCH /jobs/:id/status
│   ├── project.routes.js       # CRUD /projects
│   ├── appointment.routes.js   # CRUD /appointments
│   ├── chat.routes.js          # GET /chat/conversations, /chat/messages, /chat/search, POST /chat/messages
│   ├── notification.routes.js  # GET /notifications, PATCH /notifications/:id/read, mark-all-read
│   ├── review.routes.js        # GET/POST /reviews
│   ├── bookmark.routes.js      # GET/POST/DELETE /bookmarks
│   ├── dashboard.routes.js     # GET /dashboard/stats, /dashboard/recent-orders
│   └── contact.routes.js       # POST /contact
└── utils/
    ├── AppError.js             # Custom error class (statusCode, message, isOperational)
    ├── apiResponse.js          # Standardized { status, data, message } response helper
    ├── asyncHandler.js         # Async route wrapper (catches errors → next())
    ├── generateTokens.js       # JWT access & refresh token generation
    └── paginate.js             # Pagination helper ({ page, limit, total, pages })
├── socket.js                   # Socket.IO — JWT auth, chat events, typing, presence, access control
```

---

## API Overview

All routes are prefixed with `/api/v1/`.

### Authentication

| Method | Endpoint                          | Auth | Description                    |
| ------ | --------------------------------- | ---- | ------------------------------ |
| POST   | `/auth/register`                  | No   | Create account                 |
| POST   | `/auth/login`                     | No   | Sign in, returns access token  |
| POST   | `/auth/refresh`                   | Cookie | Refresh access token          |
| POST   | `/auth/logout`                    | Yes  | Invalidate refresh token       |
| GET    | `/auth/me`                        | Yes  | Get current user + profile     |
| POST   | `/auth/forgot-password`           | No   | Send password reset email      |
| POST   | `/auth/reset-password/:token`     | No   | Set new password               |
| POST   | `/auth/change-password`           | Yes  | Change password (returns new token) |

### Profiles

| Method | Endpoint                    | Auth | Description                    |
| ------ | --------------------------- | ---- | ------------------------------ |
| GET    | `/profiles/me`              | Yes  | Get own profile                |
| PATCH  | `/profiles/me`              | Yes  | Update profile fields          |
| POST   | `/profiles/me/avatar`       | Yes  | Upload avatar (multipart)      |
| GET    | `/profiles/me/settings`     | Yes  | Get user settings              |
| PATCH  | `/profiles/me/settings`     | Yes  | Update settings (toggles)      |

### Artisans

| Method | Endpoint                    | Auth | Description                              |
| ------ | --------------------------- | ---- | ---------------------------------------- |
| GET    | `/artisans`                 | No   | List artisans (search, category, page)   |
| GET    | `/artisans/nearby`          | No   | Geo-based artisan search (lat, lng, radius) |
| GET    | `/artisans/:id`             | No   | Artisan detail with profile              |
| PATCH  | `/artisans/onboarding`      | Yes  | Update artisan onboarding data           |
| PATCH  | `/artisans/location`        | Yes  | Update artisan geo location              |
| POST   | `/artisans/portfolio`       | Yes  | Upload portfolio images (multipart)      |
| POST   | `/artisans/certifications`  | Yes  | Upload certification file (multipart)    |

### Suppliers

| Method | Endpoint                    | Auth     | Description                  |
| ------ | --------------------------- | -------- | ---------------------------- |
| GET    | `/suppliers/me`             | Supplier | Get own supplier profile     |
| PATCH  | `/suppliers/onboarding`     | Supplier | Update supplier onboarding   |
| POST   | `/suppliers/logo`           | Supplier | Upload supplier logo         |

### Products

| Method | Endpoint            | Auth     | Description              |
| ------ | ------------------- | -------- | ------------------------ |
| GET    | `/products`         | No       | List/search products     |
| GET    | `/products/:id`     | No       | Product detail           |
| POST   | `/products`         | Supplier | Create product           |
| PATCH  | `/products/:id`     | Supplier | Update product           |
| DELETE | `/products/:id`     | Supplier | Delete product           |

### Properties

| Method | Endpoint              | Auth | Description              |
| ------ | --------------------- | ---- | ------------------------ |
| GET    | `/properties`         | No   | List/search properties   |
| GET    | `/properties/:id`     | No   | Property detail          |
| POST   | `/properties`         | Yes  | Create listing           |
| PATCH  | `/properties/:id`     | Yes  | Update listing           |
| DELETE | `/properties/:id`     | Yes  | Delete listing           |

### Orders

| Method | Endpoint                    | Auth | Description              |
| ------ | --------------------------- | ---- | ------------------------ |
| GET    | `/orders`                   | Yes  | List own orders          |
| POST   | `/orders`                   | Yes  | Create order             |
| GET    | `/orders/:id`               | Yes  | Order detail             |
| PATCH  | `/orders/:id/status`        | Yes  | Update order status      |

### Jobs

| Method | Endpoint                  | Auth | Description              |
| ------ | ------------------------- | ---- | ------------------------ |
| GET    | `/jobs`                   | Yes  | List own jobs            |
| POST   | `/jobs`                   | Yes  | Create job               |
| GET    | `/jobs/:id`               | Yes  | Job detail               |
| PATCH  | `/jobs/:id/status`        | Yes  | Update job status        |

### Chat

| Method | Endpoint                         | Auth | Description                              |
| ------ | -------------------------------- | ---- | ---------------------------------------- |
| GET    | `/chat/conversations`            | Yes  | List conversations                       |
| GET    | `/chat/messages/:conversationId` | Yes  | Messages in a conversation               |
| POST   | `/chat/messages`                 | Yes  | Send message (requires job/order access) |
| GET    | `/chat/search?email=`            | Yes  | Search user by email for chat            |

### Notifications

| Method | Endpoint                         | Auth | Description              |
| ------ | -------------------------------- | ---- | ------------------------ |
| GET    | `/notifications`                 | Yes  | List notifications       |
| PATCH  | `/notifications/:id/read`        | Yes  | Mark one as read         |
| PATCH  | `/notifications/mark-all-read`   | Yes  | Mark all as read         |

### Reviews

| Method | Endpoint       | Auth | Description              |
| ------ | -------------- | ---- | ------------------------ |
| GET    | `/reviews`     | No   | List reviews (by artisan)|
| POST   | `/reviews`     | Yes  | Submit a review          |

### Bookmarks

| Method | Endpoint           | Auth | Description              |
| ------ | ------------------ | ---- | ------------------------ |
| GET    | `/bookmarks`       | Yes  | List saved items         |
| POST   | `/bookmarks`       | Yes  | Save an item             |
| DELETE | `/bookmarks/:id`   | Yes  | Remove bookmark          |

### Dashboard

| Method | Endpoint                      | Auth | Description                    |
| ------ | ----------------------------- | ---- | ------------------------------ |
| GET    | `/dashboard/stats`            | Yes  | Role-specific summary stats    |
| GET    | `/dashboard/recent-orders`    | Yes  | Recent orders for dashboard    |

### Other

| Method | Endpoint     | Auth | Description              |
| ------ | ------------ | ---- | ------------------------ |
| POST   | `/contact`   | No   | Submit contact form      |
| GET    | `/health`    | No   | Server health check      |

---

## Socket.IO Events (Real-Time Chat)

The server attaches Socket.IO to the HTTP server. Clients authenticate via `auth.token` on connection.

| Event (Client → Server)  | Payload                              | Description                        |
| ------------------------ | ------------------------------------ | ---------------------------------- |
| `message:send`           | `{ receiverId, content }`            | Send message (returns ack with message or error) |
| `message:read`           | `{ conversationId }`                 | Mark messages in conversation as read |
| `typing:start`           | `{ conversationId }`                 | Notify typing started              |
| `typing:stop`            | `{ conversationId }`                 | Notify typing stopped              |
| `user:check-online`      | `{ profileIds: string[] }`           | Check online status (returns callback) |

| Event (Server → Client)  | Payload                              | Description                        |
| ------------------------ | ------------------------------------ | ---------------------------------- |
| `message:new`            | `ChatMessage`                        | New message received               |
| `conversation:updated`   | `{ conversationId, lastMessage, participant }` | Conversation list update  |
| `message:read`           | `{ conversationId }`                 | Read receipt notification          |
| `typing:start`           | `{ conversationId }`                 | Other user started typing          |
| `typing:stop`            | `{ conversationId }`                 | Other user stopped typing          |
| `user:online`            | `{ profileId }`                      | User came online                   |
| `user:offline`           | `{ profileId }`                      | User went offline                  |

### Chat Access Control

Users can only message each other if they share a **Job** (client ↔ artisan) or an **Order** (buyer ↔ supplier). The `canChat()` check runs on both the REST endpoint and the Socket.IO `message:send` event.

---

## Authentication Flow

1. **Register/Login** — returns JWT access token in response body + sets httpOnly refresh cookie
2. **Access token** — short-lived (15m default), sent as `Authorization: Bearer <token>`
3. **Refresh token** — long-lived (7d default), stored as httpOnly cookie, used to get new access token via `POST /auth/refresh`
4. **Password hashing** — bcryptjs with salt rounds
5. **Role-based access** — `protect` middleware verifies JWT, `authorize('artisan', 'supplier')` restricts by role

## File Uploads

- Multer handles multipart form data (disk storage)
- Sharp resizes images to 400x400 and converts to WebP
- Files stored in `/{UPLOAD_DIR}/{uuid}.webp`
- Static file serving via `express.static`

## Error Handling

- `AppError` class for operational errors with HTTP status codes
- `asyncHandler` wraps async routes to forward errors
- Global `errorHandler` middleware returns consistent `{ status: 'error', message }` responses
- MongoDB validation errors and duplicate key errors are handled gracefully

---

## Scripts

| Command         | Description                    |
| --------------- | ------------------------------ |
| `npm run dev`   | Start with nodemon (hot reload)|
| `npm start`     | Start production server        |
| `npm run lint`  | Run ESLint                     |
