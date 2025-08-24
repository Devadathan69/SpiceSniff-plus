// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract SpiceSniff {
    struct Batch {
        string spiceName;
        string cid;
        uint256 timestamp;
    }

    mapping(string => Batch) public batches;
    string[] public batchIds;

    event BatchAdded(string batchId, string spiceName, string cid, uint256 timestamp);

    function addBatch(string memory batchId, string memory spiceName, string memory cid) public {
        batches[batchId] = Batch(spiceName, cid, block.timestamp);
        batchIds.push(batchId);
        emit BatchAdded(batchId, spiceName, cid, block.timestamp);
    }

    function getBatch(string memory batchId) public view returns (string memory, string memory, uint256) {
        Batch memory b = batches[batchId];
        return (b.spiceName, b.cid, b.timestamp);
    }

    function getAllBatchIds() public view returns (string[] memory) {
        return batchIds;
    }
}