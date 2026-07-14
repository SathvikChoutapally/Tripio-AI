import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';

// Route imports
import authRouter from './routes/auth.js';
import tripsRouter from './routes/trips.js';
import chatRouter from './routes/chat.js';
import flightsRouter from './routes/flights.js';
import hotelsRouter from './routes/hotels.js';
import bookingsRouter from './routes/bookings.js';
import citiesRouter from './routes/cities.js';
import adminRouter from './routes/admin.js';

const app = express();
const PORT = process.env.PORT || 3001;

// ── Security Middleware ───────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // Allow SSE connections
  crossOriginEmbedderPolicy: false,
}));

// ── CORS ─────────────────────────────────────────────────────
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "https://tripio-ai.vercel.app",
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.log("Blocked Origin:", origin);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Idempotency-Key",
  ],
};

app.use((req, res, next) => {
  console.log("Origin:", req.headers.origin);
  next();
});

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// ── Body Parsing ──────────────────────────────────────────────
// Razorpay webhook needs raw body for signature verification
app.use('/api/bookings/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Global Rate Limiting ──────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const chatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30,
  message: { error: 'Chat rate limit exceeded.' },
});

app.use(globalLimiter);

// ── Health Check ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'tripio-server',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// ── Routes ────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/trips', tripsRouter);
app.use('/api/chat', chatLimiter, chatRouter);
app.use('/api/flights', flightsRouter);
app.use('/api/hotels', hotelsRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/cities', citiesRouter);
app.use('/api/admin', adminRouter);

// ── 404 Handler ───────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Global Error Handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Error]', err.stack || err.message);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// ── Start Server ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 TripioAI server running on http://localhost:${PORT}`);
  console.log(`   AI Service: ${process.env.AI_SERVICE_URL}`);
  console.log(`   Environment: ${process.env.NODE_ENV}`);
});

export default app;
