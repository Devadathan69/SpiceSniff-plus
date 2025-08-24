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

// NEW: Get a single batch from blockchain
async function getBatchOnChain(batchId) {
    try {
        const contract = getContract();
        
        // Try different function names
        const functionNames = ['getBatch', 'batches', 'getBatchById'];
        
        for (const funcName of functionNames) {
            if (contract[funcName]) {
                try {
                    const batch = await contract[funcName](batchId);
                    
                    if (batch && (batch.cid !== "" || batch[2] !== "")) {
                        return {
                            batchId: batchId,
                            spiceName: batch.spice || batch[1] || 'Unknown',
                            cid: batch.cid || batch[2] || 'Unknown',
                            timestamp: new Date((batch.timestamp || batch[3] || 0) * 1000).toISOString(),
                            txHash: batch.txHash || 'N/A'
                        };
                    }
                } catch (e) {
                    // Continue to next function name
                    console.log(`Function ${funcName} failed:`, e.message);
                }
            }
        }
        
        return null;
    } catch (error) {
        console.error(`Error getting batch ${batchId}:`, error);
        return null;
    }
}

async function getAllBatches() {
    try {
        const contract = getContract();
        
        // Try different possible event names
        const possibleEventNames = [
            'BatchAdded', 
            'BatchCreated', 
            'NewBatch', 
            'BatchRegistered',
            'AddBatch'
        ];
        
        let allEvents = [];
        
        for (const eventName of possibleEventNames) {
            try {
                if (contract.filters[eventName]) {
                    const filter = contract.filters[eventName]();
                    const events = await contract.queryFilter(filter, 0, 'latest');
                    allEvents = allEvents.concat(events);
                    console.log(`Found ${events.length} events for ${eventName}`);
                }
            } catch (e) {
                console.log(`Event ${eventName} not found or error:`, e.message);
            }
        }
        
        // If no events found with standard names, try to get all events
        if (allEvents.length === 0) {
            console.log('No standard events found, trying to get all events...');
            const blockNumber = await contract.provider.getBlockNumber();
            const events = await contract.queryFilter({}, blockNumber - 1000, blockNumber);
            allEvents = events;
        }
        
        console.log(`Total events found: ${allEvents.length}`);
        
        // Extract batch data from events
        const batches = [];
        const processedBatchIds = new Set();
        
        for (const event of allEvents) {
            try {
                // Try different event argument structures
                const args = event.args || {};
                let batchId, spice, cid;
                
                // Different possible argument patterns
                if (args.batch_id) {
                    batchId = args.batch_id.toString();
                    spice = args.spice;
                    cid = args.cid;
                } else if (args.batchId) {
                    batchId = args.batchId.toString();
                    spice = args.spice;
                    cid = args.cid;
                } else if (args[0]) {
                    // Generic array access
                    batchId = args[0].toString();
                    spice = args[1];
                    cid = args[2];
                }
                
                if (batchId && !processedBatchIds.has(batchId)) {
                    processedBatchIds.add(batchId);
                    
                    batches.push({
                        batchId: batchId,
                        spiceName: spice || 'Unknown',
                        cid: cid || 'Unknown',
                        timestamp: new Date().toISOString(),
                        txHash: event.transactionHash,
                        blockNumber: event.blockNumber
                    });
                }
            } catch (e) {
                console.log('Error processing event:', e.message);
            }
        }
        
        // If still no batches, try direct function call
        if (batches.length === 0) {
            console.log('Trying direct function call to get batches...');
            try {
                // Try different possible function names
                const functionNames = ['getAllBatches', 'getAllBatchIds', 'getBatches'];
                
                for (const funcName of functionNames) {
                    if (contract[funcName]) {
                        const result = await contract[funcName]();
                        if (result && result.length > 0) {
                            for (const batchId of result) {
                                const batchDetails = await getBatchOnChain(batchId.toString());
                                if (batchDetails) {
                                    batches.push(batchDetails);
                                }
                            }
                            break;
                        }
                    }
                }
            } catch (e) {
                console.log('Direct function call failed:', e.message);
            }
        }
        
        return batches;
    } catch (error) {
        console.error("Error getting all batches:", error);
        return [];
    }
}

// NEW: Function to get all batch IDs from the contract.
async function getAllBatchIds() {
    const contract = getContract();
    const batchIds = await contract.getAllBatchIds();
    // The contract returns an array of BigNumber objects, convert them to strings.
    return batchIds.map(id => id.toString());
}

module.exports = { addBatchOnChain, getBatchOnChain, getAllBatches, getAllBatchIds };
