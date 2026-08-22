# StudyRoom

A virtual co-studying platform that brings video calling, chat, shared music, notes, and games together in one space — built to be a single hangout for studying with friends instead of juggling Zoom, Discord, and separate note apps.

**Live demo:** [studyroom-1dwm.onrender.com/dashboard](https://studyroom-1dwm.onrender.com/dashboard)

## Features

- **Video calling** — real-time peer-to-peer video via WebRTC, so you can see and study with others live
- **Community chat** — real-time text chat alongside the video room
- **Shared music (Chip bot)** — a shared music bot so everyone in the room listens together
- **Game sandbox** — casual games built into the room for study breaks
- **Collaborative notes** — shared, editable notes within a room
- **Media management** — handling and organizing shared media inside a session

## Tech Stack

- **Runtime:** [Bun](https://bun.sh)
- **Backend:** Express 5, Socket.io (real-time communication)
- **Database:** PostgreSQL (via `pg`) with Supabase, plus MongoDB (via Mongoose)
- **Auth:** JSON Web Tokens (`jsonwebtoken`) with `bcryptjs` for password hashing
- **Other:** Axios, CORS, dotenv, UUID
- **Language:** TypeScript

## Project Structure

```
StudyRoom/
├── migrations/     # Database migrations
├── public/         # Static frontend assets
├── server/         # Express + Socket.io backend
├── schema.sql      # Database schema
├── index.ts        # Entry point
├── Dockerfile      # Container build config
└── package.json
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) installed
- A PostgreSQL/Supabase instance (and/or MongoDB, depending on which data layer you're running)

### Installation

```bash
# Clone the repo
git clone https://github.com/rat-sh/StudyRoom.git
cd StudyRoom

# Install dependencies
bun install
```

### Environment Variables

Create a `.env` file in the project root with the values your Supabase/Postgres/Mongo and auth setup need, for example:

```env
PORT=3000
DATABASE_URL=your_postgres_connection_string
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
```

### Running locally

```bash
# Development (auto-restart on changes)
bun run dev

# Production
bun run start
```

The app will be available at `http://localhost:3000` (or whichever `PORT` you set).

### Database setup

Apply `schema.sql` and any files in `migrations/` to your database before starting the server.

## Deployment

The project includes a `Dockerfile` for containerized deployment. The live instance is deployed on Render.

## License

No license specified yet.
