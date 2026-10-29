// src/app.js
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const authRouter = require('./routes/auth');
const customersRouter = require('./routes/customers');
const usersRouter = require('./routes/users');
const errorHandler = require('./middleware/error-handler');

const app = express();
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(express.json());
app.use(cookieParser());
app.use(cors({
  origin: process.env.CLIENT_URL,
  credentials: true
}));

// Example health-check route
app.get("/api/health", (req, res) => {
  res.json({ status: "OK" });
});

// === from server.js file ====
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));



// app.use(cors({
//   origin: (origin, callback) => {
//     // Allow requests without an Origin header, such as server-to-server calls.
//     if (!origin || allowedOrigins.includes(origin)) {
//       return callback(null, true);
//     }

//     return callback(new Error("Not allowed by CORS"));
//   },
//   credentials: true
// }));

// =====
app.use(cookieParser());
app.use(express.json({ limit: '10kb' }));
app.use('/api', authRouter);
app.use('/api', customersRouter);
app.use('/api', usersRouter);
// app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use(errorHandler);

// Register your existing customer routes here.
// Example:
// app.use("/api/customers", customerRoutes);

module.exports = app;