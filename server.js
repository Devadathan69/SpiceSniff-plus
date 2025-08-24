require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const fetch = require("node-fetch");
const { uploadToIPFS, fetchFromIPFS, checkIPFSConnection } = require("./ipfs");
const { addBatchOnChain, getBatchOnChain, getAllBatches } = require("./blockchain");

const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, { cors: { origin: '*' } });

// Allow all origins for the demo to work on your phone via LAN IP
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";

app.use(cors({
  origin: ALLOW_ORIGIN,
}));

app.use(express.json());
app.use(express.static(__dirname));

// Sensor data storage
let latestSensorData = null;
const sensorHistory = [];
const MAX_HISTORY = 100;

// Check IPFS connection on startup
let ipfsConnected = false;
(async () => {
  ipfsConnected = await checkIPFSConnection();
  app.locals.ipfsConnected = ipfsConnected;
})();

// Middleware to check IPFS connection for relevant routes
app.use(async (req, res, next) => {
  if (req.path.startsWith('/sensor') || req.path.startsWith('/ipfs/')) {
    if (!app.locals.ipfsConnected) {
      app.locals.ipfsConnected = await checkIPFSConnection();
    }
  }
  next();
});

// Health check
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    ipfs: app.locals.ipfsConnected || false
  });
});

// NEW: Accept streaming sensor data from ESP32
app.post('/api/ingest', (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.deviceId) {
      return res.status(400).json({ error: 'deviceId required' });
    }

    // Store latest reading
    data._serverTs = Date.now();
    latestSensorData = data;

    // Add to history
    sensorHistory.push(data);
    if (sensorHistory.length > MAX_HISTORY) {
      sensorHistory.shift();
    }

    // Broadcast to connected frontends
    io.emit('sensorReading', data);
    
    console.log(`📊 Sensor data received: Purity=${data.purity}, Grade=${data.grade}, Available=${data.available}`);
    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Ingest error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

// NEW: Get latest sensor reading
app.get('/api/sensor/latest', (req, res) => {
  if (!latestSensorData) {
    return res.status(404).json({ error: 'No sensor data available' });
  }
  res.json(latestSensorData);
});

// NEW: Commit latest sensor reading to blockchain
app.post('/api/sensor/commit', async (req, res) => {
  try {
    const { batchId, spice } = req.body;
    
    if (!latestSensorData) {
      return res.status(400).json({ error: 'No sensor data to commit' });
    }
    
    if (!latestSensorData.available || !latestSensorData.purity) {
      return res.status(400).json({ error: 'Sensor data not ready (warming up or invalid)' });
    }

    // Create blockchain payload
    const blockchainData = {
      batch_id: batchId,
      spice: spice,
      sensor_data: {
        deviceId: latestSensorData.deviceId,
        timestamp: latestSensorData._serverTs,
        measurements: {
          temp: latestSensorData.temp,
          rel_hum: latestSensorData.rel_hum,
          gas_kohm: latestSensorData.gas_kohm,
          mq3_rsr0: latestSensorData.mq3_rsr0,
          mq135_rsr0: latestSensorData.mq135_rsr0
        },
        purity: latestSensorData.purity,
        grade: latestSensorData.grade
      }
    };

    // Upload to IPFS and record on chain
    let cid;
    if (app.locals.ipfsConnected) {
      cid = await uploadToIPFS(blockchainData);
    } else {
      cid = `mock-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }

    const { txHash, blockNumber } = await addBatchOnChain({
      batch_id: batchId,
      spice: spice,
      cid
    });

    console.log(`✅ Committed sensor data to blockchain: ${txHash}`);
    
    res.json({
      status: 'success',
      txHash,
      blockNumber,
      cid,
      purity: latestSensorData.purity,
      grade: latestSensorData.grade
    });

  } catch (error) {
    console.error('❌ Commit error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /sensor: Accept sensor payload, store on IPFS, record CID on-chain
app.post("/sensor", async (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.batch_id || !data.spice) {
      return res.status(400).json({ error: "batch_id and spice are required", code: "BAD_INPUT" });
    }

    console.log(`Receiving data for batch: ${data.batch_id}`);
    // 1) Upload JSON to IPFS
    let cid;
    try {
      if (app.locals.ipfsConnected) {
        cid = await uploadToIPFS(data);
        console.log("✅ Uploaded to IPFS:", cid);
      } else {
        throw new Error("IPFS node not available");
      }
    } catch (ipfsError) {
      console.error("❌ IPFS upload failed, using fallback storage:", ipfsError.message);
      cid = `mock-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      console.log("⚠️ Using mock CID due to IPFS failure:", cid);
    }

    // 2) Record CID on-chain
    const { txHash, blockNumber } = await addBatchOnChain({
      batch_id: data.batch_id,
      spice: data.spice,
      cid,
    });

    console.log("✅ On-chain:", { txHash, blockNumber });
    return res.json({
      status: "success",
      cid,
      txHash,
      blockNumber,
      ipfsAvailable: app.locals.ipfsConnected
    });
  } catch (e) {
    console.error("❌ POST /sensor error:", e);
    return res.status(500).json({ error: e.message || "internal error", code: "SERVER_ERROR" });
  }
});

// GET /batch/:id: Read on-chain meta and hydrate JSON from IPFS
app.get("/batch/:id", async (req, res) => {
  try {
    const batchId = req.params.id;
    console.log(`Retrieving batch: ${batchId}`);

    // 1) Get metadata from the blockchain.
    const meta = await getBatchOnChain(batchId);

    if (!meta || !meta.cid) {
      return res.status(404).json({ error: "Not found", code: "BATCH_NOT_FOUND" });
    }

    // 2) Fetch JSON from the local IPFS gateway.
    const json = await fetchFromIPFS(meta.cid);
    
    return res.json({ ...meta, data: json });
  } catch (e) {
    console.error("❌ GET /batch/:id error:", e);
    return res.status(500).json({ error: e.message || "internal error", code: "SERVER_ERROR" });
  }
});

// GET /batches: Get all batches from blockchain
app.get("/batches", async (_req, res) => {
  try {
    console.log("Fetching all batches from blockchain.");
    
    // 1) Get all batches using events
    const allBatches = await getAllBatches();
    
    // If no batches found, return empty array instead of error
    if (!allBatches || allBatches.length === 0) {
      console.log("No batches found in blockchain");
      return res.json([]);
    }
    
    return res.json(allBatches);
  } catch (e) {
    console.error("❌ GET /batches error:", e);
    // Return empty array instead of error to prevent frontend crash
    return res.json([]);
  }
});

// System status endpoint
app.get("/status", async (req, res) => {
  try {
    const ipfsStatus = app.locals.ipfsConnected || false;
    let blockchainStatus = true;
    try {
      await getAllBatches();
    } catch (blockchainError) {
      console.warn("Blockchain status check failed:", blockchainError.message);
      blockchainStatus = false;
    }

    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      services: {
        ipfs: ipfsStatus,
        blockchain: blockchainStatus,
        server: true
      },
      version: "1.0.0"
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Socket.IO connection handler
io.on('connection', (socket) => {
  console.log('🔌 Frontend connected');
  
  // Send latest data immediately
  if (latestSensorData) {
    socket.emit('sensorReading', latestSensorData);
  }
  
  socket.on('disconnect', () => {
    console.log('🔌 Frontend disconnected');
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    timestamp: new Date().toISOString()
  });
});
// Add this route in server.js (before the 404 handler)
app.post('/api/ingest', (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.deviceId) {
      return res.status(400).json({ error: 'deviceId required' });
    }

    // Store latest reading
    data._serverTs = Date.now();
    latestSensorData = data;

    // Add to history
    sensorHistory.push(data);
    if (sensorHistory.length > MAX_HISTORY) {
      sensorHistory.shift();
    }

    // Broadcast to connected frontends
    io.emit('sensorReading', data);
    
    console.log(`📊 Sensor data received: Purity=${data.purity}, Grade=${data.grade}, Available=${data.available}`);
    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Ingest error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});
app.get('/api/ingest', (req, res) => {
  res.json({
    message: 'ESP32 sensor data endpoint',
    method: 'This endpoint accepts POST requests',
    latestData: latestSensorData || null,
    totalReadings: sensorHistory.length,
    status: 'Server is running'
  });
});
// Add this route to server.js for debugging
// Add this to server.js
app.get("/debug/contract-events", async (req, res) => {
    try {
        const { getContract } = require("./blockchain");
        const contract = getContract();
        
        // Get ALL events from the contract
        const allEvents = [];
        const eventNames = Object.keys(contract.interface.events);
        
        for (const eventName of eventNames) {
            try {
                const filter = contract.filters[eventName]();
                const events = await contract.queryFilter(filter, 0, 'latest');
                allEvents.push({
                    eventName: eventName,
                    count: events.length,
                    sample: events.length > 0 ? events[0] : null
                });
            } catch (e) {
                allEvents.push({
                    eventName: eventName,
                    error: e.message
                });
            }
        }
        
        res.json({
            totalEvents: allEvents.reduce((sum, evt) => sum + (evt.count || 0), 0),
            events: allEvents
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    code: 'NOT_FOUND',
    path: req.path,
    timestamp: new Date().toISOString()
  });
});

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 SpiceSniff+ API server running at http://0.0.0.0:${PORT}`);
  console.log(`📋 Health check: http://0.0.0.0:${PORT}/health`);
  console.log(`📊 System status: http://0.0.0.0:${PORT}/status`);
  console.log(`📡 Real-time sensor endpoint: /api/ingest`);
  console.log(`🌐 Allowed origins: ${ALLOW_ORIGIN}`);
});
