const { create } = require("ipfs-http-client");

// Create IPFS client with better configuration
const client = create({
  host: process.env.IPFS_HOST || "127.0.0.1",
  port: process.env.IPFS_PORT || 5001,
  protocol: process.env.IPFS_PROTOCOL || "http",
  timeout: process.env.IPFS_TIMEOUT || 30000, // 30 second timeout
});

/**
 * Uploads data to IPFS and returns the CID.
 * @param {object} data The JSON object to upload.
 * @returns {string} The CID of the uploaded data.
 */
async function uploadToIPFS(data) {
  try {
    const content = JSON.stringify(data);
    const result = await client.add(content);
    
    // Pin the content to ensure it persists
    try {
      await client.pin.add(result.cid);
      console.log(`✅ Pinned content with CID: ${result.cid}`);
    } catch (pinError) {
      console.warn(`⚠️ Could not pin content: ${pinError.message}`);
      // Continue even if pinning fails
    }
    
    return result.cid.toString();
  } catch (error) {
    console.error("❌ IPFS Upload Error:", error);
    throw new Error(`IPFS upload failed: ${error.message}`);
  }
}

/**
 * Fetches JSON data from IPFS using a CID.
 * @param {string} cid The CID of the data to fetch.
 * @returns {object} The JSON object from IPFS.
 */
async function fetchFromIPFS(cid) {
  try {
    // Try local IPFS node first
    const stream = client.cat(cid);
    let data = "";
    
    for await (const chunk of stream) {
      data += chunk.toString();
    }
    
    return JSON.parse(data);
  } catch (localError) {
    console.warn(`❌ Local IPFS fetch failed for CID ${cid}:`, localError.message);
    
    // Fallback to public gateways if local IPFS fails
    const publicGateways = [
      `https://ipfs.io/ipfs/${cid}`,
      `https://gateway.pinata.cloud/ipfs/${cid}`,
      `https://cloudflare-ipfs.com/ipfs/${cid}`,
      `https://dweb.link/ipfs/${cid}`
    ];
    
    for (const gateway of publicGateways) {
      try {
        console.log(`Trying public gateway: ${gateway}`);
        const response = await fetch(gateway, { timeout: 10000 });
        
        if (response.ok) {
          const data = await response.json();
          console.log(`✅ Successfully fetched from gateway: ${gateway}`);
          return data;
        }
      } catch (gatewayError) {
        console.warn(`Gateway ${gateway} failed: ${gatewayError.message}`);
        continue;
      }
    }
    
    throw new Error(`Could not fetch CID ${cid} from any IPFS gateway`);
  }
}

/**
 * Checks if IPFS daemon is running and accessible
 */
async function checkIPFSConnection() {
  try {
    const version = await client.version();
    console.log(`✅ Connected to IPFS node version ${version.version}`);
    return true;
  } catch (error) {
    console.error("❌ IPFS node is not available:", error.message);
    return false;
  }
}

module.exports = { uploadToIPFS, fetchFromIPFS, checkIPFSConnection };