import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import reportParseRouter from "./routes/report-parse";

dotenv.config({ path: path.resolve(process.cwd(), "server/.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3001);
const isProduction = process.env.NODE_ENV === "production";

const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
  }),
);
app.use(express.json({ limit: "16mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "catcare-report-parse",
    mode: isProduction ? "production" : "development",
    nodeEnv: process.env.NODE_ENV || "development",
    deepseek: process.env.DEEPSEEK_API_KEY ? "configured" : "mock_fallback",
    ocr: process.env.OCR_MODE === "real" ? "real" : "stub_fallback",
    ocrService: process.env.OCR_SERVICE_URL || "http://localhost:5005",
  });
});

app.use("/api/reports", reportParseRouter);

// === /api 命名空间 404：返回 JSON 而不是 HTML（必须在 SPA fallback 之前）===
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API endpoint not found" });
});

// === 生产模式：serve 前端 dist + SPA history fallback ===
const distDir = path.resolve(process.cwd(), "dist");
if (isProduction && fs.existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: "7d" }));
  // SPA fallback：把非 /api 的 GET 全部返回 index.html，让前端路由接管
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
  console.log(`[catcare-server] serving static dist from ${distDir}`);
}

app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({
    error: "Internal server error",
  });
});

app.listen(port, () => {
  const mode = isProduction ? "production" : "dev";
  console.log(`[catcare-server] (${mode}) listening on http://localhost:${port}`);
});
