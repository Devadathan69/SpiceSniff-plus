require("dotenv").config();
const { uploadToIPFS } = require("./ipfs");
const { addBatchOnChain, getBatchOnChain } = require("./blockchain");

async function handleSpiceData(sensorData) {
const cid = await uploadToIPFS(sensorData);
console.log("✅ Uploaded to IPFS:", cid);

const { txHash, blockNumber } = await addBatchOnChain({
batch_id: sensorData.batch_id,
spice: sensorData.spice,
cid,
});
console.log("✅ On-chain:", { txHash, blockNumber });

const meta = await getBatchOnChain(sensorData.batch_id);
console.log("🔎 Read-back:", meta);
}

// Example usage
handleSpiceData({
spice: "Turmeric",
batch_id: "TURM2025-01",
device_id: "SPICESNIFF-UNIT-07",
timestamp: new Date().toISOString(),
sensor_readings: {
MQ135_air: 412,
MQ3_alcohol: 58,
BME688_voc: 120,
SGP30_eco2: 30,
DHT22_temp: 27,
DHT22_humid: 60,
},
derived_metrics: { purity_score: 92, confidence: 88, grade: "A" },
});