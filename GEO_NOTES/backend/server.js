// serves.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

import bcrypt from "bcrypt";
import session from "express-session";
import passport from "passport";
import MongoStore from "connect-mongo";
import { Strategy as LocalStrategy } from "passport-local";

import User from "./models/User.js";
import Pin from "./models/Pin.js";
import Share from "./models/Share.js";
import { connectDB } from "./models/index.js";

dotenv.config();
const app = express();

connectDB().catch(err => {
  console.error("Failed to connect to MongoDB", err);
  process.exit(1);
});

// Middleware
// If frontend is served by this same Express (it is), simple cors() is fine
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files from frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

// File-based storage (in project root to avoid Live Server refresh)
const DATA_FILE = path.join(__dirname, '../../pins.json');

// Sessions (Mongo-backed)
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
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



const pickWritableFields = (body) => {
  const w = {};
  // allow coords update if provided
  if (body.latitude !== undefined)  w.latitude  = Number(body.latitude);
  if (body.longitude !== undefined) w.longitude = Number(body.longitude);

  if (body.title !== undefined)        w.title = String(body.title).trim() || "Untitled";
  if (body.note !== undefined)         w.note = String(body.note);
  if (body.country !== undefined)      w.country = String(body.country);
  if (body.region !== undefined)       w.region = String(body.region);
  if (body.locationName !== undefined) w.locationName = String(body.locationName);
  return w;
};

const toClient = (doc) => ({
  _id: doc._id,
  user_id: doc.user_id,
  latitude: doc.latitude,
  longitude: doc.longitude,
  title: doc.title,
  country: doc.country,
  region: doc.region,
  locationName: doc.locationName,
  note: doc.note,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt
});

// Get all pins for the logged-in user
app.get("/api/pins", ensureAuth, async (req, res) => {
  try {
    const pins = await Pin.find({ user_id: req.user.id })
      .sort({ createdAt: -1 })
      .lean();
    res.json(pins.map(toClient));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch pins" });
  }
});

// Create a new pin for the logged-in user
// app.post("/api/pins", ensureAuth, async (req, res) => {
//   try {
//     const { latitude, longitude } = req.body || {};
//     if (latitude === undefined || longitude === undefined) {
//       return res.status(400).json({ message: "latitude and longitude are required" });
//     }

//     const data = pickWritableFields(req.body);
//     // enforce requireds with safe defaults
//     data.title = data.title ?? "Untitled";
//     data.note = data.note ?? "";
//     data.user_id = req.user.id;

//     const created = await Pin.create(data);
//     res.status(201).json(toClient(created));
//   } catch (error) {
//     console.error(error);
//     res.status(400).json({ message: error.message || "Failed to create pin" });
//   }
// });

app.post("/api/pins", ensureAuth, async (req, res) => {
  try {
    const { latitude, longitude, user_id: targetUserId } = req.body || {};
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ message: "latitude and longitude are required" });
    }

    const data = pickWritableFields(req.body);
    data.title = data.title ?? "Untitled";
    data.note  = data.note  ?? "";

    if (targetUserId && targetUserId !== req.user.id) {
      // require EDITOR to add pins to someone else's map
      const hasEditor = await Share.exists({
        owner_id: targetUserId,
        member_id: req.user.id,
        role: 'editor'
      });
      if (!hasEditor) {
        return res.status(403).json({ message: "Not allowed to add pins to this map" });
      }
      data.user_id = targetUserId;
    } else {
      data.user_id = req.user.id;
    }

    const created = await Pin.create(data);
    res.status(201).json(toClient(created));
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: error.message || "Failed to create pin" });
  }
});
// Update a pin (only if it belongs to the logged-in user)
app.put("/api/pins/:id", ensureAuth, async (req, res) => {
  try {
    const update = pickWritableFields(req.body);
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ message: "No valid fields to update" });
    }

    const pin = await Pin.findById(req.params.id);
    if (!pin) return res.status(404).json({ message: "Pin not found" });

    const isOwner = pin.user_id.toString() === req.user.id;
    let isEditor = false;

    if (!isOwner) {
      isEditor = await Share.exists({
        owner_id: pin.user_id,
        member_id: req.user.id,
        role: 'editor'                     // must be editor to modify
      });
    }

    if (!isOwner && !isEditor) {
      return res.status(403).json({ message: "Not allowed to update this pin" });
    }

    Object.assign(pin, update);
    const saved = await pin.save();
    return res.json(toClient(saved));

  } catch (error) {
    console.error(error);
    res.status(400).json({ message: error.message || "Failed to update pin" });
  }
});

// Delete a pin (only if it belongs to the logged-in user)
app.delete("/api/pins/:id", ensureAuth, async (req, res) => {
  try {
    const result = await Pin.deleteOne({ _id: req.params.id, user_id: req.user.id });
    if (!result.deletedCount) return res.status(404).json({ message: "Pin not found" });
    res.json({ message: "Pin deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: error.message || "Failed to delete pin" });
  }
});

// Share a map with another user by email
app.post("/api/share", ensureAuth, async (req, res) => {
  try {
    const { email, role } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email is required" });

    const toUser = await User.findOne({ email }).select("_id email").lean();
    if (!toUser) return res.status(404).json({ error: "User not found" });
    if (toUser._id.toString() === req.user.id)
      return res.status(400).json({ error: "Cannot share with yourself" });

    await Share.updateOne(
      { owner_id: req.user.id, member_id: toUser._id },
      { $set: { role: role === "editor" ? "editor" : "viewer" } },
      { upsert: true }
    );

    res.json({ ok: true });
  } catch (e) {
    if (e.code === 11000) return res.json({ ok: true }); // already shared
    console.error(e);
    res.status(500).json({ error: "Failed to share" });
  }
});

// List maps shared *with* me (owners who shared their map to me)
app.get("/api/shared", ensureAuth, async (req, res) => {
  try {
    const shares = await Share.find({ member_id: req.user.id })
      .populate({ path: "owner_id", select: "_id email" })
      .lean();

    const owners = shares.map(s => ({
      owner_id: s.owner_id._id,
      owner_email: s.owner_id.email,
      role: s.role
    }));
    res.json(owners);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to list shared maps" });
  }
});

// Get pins for a specific shared owner (only if shared with me)
app.get("/api/shared/:ownerId/pins", ensureAuth, async (req, res) => {
  try {
    const { ownerId } = req.params;
    const hasAccess = await Share.exists({ owner_id: ownerId, member_id: req.user.id });
    if (!hasAccess) return res.status(403).json({ error: "No access to this map" });

    const pins = await Pin.find({ user_id: ownerId }).sort({ createdAt: -1 }).lean();
    res.json(pins.map(p => ({
      _id: p._id, user_id: p.user_id,
      latitude: p.latitude, longitude: p.longitude,
      title: p.title, note: p.note,
      country: p.country, region: p.region, locationName: p.locationName,
      createdAt: p.createdAt, updatedAt: p.updatedAt
    })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch shared pins" });
  }
});

// (Optional) revoke sharing
app.delete("/api/share", ensureAuth, async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email is required" });
    const toUser = await User.findOne({ email }).select("_id").lean();
    if (!toUser) return res.status(404).json({ error: "User not found" });
    await Share.deleteOne({ owner_id: req.user.id, member_id: toUser._id });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to revoke share" });
  }
});

// List users that *I* (the owner) have shared my map with
app.get("/api/shares", ensureAuth, async (req, res) => {
  try {
    const shares = await Share.find({ owner_id: req.user.id })
      .populate({ path: "member_id", select: "_id email" })
      .lean();

    res.json(shares.map(s => ({
      member_id: s.member_id._id,
      email: s.member_id.email,
      role: s.role,
      createdAt: s.createdAt
    })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load shares" });
  }
});

// Start server
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Graceful shutdown handling
const shutdown = (sig) => {
  console.log(`${sig} received, shutting down gracefully...`);
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));