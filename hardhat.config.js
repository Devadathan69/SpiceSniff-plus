const { config } = require("dotenv");
config();
require("@nomiclabs/hardhat-ethers");

module.exports = {
solidity: "0.8.19",
networks: {
sepolia: {
url: `https://sepolia.infura.io/v3/${process.env.INFURA_API_KEY}`,
accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
},
},
mocha: { timeout: 60000 },
};