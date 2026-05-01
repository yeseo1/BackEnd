// server.js

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";

// Routes
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import swaggerSetup from "./swagger/swagger.js";
import sessionRoutes from "./routes/sessionRoutes.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const DEV_BEARER_USER_ID =
  process.env.DEV_BEARER_USER_ID || "11111111-1111-1111-1111-111111111111";

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  }),
);
app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
app.use(cookieParser());

// Routes Mounting
app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/sessions", sessionRoutes);
// Swagger
swaggerSetup(app);

app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is healthy",
    data: {
      status: "ok",
    },
  });
});



app.get("/", (_req, res) => {
  res.send("티격태격 백엔드 API 서버입니다. Swagger는 /api-docs 에 있습니다.");
});


app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: "NOT_FOUND",
      message: "요청한 경로를 찾을 수 없습니다.",
    },
  });
});

const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);

  const devBearerToken = jwt.sign(
    {
      sub: DEV_BEARER_USER_ID,
      email: "testuser@tigyeok.local",
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    },
  );

  console.log("\nSwagger Authorize 입력값:");
  console.log(`${devBearerToken}\n`);
  console.log("curl/헤더용 Bearer 형식:");
  console.log(`Bearer ${devBearerToken}\n`);
});
