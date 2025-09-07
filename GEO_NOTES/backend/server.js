// serves.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
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
import Label from "./models/Label.js";
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

app.get("/config", (req, res) => {
  res.json({ apiUrl: process.env.GOOGLE_MAPS_API_KEY});
});

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


// server.js (helpers) — add 'label' to pickWritableFields
const pickWritableFields = (body) => {
  const w = {};
  if (body.latitude !== undefined)  w.latitude  = Number(body.latitude);
  if (body.longitude !== undefined) w.longitude = Number(body.longitude);

  if (body.note !== undefined)         w.note = String(body.note);
  if (body.country !== undefined)      w.country = String(body.country);
  if (body.region !== undefined)       w.region = String(body.region);
  if (body.locationName !== undefined) w.locationName = String(body.locationName);
  if (body.label !== undefined)        w.label = String(body.label).trim(); // <— NEW
  return w;
};

const toClient = (doc) => ({
  _id: doc._id,
  user_id: doc.user_id,
  latitude: doc.latitude,
  longitude: doc.longitude,
  title: doc.title,
  label: doc.label,
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

app.post("/api/pins", ensureAuth, async (req, res) => {
  try {
    const { latitude, longitude, user_id: targetUserId } = req.body || {};
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ message: "latitude and longitude are required" });
    }

    const data = pickWritableFields(req.body);
    data.title = data.title ?? "Untitled";
    data.note  = data.note  ?? "";
    data.label = (data.label && data.label.trim()) || "General"; // <— default

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

// Get my saved custom labels
app.get("/api/labels", ensureAuth, async (req, res) => {
  const rows = await Label.find({ user_id: req.user.id }).sort({ name: 1 }).lean();
  res.json(rows.map(r => r.name));
});

// Add a custom label (idempotent)
app.post("/api/labels", ensureAuth, async (req, res) => {
  const name = (req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Label name is required" });
  if (name.length > 30) return res.status(400).json({ error: "Label too long (max 30)" });

  await Label.updateOne(
    { user_id: req.user.id, name },
    { $setOnInsert: { user_id: req.user.id, name } },
    { upsert: true }
  );
  res.json({ ok: true, name });
});

// Remove a custom label
app.delete("/api/labels", ensureAuth, async (req, res) => {
  const name = (req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Label name is required" });
  await Label.deleteOne({ user_id: req.user.id, name });
  res.json({ ok: true });
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
      label: p.label,
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

app.get("/api/wikidata", async (req, res) => {
  try {
    const { lat, lng, radius = "5" } = req.query;
    if (!lat || !lng) return res.status(400).json({ message: "lat and lng are required" });

    const contextSparql = `
      SELECT ?place ?placeLabel ?type ?typeLabel ?adminLabel ?countryLabel
             ?population ?elev ?capitalLabel ?govTypeLabel ?headGovLabel ?headStateLabel
             ?gdp ?gdpPerCapita ?koppenLabel
      WHERE {
        SERVICE wikibase:around {
          ?place wdt:P625 ?coord .
          bd:serviceParam wikibase:center "Point(${Number(lng)} ${Number(lat)})"^^geo:wktLiteral ;
                          wikibase:radius "${radius}" .
        }
        ?place wdt:P31 ?type .
        # Prefer contextual entities only
        FILTER(?type IN (wd:Q515, wd:Q3957, wd:Q5119, wd:Q56061)) # city, town, suburb, admin. territorial entity

        OPTIONAL { ?place wdt:P131 ?admin. }
        OPTIONAL { ?place wdt:P17 ?country. }
        OPTIONAL { ?place wdt:P1082 ?population. }
        OPTIONAL { ?place wdt:P2044 ?elev. }

        OPTIONAL { ?place wdt:P36 ?capital. }
        OPTIONAL { ?place wdt:P122 ?govType. }
        OPTIONAL { ?place wdt:P6 ?headGov. }
        OPTIONAL { ?place wdt:P35 ?headState. }

        OPTIONAL { ?place wdt:P2131 ?gdp. }
        OPTIONAL { ?place wdt:P2132 ?gdpPerCapita. }

        OPTIONAL { ?place wdt:P3986 ?koppen. } # Köppen climate classification

        SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en". }
      }
      # choose the most "notable": higher population first, then with labels
      ORDER BY DESC(?population)
      LIMIT 1
    `;

    const highlightsSparql = `
      SELECT ?item ?itemLabel ?typeLabel ?links WHERE {
        SERVICE wikibase:around {
          ?item wdt:P625 ?coord .
          bd:serviceParam wikibase:center "Point(${Number(lng)} ${Number(lat)})"^^geo:wktLiteral ;
                          wikibase:radius "${radius}" .
        }
        OPTIONAL { ?item wdt:P31 ?type. }
        ?item wikibase:sitelinks ?links .
        # De-noise micro POIs
        FILTER( !REGEX(STR(?type), "(tram|bus|rail|subway|train).*stop", "i")
             && !REGEX(STR(?type), "school|primary|high school|college|kindergarten", "i")
             && !REGEX(STR(?type), "parking|toilet|bench|postbox|waste", "i") )
        SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en". }
      }
      ORDER BY DESC(?links)
      LIMIT 3
    `;

    const run = async (sparql) => {
      const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`;
      const resp = await fetch(url, { headers: { "User-Agent": "GeoNotes/1.0 (student project)" } });
      if (!resp.ok) throw new Error(`WDQS error: ${resp.status}`);
      return resp.json();
    };

    const [contextJson, highlightsJson] = await Promise.all([run(contextSparql), run(highlightsSparql)]);
    const b = contextJson.results?.bindings?.[0];

    const context = b ? {
      id: b.place?.value,
      label: b.placeLabel?.value,
      type: b.typeLabel?.value || null,
      admin: b.adminLabel?.value || null,
      country: b.countryLabel?.value || null,
      population: b.population ? Number(b.population.value) : null,
      elevation_m: b.elev ? Number(b.elev.value) : null,
      capital: b.capitalLabel?.value || null,
      government_type: b.govTypeLabel?.value || null,
      head_of_government: b.headGovLabel?.value || null,
      head_of_state: b.headStateLabel?.value || null,
      gdp: b.gdp ? Number(b.gdp.value) : null,
      gdp_per_capita: b.gdpPerCapita ? Number(b.gdpPerCapita.value) : null,
      climate: b.koppenLabel?.value || null
    } : null;

    const highlights = (highlightsJson.results?.bindings || []).map(x => ({
      id: x.item?.value,
      label: x.itemLabel?.value,
      type: x.typeLabel?.value || null,
      sitelinks: x.links ? Number(x.links.value) : null
    }));

    res.json({ context, highlights });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: e.message });
  }
});


app.get("/api/pins/search", ensureAuth, async (req, res) => {
  try {
    const { locationName, label } = req.query;
    const q = { user_id: req.user.id };

    if (label && label.trim()) {
      // exact match, case-insensitive, to respect enum values
      q.label = new RegExp(`^${label.trim()}$`, "i");
    }

    if (locationName && locationName.trim()) {
      const regex = new RegExp(locationName.trim(), "i");
      q.$or = [
        { locationName: regex },
        { country: regex },
        { region: regex },
        { note: regex },
        { label: regex }
      ];
    }

    if (!q.$or && !q.label) {
      return res.status(400).json({ message: "Provide label or text to search" });
    }

    const pins = await Pin.find(q).sort({ createdAt: -1 }).lean();
    res.json(pins.map(toClient));
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).json({ message: error.message || "Failed to search pins" });
  }
});


app.get("/api/shared/:ownerId/search", ensureAuth, async (req, res) => {
  try {
    const { ownerId } = req.params;
    const { locationName, label } = req.query;

    const hasAccess = await Share.exists({ owner_id: ownerId, member_id: req.user.id });
    if (!hasAccess) return res.status(403).json({ error: "No access to this map" });

    const q = { user_id: ownerId };

    if (label && label.trim()) {
      q.label = new RegExp(`^${label.trim()}$`, "i");
    }

    if (locationName && locationName.trim()) {
      const regex = new RegExp(locationName.trim(), "i");
      q.$or = [
        { locationName: regex },
        { country: regex },
        { region: regex },
        { note: regex },
        { label: regex }
      ];
    }

    if (!q.$or && !q.label) {
      return res.status(400).json({ message: "Provide label or text to search" });
    }

    const pins = await Pin.find(q).sort({ createdAt: -1 }).lean();
    res.json(pins.map(toClient));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to search shared pins" });
  }
});


// Macrostrat API - Geological data
app.get("/api/macrostrat", async (req, res) => {
  try {
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.status(400).json({ message: "lat and lng are required" });

    // Get geological units at this location
    const unitsUrl = `https://macrostrat.org/api/v2/units?lat=${lat}&lng=${lng}&response=long`;
    const columnsUrl = `https://macrostrat.org/api/v2/columns?lat=${lat}&lng=${lng}`;
    
    const [unitsResp, columnsResp] = await Promise.all([
      fetch(unitsUrl, { headers: { "User-Agent": "GeoNotes/1.0 (educational)" } }),
      fetch(columnsUrl, { headers: { "User-Agent": "GeoNotes/1.0 (educational)" } })
    ]);

    if (!unitsResp.ok || !columnsResp.ok) {
      throw new Error(`Macrostrat API error: ${unitsResp.status} / ${columnsResp.status}`);
    }

    const unitsData = await unitsResp.json();
    const columnsData = await columnsResp.json();

    const unitsRaw   = Array.isArray(unitsData?.success?.data)   ? unitsData.success.data   : [];
    const columnsRaw = Array.isArray(columnsData?.success?.data) ? columnsData.success.data : [];
  

    // Process units data - get most relevant geological information
    // const units = (unitsData.success && Array.isArray(unitsData.data) ? unitsData.data : [])
    //   .slice(0, 3)
    //   .map(unit => ({
    //     name: unit.unit_name,
    //     age: unit.t_age ? `${unit.t_age} - ${unit.b_age} Ma` : null,
    //     lithology: unit.lith?.join(', ') || null,
    //     environment: unit.environ?.join(', ') || null,
    //     thickness: unit.max_thick ? `${unit.max_thick}m` : null,
    //     description: unit.unit_name
    //   }));
    
    const units = unitsRaw.slice(0, 3).map(unit => ({
      name: unit.unit_name,
      age: (unit.t_age ?? null) && (unit.b_age ?? null) ? `${unit.t_age} - ${unit.b_age} Ma` : null,
      lithology: Array.isArray(unit.lith)    ? unit.lith.join(', ')    : null,
      environment: Array.isArray(unit.environ) ? unit.environ.join(', ') : null,
      thickness: unit.max_thick ? `${unit.max_thick}m` : null,
      description: unit.unit_name
    }));
    

    const columns = (columnsData.success && Array.isArray(columnsData.data) ? columnsData.data : [])
      .slice(0, 3)
      .map(col => ({
        name: col.col_name,
        area: col.col_area,
        group: col.col_group,
        formation: col.project
      }));

    res.json({ 
      success: true,
      location: { lat: parseFloat(lat), lng: parseFloat(lng) },
      units,
      columns,
      source: "Macrostrat"
    });
  } catch (e) {
    console.error('Macrostrat error:', e);
    res.status(500).json({ message: e.message, success: false });
  }
});

// PBDB API - Paleontological data
app.get("/api/pbdb", async (req, res) => {
  try {
    const { lat, lng, radius = "0.5" } = req.query; // 0.5 degree radius default (~55km)
    if (!lat || !lng) return res.status(400).json({ message: "lat and lng are required" });

    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    const radiusNum = parseFloat(radius);

    // Calculate bounding box
    const latMin = latNum - radiusNum;
    const latMax = latNum + radiusNum;
    const lngMin = lngNum - radiusNum;
    const lngMax = lngNum + radiusNum;

    // Get fossil occurrences near this location
    const occurrencesUrl = `https://paleobiodb.org/data1.2/occs/list.json?latmin=${latMin}&latmax=${latMax}&lngmin=${lngMin}&lngmax=${lngMax}&show=coords,attr,loc,time,ident&limit=20`;

    const occResp = await fetch(occurrencesUrl, { 
      headers: { "User-Agent": "GeoNotes/1.0 (educational)" } 
    });

    if (!occResp.ok) {
      throw new Error(`PBDB API error: ${occResp.status}`);
    }

    const occData = await occResp.json();

    // Process fossil occurrences
    const fossils = (occData.records || []).slice(0, 3).map(occ => ({
      id: occ.oid,
      name: occ.tna || occ.idn,
      age: occ.eag && occ.lag ? `${occ.eag} - ${occ.lag} Ma` : null,
      period: occ.oei || null,
      location: occ.cc || occ.sn || null,
      formation: occ.sfm || null,
      coords: occ.lat && occ.lng ? { lat: occ.lat, lng: occ.lng } : null
    }));

    // Extract unique taxa from fossil occurrences
    const uniqueTaxa = [...new Set(occData.records?.map(occ => occ.tna).filter(Boolean) || [])]
      .slice(0, 3).map(taxonName => ({
        name: taxonName,
        source: "from fossil occurrences"
      }));

    res.json({
      success: true,
      location: { lat: parseFloat(lat), lng: parseFloat(lng), radius: parseFloat(radius) },
      fossils,
      taxa: uniqueTaxa,
      source: "Paleobiology Database"
    });
  } catch (e) {
    console.error('PBDB error:', e);
    res.status(500).json({ message: e.message, success: false });
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