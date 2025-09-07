import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import session from "express-session";
import MongoStore from "connect-mongo";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import path from "path";
import { fileURLToPath } from "url";

import User from "./models/User.js";
import Pin from "./models/Pin.js";
import { connectDB } from "./models/index.js";


dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----- DB -----

connectDB().catch(err => {
  console.error("Failed to connect to MongoDB", err);
  process.exit(1);
});
console.log(process.env.MONGO_URL);
// ----- Middleware -----
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URL,
      collectionName: "sessions"
    })
  })
);

// ----- Passport (Local) -----
passport.use(
  new LocalStrategy(
    { usernameField: "email", passwordField: "password" },
    async (email, password, done) => {
      try {
        const user = await User.findOne({ email }).lean();
        if (!user) return done(null, false, { message: "Invalid credentials" });
        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) return done(null, false, { message: "Invalid credentials" });
        return done(null, { id: user._id.toString(), email: user.email });
      } catch (e) {
        return done(e);
      }
    }
  )
);

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const u = await User.findById(id).select("_id email").lean();
    if (!u) return done(null, false);
    done(null, { id: u._id.toString(), email: u.email });
  } catch (e) {
    done(e);
  }
});

app.use(passport.initialize());
app.use(passport.session());

// ----- Helpers -----
function ensureAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  res.status(401).json({ error: "Unauthorized" });
}

// ----- Auth Routes -----
app.post("/api/register", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  try {
    const hash = await bcrypt.hash(password, 10);
    const created = await User.create({ email, password_hash: hash });
    // Auto-login
    req.login({ id: created._id.toString(), email: created.email }, (err) => {
      if (err) return res.status(201).json({ id: created._id, email: created.email });
      res.json({ id: created._id, email: created.email });
    });
  } catch (e) {
    if (e && e.code === 11000) {
      return res.status(409).json({ error: "Email already registered" });
    }
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/login", passport.authenticate("local"), (req, res) => {
  res.json({ id: req.user.id, email: req.user.email });
});

app.post("/api/logout", (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    res.json({ ok: true });
  });
});

app.get("/api/me", (req, res) => {
  if (!req.user) return res.json(null);
  res.json(req.user);
});

// ----- Pin Routes -----
app.get("/api/pins", ensureAuth, async (req, res) => {
  const pins = await Pin.find({ user_id: req.user.id })
    .select("lat lng title note createdAt updatedAt")
    .sort({ createdAt: -1 })
    .lean();
  res.json(
    pins.map(p => ({
      id: p._id.toString(),
      lat: p.lat,
      lng: p.lng,
      title: p.title,
      note: p.note,
      created_at: p.createdAt,
      updated_at: p.updatedAt
    }))
  );
});

app.post("/api/pins", ensureAuth, async (req, res) => {
  const { lat, lng, title, note } = req.body || {};
  if (lat === undefined || lng === undefined || !title || !note) {
    return res.status(400).json({ error: "lat, lng, title, note required" });
  }
  try {
    const created = await Pin.create({
      user_id: req.user.id,
      lat,
      lng,
      title,
      note
    });
    res.status(201).json({
      id: created._id.toString(),
      lat: created.lat,
      lng: created.lng,
      title: created.title,
      note: created.note,
      created_at: created.createdAt,
      updated_at: created.updatedAt
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/api/pins/:id", ensureAuth, async (req, res) => {
  try {
    const result = await Pin.deleteOne({ _id: req.params.id, user_id: req.user.id });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});


app.put("/api/pins/:id", ensureAuth, async (req, res) => {
  try {
    const { title, note } = req.body || {};
    const updated = await Pin.findOneAndUpdate(
      { _id: req.params.id, user_id: req.user.id },
      { $set: { title, note } },
      { new: true, projection: { _id:1, lat:1, lng:1, title:1, note:1, createdAt:1, updatedAt:1 } }
    ).lean();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json({
      id: updated._id.toString(),
      lat: updated.lat, lng: updated.lng,
      title: updated.title, note: updated.note,
      created_at: updated.createdAt, updated_at: updated.updatedAt
    });
  } catch (e) { res.status(500).json({ error: "Server error" }); }
});


// ----- Static Frontend -----
app.use(express.static(path.join(__dirname, "frontend")));

app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`GeoNotes (Mongo) at http://localhost:${PORT}`));