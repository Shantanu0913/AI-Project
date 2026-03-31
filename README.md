# Smart Parking Finder — GPS & A* Algorithm

AI-powered parking finder using GPS geolocation and A* pathfinding algorithm for optimal parking discovery.

## Project Structure

```
Parking/
├── frontend/                    # All frontend code
│   ├── AStarProject/           # Main parking app (vanilla HTML/JS/CSS)
│   │   ├── index.html          # App entry point
│   │   ├── script.js           # Core logic, A*, SRM KTR data
│   │   └── style.css           # Premium dark theme styles
│   ├── src/                    # React/Vite app
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   ├── public/                 # Static assets
│   ├── index.html              # Vite entry
│   ├── package.json            # Frontend dependencies
│   ├── vite.config.js          # Vite config
│   └── eslint.config.js        # ESLint config
├── backend/                    # Backend API server
│   ├── server.js               # Express server (port 5000)
│   └── package.json            # Backend dependencies
├── package.json                # Root workspace scripts
├── .gitignore
└── README.md
```

## Quick Start

### Install all dependencies
```bash
npm run install:all
```

### Run backend only
```bash
cd backend && npm run dev
```

### Run both frontend & backend
```bash
npm run dev
```

### Open the parking app directly
Open `frontend/AStarProject/index.html` in your browser.

## Features
- 🗺️ GPS-based parking search with Leaflet maps
- 🤖 A* pathfinding algorithm with animated visualization
- 🏍️ Vehicle type preference (Car / Two-Wheeler)
- 📍 SRM KTR campus — hardcoded real parking zones
- 🅿️ Slot reservation with visual feedback
- 🌙 Premium dark UI theme
