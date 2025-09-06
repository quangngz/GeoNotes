import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

// File-based storage (in project root to avoid Live Server refresh)
const DATA_FILE = path.join(__dirname, '../../pins.json');

// Helper functions for file storage
function loadPins() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading pins:', error);
  }
  return [];
}

function savePins(pins) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(pins, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving pins:', error);
    return false;
  }
}

console.log("File-based storage initialized");

// Routes
app.get("/", (req, res) => {
  res.send("GeoNotes API is running...");
});

// Get all pins
app.get("/api/pins", (req, res) => {
  try {
    const pins = loadPins();
    res.json(pins);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create a new pin
app.post("/api/pins", (req, res) => {
  try {
    const { latitude, longitude, note } = req.body;
    
    const pins = loadPins();
    const newPin = {
      _id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      latitude,
      longitude,
      note: note || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    pins.push(newPin);
    
    if (savePins(pins)) {
      res.status(201).json(newPin);
    } else {
      res.status(500).json({ message: "Failed to save pin" });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update a pin's note
app.put("/api/pins/:id", (req, res) => {
  try {
    const { note } = req.body;
    const pins = loadPins();
    const pinIndex = pins.findIndex(pin => pin._id === req.params.id);
    
    if (pinIndex === -1) {
      return res.status(404).json({ message: "Pin not found" });
    }
    
    pins[pinIndex].note = note;
    pins[pinIndex].updatedAt = new Date().toISOString();
    
    if (savePins(pins)) {
      res.json(pins[pinIndex]);
    } else {
      res.status(500).json({ message: "Failed to update pin" });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});
 
// Delete a pin
app.delete("/api/pins/:id", (req, res) => {
  try {
    const pins = loadPins();
    const pinIndex = pins.findIndex(pin => pin._id === req.params.id);
    
    if (pinIndex === -1) {
      return res.status(404).json({ message: "Pin not found" });
    }
    
    pins.splice(pinIndex, 1);
    
    if (savePins(pins)) {
      res.json({ message: "Pin deleted successfully" });
    } else {
      res.status(500).json({ message: "Failed to delete pin" });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});