// Load env variables first
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import notesRoutes from "./Routes/notes.js";
import authRoutes from "./Routes/auth.js";
import metaRoutes from "./Routes/meta.js";
import adminRoutes from "./Routes/admin.js";


const app = express();

// ===== Middleware =====
app.use(express.json());
app.use(cors());

// ===== MongoDB Connection with Retry =====
const connectWithRetry = () => {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI not defined in environment variables!");
    return;
  }

  mongoose
    .connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB Connected"))
    .catch((err) => {
      console.error("MongoDB connection failed, retrying in 5 seconds...", err);
      setTimeout(connectWithRetry, 5000);
    });
};
connectWithRetry();

// ===== Routes =====
app.get("/", (req, res) => res.send("API running..."));
app.use("/api/notes", notesRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/meta", metaRoutes);
app.use("/api/admin", adminRoutes);


// ===== Start Server =====
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
