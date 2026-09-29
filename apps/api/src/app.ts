import cors from "cors";
import express from "express";
import { adminRouter } from "./modules/admin/adminRoutes";
import { customerRouter } from "./modules/customers/customerRoutes";
import { notificationRouter } from "./modules/notifications/notificationRoutes";
import { ticketRouter } from "./modules/tickets/ticketRoutes";
import { authMiddleware } from "./middleware/auth";
import { errorMiddleware } from "./middleware/errors";
import { healthRouter } from "./routes/health";

export function createApp() {
  const app = express();
  app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:5173" }));
  app.use(express.json());

  app.use("/api/health", healthRouter);
  app.use("/api", authMiddleware);
  app.use("/api/tickets", ticketRouter);
  app.use("/api/customers", customerRouter);
  app.use("/api/notifications", notificationRouter);
  app.use("/api/admin", adminRouter);
  app.use(errorMiddleware);

  return app;
}
