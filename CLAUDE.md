# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a modern Express.js v5 TypeScript starter project with ESM modules, structured logging, environment validation, and comprehensive middleware setup.

## Development Commands

```bash
# Development server with auto-reload
npm run dev

# Build production bundle
npm run build

# Run production server (after build)
npm start

# Code quality checks
npm run lint

# Run tests
npm run test

# Watch tests during development
npm run test:watch
```

## Architecture

### Entry Points
- `src/server.ts` - HTTP server initialization with graceful shutdown handling
- `src/app.ts` - Express application factory with middleware pipeline

### Core Libraries
- **Express 5** - Web framework with improved async error handling
- **Zod** - Environment variable validation at boot time
- **Pino** - Structured JSON logging with request correlation
- **Helmet** - Security headers middleware
- **CORS** - Cross-origin resource sharing

### Middleware Pipeline Order
1. Helmet (security headers)
2. CORS configuration
3. JSON body parser
4. HTTP logger (pino-http)
5. Routes
6. 404 handler
7. Error handler

### Environment Configuration
- Environment variables are validated through Zod schema in `src/lib/env.ts`
- Required variables: `NODE_ENV` (development/production/test), `PORT`
- Validation happens at server startup - invalid config prevents boot

### Routing Structure
- Routes are modularly organized in `src/routes/`
- Main router aggregates sub-routers in `src/routes/index.ts`
- Each route module exports an Express Router instance

### Build Configuration
- TypeScript with Node.js ESM modules (`.js` extensions in imports)
- Target: ES2022 for Node 22 compatibility
- Bundler: tsup for fast production builds
- Strict TypeScript settings including `noUncheckedIndexedAccess`

### Testing
- Vitest for unit and integration tests
- Supertest for HTTP endpoint testing

## Key Implementation Details

- All TypeScript imports must use `.js` extensions (ESM requirement)
- Error handling is centralized in `src/middlewares/error.ts`
- Request-scoped logging available via `req.log` (from pino-http)
- Express 5's improved async error propagation reduces try/catch needs
- Environment validation fails fast at startup for safety