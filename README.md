# BeverageAI DZ - Enterprise Beverage Formulation Platform

Production-ready MVP for intelligent beverage formulation and optimization, designed for industrial scale.

## Scale Requirements

- **1,200+ ingredients** with comprehensive attributes
- **100,000+ formulations** with unlimited versioning
- **5-40 ingredients per formulation** with 0.01% precision
- **1.4M+ ingredient compatibility evaluations**
- **Multi-tenant enterprise usage**

## Tech Stack

- **Frontend**: React + TypeScript + Tailwind CSS
- **Backend**: Node.js + Fastify
- **Database**: PostgreSQL (optimized with indexes)
- **AI Services**: Modularized architecture (mock logic for MVP)

## Project Structure

```
├── backend/
│   ├── src/
│   │   ├── server.js          # Fastify server setup
│   │   ├── routes/            # API route handlers
│   │   ├── services/          # Business logic
│   │   ├── models/            # Data models
│   │   └── db/               # Database connection & migrations
│   └── database/
│       └── schema.sql        # PostgreSQL schema with indexes
├── frontend/
│   ├── src/
│   │   ├── components/       # React components
│   │   ├── pages/           # Page components
│   │   ├── services/        # API clients
│   │   └── types/           # TypeScript types
│   └── public/
└── README.md
```

## Setup Instructions

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- npm or yarn

### Installation

1. **Install dependencies:**
   ```bash
   npm run install:all
   ```

2. **Set up database:**
   ```bash
   # Create database
   createdb beverageai_dz

   # Run migrations
   cd backend
   npm run migrate
   ```

3. **Configure environment:**
   ```bash
   cp backend/.env.example backend/.env
   # Edit backend/.env with your database credentials
   ```

4. **Start development servers:**
   ```bash
   npm run dev
   ```

   - Backend: http://localhost:3001
   - Frontend: http://localhost:5173

## Core Modules

1. **Ingredient Intelligence System** - Manage 1,200+ ingredients with attributes
2. **Formulation Management** - CRUD for 100,000+ formulations with versioning
3. **Compatibility & Risk Engine** - Real-time compatibility scoring (≤500ms)
4. **AI Recommendation Engine** - Generate 10-50 alternative formulations
5. **Target-Based Generation** - Generate from constraints (calories, sugar, cost, type)
6. **Regulatory & Labeling** - Algerian compliance + Halal validation
7. **Cost & ROI Module** - Batch costing (1L → 10,000L) with pricing history

## API Endpoints

See `backend/src/routes/` for detailed API documentation.

## Performance Considerations

- Database indexes on all foreign keys and frequently queried columns
- Compatibility matrix pre-computed and cached
- Batch operations for large datasets
- Connection pooling for database
- Rate limiting on API endpoints

## Scaling Beyond MVP

See `SCALING.md` for detailed scaling strategies and TODOs.

## License

Proprietary - Enterprise Use Only




