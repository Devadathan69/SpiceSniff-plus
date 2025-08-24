const { ethers } = require("ethers");

const artifact = require("./artifacts/contracts/SpiceSniff.sol/SpiceSniff.json");

const CONTRACT_ADDRESS = "0x81A0cB195844c92A47Cc5A784F05749074B0417a";

function getSigner() {
    const provider = new ethers.providers.JsonRpcProvider(
        `https://sepolia.infura.io/v3/${process.env.INFURA_API_KEY}`
    );
    return new ethers.Wallet(process.env.PRIVATE_KEY, provider);
}

function getContract() {
    const signer = getSigner();
    return new ethers.Contract(CONTRACT_ADDRESS, artifact.abi, signer);
}

async function addBatchOnChain({ batch_id, spice, cid }) {
    try {
        const contract = getContract();
        const tx = await contract.addBatch(batch_id, spice, cid);
        const receipt = await tx.wait();
        return { txHash: receipt.transactionHash, blockNumber: receipt.blockNumber };
    } catch (error) {
        console.error("Error adding batch to blockchain:", error);
        throw error;
    }
}

async function getBatchOnChain(batchId) {
    try {
        const contract = getContract();
        const [spiceName, cid, ts] = await contract.getBatch(batchId);
        return { spiceName, cid, timestamp: Number(ts) };
    } catch (error) {
        console.error(`Error getting batch ${batchId} from blockchain:`, error);
        throw error;
    }
}

// Fixed function to get all batches using events with better error handling
async function getAllBatches() {
    try {
        const contract = getContract();
        
        // Get all BatchAdded events from the contract
        const filter = contract.filters.BatchAdded();
        const events = await contract.queryFilter(filter, 0, 'latest');
        
        if (!events || events.length === 0) {
            console.log("No BatchAdded events found");
            return [];
        }
        
        // Extract unique batch IDs from events with proper error handling
        const batchIds = [];
        for (const event of events) {
            try {
                if (event.args && event.args.batch_id) {
                    const batchId = event.args.batch_id.toString();
                    if (!batchIds.includes(batchId)) {
                        batchIds.push(batchId);
                    }
                }
            } catch (parseError) {
                console.warn(`Could not parse event args:`, parseError.message);
                continue;
            }
        }
        
        if (batchIds.length === 0) {
            console.log("No valid batch IDs found in events");
            return [];
        }
        
        // Get details for each batch
        const batches = [];
        for (const batchId of batchIds) {
            try {
                const batchDetails = await getBatchOnChain(batchId);
                if (batchDetails && batchDetails.cid) {
                    batches.push({
                        batchId,
                        spiceName: batchDetails.spiceName,
                        cid: batchDetails.cid,
                        timestamp: batchDetails.timestamp
                    });
                }
            } catch (error) {
                console.error(`Error fetching details for batch ${batchId}:`, error.message);
                // Continue with other batches even if one fails
            }
        }
        
        return batches;
    } catch (error) {
        console.error("Error getting all batches:", error);
        // Return empty array instead of throwing to prevent frontend crash
        return [];
    }
}


module.exports = { addBatchOnChain, getBatchOnChain, getAllBatches };
