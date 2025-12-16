# BeverageAI DZ - Architecture Overview

## System Architecture

### Technology Stack

**Backend:**
- Node.js with Fastify framework
- PostgreSQL 14+ database
- Connection pooling (20 max connections)
- Transaction support for data integrity

**Frontend:**
- React 18 with TypeScript
- Tailwind CSS for styling
- Vite for build tooling
- React Router for navigation

**Database:**
- PostgreSQL with optimized indexes
- Full-text search support (pg_trgm)
- Triggers for automatic calculations
- Stored procedures for complex operations

## Core Modules

### 1. Ingredient Intelligence System

**Database Schema:**
- `ingredients` table with comprehensive attributes
- Supports 1,200+ ingredients
- Full-text search capabilities
- Category-based filtering

**Key Features:**
- Chemical attributes (pH, solubility, density)
- Sensory attributes (taste, color, aroma)
- Regulatory attributes (Halal, Kosher, vegan)
- Pricing and sourcing information
- Nutritional data

**API Endpoints:**
- `GET /api/v1/ingredients` - List with filters
- `GET /api/v1/ingredients/:id` - Get by ID
- `POST /api/v1/ingredients` - Create
- `PUT /api/v1/ingredients/:id` - Update
- `DELETE /api/v1/ingredients/:id` - Soft delete

### 2. Formulation Management

**Database Schema:**
- `formulations` table with versioning
- `formulation_ingredients` junction table
- Supports 100,000+ formulations
- Automatic total recalculation via triggers

**Key Features:**
- Unlimited versioning
- Parent-child relationships
- Status management (draft, active, archived)
- Automatic nutrition and cost calculation
- Multi-tenant support

**API Endpoints:**
- `GET /api/v1/formulations` - List with filters
- `GET /api/v1/formulations/:id` - Get with ingredients
- `POST /api/v1/formulations` - Create
- `PUT /api/v1/formulations/:id` - Update
- `POST /api/v1/formulations/:id/versions` - Create version
- `GET /api/v1/formulations/:id/versions` - List versions

### 3. Compatibility & Risk Engine

**Database Schema:**
- `ingredient_compatibility` table
- Pre-computed compatibility scores
- Supports 1.4M+ pairs
- Symmetric storage (A-B = B-A)

**Key Features:**
- Real-time compatibility evaluation (≤500ms)
- Risk flagging (chemical, physical, sensory, regulatory)
- Batch computation support
- On-the-fly calculation fallback

**API Endpoints:**
- `GET /api/v1/compatibility/ingredients/:a/:b` - Get pair score
- `GET /api/v1/compatibility/formulations/:id` - Evaluate formulation
- `POST /api/v1/compatibility/batch-compute` - Batch compute

**Performance:**
- Indexed lookups for O(1) access
- Batch queries for multiple pairs
- Caching-ready architecture

### 4. AI Recommendation Engine

**Database Schema:**
- `ai_formulation_variants` table
- Stores generated variants with metadata
- Confidence scores and explanations

**Key Features:**
- Generate 10-50 variants per request
- Multiple generation types (optimization, alternative, constraint-based)
- Confidence scoring
- Variant acceptance workflow

**API Endpoints:**
- `POST /api/v1/ai/formulations/:id/generate` - Generate variants
- `GET /api/v1/ai/formulations/:id/variants` - List variants
- `POST /api/v1/ai/variants/:id/accept` - Accept variant

**Note:** Currently uses mock logic with structure for real AI integration.

### 5. Target-Based Generation

**Key Features:**
- Generate from constraints (calories, sugar, cost, type)
- Returns top 3 optimized candidates
- Iterative optimization algorithm
- Scoring system for ranking

**API Endpoints:**
- `POST /api/v1/target-generation/generate` - Generate from targets

**Algorithm:**
- Gradient descent for percentage optimization
- Multi-objective optimization
- Constraint satisfaction

### 6. Regulatory & Labeling

**Database Schema:**
- `regulatory_compliance` table
- Stores compliance checks and labels
- Multi-language support (AR/FR/EN)

**Key Features:**
- Algerian regulatory compliance
- Halal validation
- Kosher validation
- Vegan validation
- Label generation in 3 languages

**API Endpoints:**
- `POST /api/v1/regulatory/formulations/:id/check` - Check compliance
- `GET /api/v1/regulatory/formulations/:id/compliance` - Get compliance
- `POST /api/v1/regulatory/formulations/:id/labels` - Generate labels
- `GET /api/v1/regulatory/formulations/:id/labels` - Get labels

### 7. Cost & ROI Module

**Database Schema:**
- `batch_cost_calculations` table
- `ingredient_pricing_history` table (36 months support)

**Key Features:**
- Batch costing (1L → 10,000L)
- Historical pricing support
- ROI estimation
- Batch size comparison
- Overhead and margin calculation

**API Endpoints:**
- `POST /api/v1/cost/formulations/:id/batch-cost` - Calculate cost
- `GET /api/v1/cost/formulations/:id/batch-costs` - List calculations
- `GET /api/v1/cost/formulations/:id/compare-batch-sizes` - Compare sizes
- `POST /api/v1/cost/formulations/:id/roi` - Calculate ROI
- `POST /api/v1/cost/ingredients/:id/pricing` - Add pricing history
- `GET /api/v1/cost/ingredients/:id/pricing` - Get pricing history

## Database Indexes

### Critical Indexes for Performance

**Ingredients:**
- `idx_ingredients_code` - Unique code lookup
- `idx_ingredients_category` - Category filtering
- `idx_ingredients_search_vector` - Full-text search
- `idx_ingredients_name_trgm` - Fuzzy name search

**Compatibility:**
- `idx_compat_pair_lookup` - Fast pair lookup
- `idx_compat_score` - Score-based queries
- `idx_compat_risks` - Risk filtering

**Formulations:**
- `idx_formulations_code` - Unique code lookup
- `idx_formulations_latest` - Latest version queries
- `idx_formulations_tenant` - Multi-tenant filtering
- `idx_formulations_created_at` - Time-based queries

## Performance Optimizations

1. **Database:**
   - Comprehensive indexing strategy
   - Connection pooling
   - Query optimization
   - Trigger-based calculations

2. **API:**
   - Rate limiting (1000 req/min)
   - CORS configuration
   - Security headers (Helmet)
   - Error handling

3. **Frontend:**
   - Component-based architecture
   - API client abstraction
   - TypeScript for type safety
   - Responsive design

## Security Features

- Helmet.js for security headers
- CORS configuration
- Rate limiting
- Input validation (via Zod - ready for implementation)
- SQL injection prevention (parameterized queries)
- Soft deletes for data retention

## Multi-Tenancy

- `tenant_id` column in formulations
- Tenant isolation ready
- Row-level security ready (PostgreSQL RLS)

## Scalability Considerations

See `SCALING.md` for detailed scaling strategies.

**Current Capacity:**
- 1,200+ ingredients ✅
- 100,000+ formulations ✅
- 1.4M+ compatibility pairs ✅
- ≤500ms compatibility evaluation ✅

**Future Scaling:**
- Redis caching layer
- Read replicas
- Horizontal scaling
- Background job processing
- Real AI model integration

## Development Workflow

1. **Setup:**
   ```bash
   npm run install:all
   createdb beverageai_dz
   cd backend && npm run migrate
   ```

2. **Development:**
   ```bash
   npm run dev  # Starts both backend and frontend
   ```

3. **Backend:**
   - Runs on http://localhost:3001
   - Hot reload with --watch

4. **Frontend:**
   - Runs on http://localhost:5173
   - Vite HMR enabled

## API Documentation

All API endpoints follow RESTful conventions:
- `GET` for retrieval
- `POST` for creation
- `PUT` for updates
- `DELETE` for deletion

Response format:
```json
{
  "data": {...},
  "pagination": {...},  // When applicable
  "message": "..."      // When applicable
}
```

Error format:
```json
{
  "error": "Error name",
  "message": "Error description"
}
```

## Testing Recommendations

**Backend:**
- Unit tests for services
- Integration tests for API routes
- Database migration tests
- Performance tests for compatibility engine

**Frontend:**
- Component tests (React Testing Library)
- E2E tests (Playwright/Cypress)
- API integration tests

## Deployment Checklist

- [ ] Set up production database
- [ ] Configure environment variables
- [ ] Run database migrations
- [ ] Set up Redis cache (for scaling)
- [ ] Configure load balancer
- [ ] Set up monitoring
- [ ] Configure SSL/TLS
- [ ] Set up backup strategy
- [ ] Performance testing
- [ ] Security audit

## Next Steps

1. Implement real AI model integration
2. Add authentication and authorization
3. Set up monitoring and logging
4. Implement caching layer
5. Add comprehensive testing
6. Performance optimization
7. Documentation completion

See `SCALING.md` for detailed scaling roadmap.




