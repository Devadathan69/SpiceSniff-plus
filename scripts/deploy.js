const hre = require("hardhat");

async function main() {
console.log("BOOT: starting deploy script");
const [signer] = await hre.ethers.getSigners();
const addr = await signer.getAddress();
const bal = await signer.getBalance();
console.log("Deployer:", addr);
console.log("Balance (wei):", bal.toString());

console.log("Step 1: Getting contract factory…");
const Contract = await hre.ethers.getContractFactory("SpiceSniff");

console.log("Step 2: Sending deploy transaction…");
const overrides = {}; // optionally: { gasPrice: hre.ethers.utils.parseUnits("5","gwei"), gasLimit: 3000000 }
const contract = await Contract.deploy(overrides);

console.log("Step 3: Waiting for deployment tx hash…");
console.log(" tx hash:", contract.deployTransaction && contract.deployTransaction.hash);

console.log("Step 4: Waiting for contract to be deployed (mined) …");
await contract.deployed();

console.log("✅ Deployed at:", contract.address);
}

main().catch((e) => {
console.error("DEPLOY ERROR:", e);
process.exitCode = 1;
});