# Fluxer Frontend

Vue 3 + Vuetify frontend for AI image generation.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create environment file:
```bash
cp .env.local.example .env.local
```

3. Update `.env.local` with your API URLs:
```
VITE_API_URL=http://localhost:3000/api
VITE_WS_URL=ws://localhost:3000
```

## Development

```bash
npm run dev
```

## Features

- **Home**: Landing page with overview
- **Generate**: Image generation interface with prompt input
- **Gallery**: View and manage generated images
- **Dark/Light theme toggle**
- **Responsive design with Vuetify**

## Tech Stack

- Vue 3 with Composition API
- TypeScript
- Vuetify 3 (Material Design)
- Vite
- Pinia (state management)
- Vue Router