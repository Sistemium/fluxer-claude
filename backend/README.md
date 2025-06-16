# Fluxer Backend

Koa.js + TypeScript backend API for AI image generation.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create environment file:
```bash
cp .env.local.example .env.local
```

3. Update `.env.local` with your configuration:
```bash
# MongoDB Atlas
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/fluxer

# Redis (your existing server)
REDIS_URL=redis://localhost:6379

# SuperTokens
SUPERTOKENS_API_KEY=your_supertokens_api_key

# AWS S3
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
```

## Development

```bash
npm run dev
```

## API Endpoints

### Authentication (SuperTokens)
- `POST /auth/signin` - Sign in
- `POST /auth/signup` - Sign up
- `POST /auth/signout` - Sign out

### Generation
- `POST /api/generate` - Queue image generation
- `GET /api/generate/status/:jobId` - Get job status

### Images
- `GET /api/images` - Get user images
- `GET /api/images/:id` - Get specific image
- `DELETE /api/images/:id` - Delete image

### User
- `GET /api/users/profile` - Get user profile
- `GET /api/users/stats` - Get user statistics

## Tech Stack

- Koa.js with TypeScript
- MongoDB Atlas with Mongoose
- Redis + Bull (job queue)
- SuperTokens (authentication)
- Winston (logging)
- Joi (validation)