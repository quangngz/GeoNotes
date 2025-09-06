// server.js - Updated backend to support region data
const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mapnotes';

app.use(cors());
app.use(express.json());

let db;

// Connect to MongoDB
MongoClient.connect(MONGODB_URI)
  .then(client => {
    console.log('Connected to MongoDB');
    db = client.db('mapnotes');
  })
  .catch(error => console.error('MongoDB connection error:', error));

// Updated Pin schema with region support
const pinSchema = {
  latitude: 'number',
  longitude: 'number',
  note: 'string',
  country: 'string',    // New field
  region: 'string',     // New field
  createdAt: 'date',
  updatedAt: 'date'
};

// Get all pins
app.get('/api/pins/search', async (req, res) => {
  try {
    const { region, country, text, locationName } = req.query;
    const searchQuery = {};
    
    if (region) {
      searchQuery.region = new RegExp(region, 'i');
    }
    if (country) {
      searchQuery.country = new RegExp(country, 'i');
    }
    if (text) {
      searchQuery.note = new RegExp(text, 'i');
    }
    if (locationName) {
      searchQuery.locationName = new RegExp(locationName, 'i');
    }
    
    const pins = await db.collection('pins').find(searchQuery).toArray();
    res.json(pins);
  } catch (error) {
    console.error('Error searching pins:', error);
    res.status(500).json({ error: 'Failed to search pins' });
  }
});

// Create a new pin
app.post('/api/pins', async (req, res) => {
  try {
    const { latitude, longitude, note, country, region } = req.body;
    
    const pin = {
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      note: note || '',
      country: country || null,
      region: region || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const result = await db.collection('pins').insertOne(pin);
    const savedPin = await db.collection('pins').findOne({ _id: result.insertedId });
    
    res.status(201).json(savedPin);
  } catch (error) {
    console.error('Error creating pin:', error);
    res.status(500).json({ error: 'Failed to create pin' });
  }
});

// Update a pin
app.put('/api/pins/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { note, country, region } = req.body;
    
    const updateData = {
      updatedAt: new Date()
    };
    
    if (note !== undefined) updateData.note = note;
    if (country !== undefined) updateData.country = country;
    if (region !== undefined) updateData.region = region;
    
    const result = await db.collection('pins').updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Pin not found' });
    }
    
    const updatedPin = await db.collection('pins').findOne({ _id: new ObjectId(id) });
    res.json(updatedPin);
  } catch (error) {
    console.error('Error updating pin:', error);
    res.status(500).json({ error: 'Failed to update pin' });
  }
});

// Delete a pin
app.delete('/api/pins/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.collection('pins').deleteOne({ _id: new ObjectId(id) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Pin not found' });
    }
    
    res.json({ message: 'Pin deleted successfully' });
  } catch (error) {
    console.error('Error deleting pin:', error);
    res.status(500).json({ error: 'Failed to delete pin' });
  }
});

// New endpoint: Search pins by region
app.get('/api/pins/search', async (req, res) => {
  try {
    const { region, country, text } = req.query;
    const searchQuery = {};
    
    if (region) {
      searchQuery.region = new RegExp(region, 'i');
    }
    
    if (country) {
      searchQuery.country = new RegExp(country, 'i');
    }
    
    if (text) {
      searchQuery.note = new RegExp(text, 'i');
    }
    
    const pins = await db.collection('pins').find(searchQuery).toArray();
    res.json(pins);
  } catch (error) {
    console.error('Error searching pins:', error);
    res.status(500).json({ error: 'Failed to search pins' });
  }
});

// New endpoint: Get unique regions and countries
app.get('/api/regions', async (req, res) => {
  try {
    const regions = await db.collection('pins').aggregate([
      {
        $group: {
          _id: null,
          countries: { $addToSet: "$country" },
          regions: { $addToSet: "$region" }
        }
      }
    ]).toArray();
    
    const result = regions[0] || { countries: [], regions: [] };
    // Filter out null values
    result.countries = result.countries.filter(c => c !== null);
    result.regions = result.regions.filter(r => r !== null);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching regions:', error);
    res.status(500).json({ error: 'Failed to fetch regions' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});