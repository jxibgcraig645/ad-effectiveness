// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32 } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AdEffectivenessFHE is SepoliaConfig {
    struct EncryptedAdData {
        uint256 adId;
        euint32 encryptedImpressions;
        euint32 encryptedClicks;
        euint32 encryptedConversions;
        uint256 timestamp;
    }

    struct DecryptedAdData {
        uint32 impressions;
        uint32 clicks;
        uint32 conversions;
        bool isDecrypted;
    }

    uint256 public adDataCount;
    mapping(uint256 => EncryptedAdData) public encryptedAdRecords;
    mapping(uint256 => DecryptedAdData) public decryptedAdRecords;

    mapping(uint256 => uint256) private decryptionRequests;

    event AdDataSubmitted(uint256 indexed adId, uint256 timestamp);
    event DecryptionRequested(uint256 indexed adId);
    event AdDataDecrypted(uint256 indexed adId);

    modifier onlyAdvertiser(uint256 adId) {
        _;
    }

    function submitEncryptedAdData(
        euint32 encryptedImpressions,
        euint32 encryptedClicks,
        euint32 encryptedConversions
    ) public {
        adDataCount += 1;
        uint256 newAdId = adDataCount;

        encryptedAdRecords[newAdId] = EncryptedAdData({
            adId: newAdId,
            encryptedImpressions: encryptedImpressions,
            encryptedClicks: encryptedClicks,
            encryptedConversions: encryptedConversions,
            timestamp: block.timestamp
        });

        decryptedAdRecords[newAdId] = DecryptedAdData({
            impressions: 0,
            clicks: 0,
            conversions: 0,
            isDecrypted: false
        });

        emit AdDataSubmitted(newAdId, block.timestamp);
    }

    function requestAdDataDecryption(uint256 adId) public onlyAdvertiser(adId) {
        EncryptedAdData storage data = encryptedAdRecords[adId];
        require(!decryptedAdRecords[adId].isDecrypted, "Already decrypted");

        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(data.encryptedImpressions);
        ciphertexts[1] = FHE.toBytes32(data.encryptedClicks);
        ciphertexts[2] = FHE.toBytes32(data.encryptedConversions);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptAdData.selector);
        decryptionRequests[reqId] = adId;

        emit DecryptionRequested(adId);
    }

    function decryptAdData(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        uint256 adId = decryptionRequests[requestId];
        require(adId != 0, "Invalid request");

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32[] memory results = abi.decode(cleartexts, (uint32[]));

        DecryptedAdData storage dData = decryptedAdRecords[adId];
        dData.impressions = results[0];
        dData.clicks = results[1];
        dData.conversions = results[2];
        dData.isDecrypted = true;

        emit AdDataDecrypted(adId);
    }

    function getDecryptedAdData(uint256 adId) public view returns (uint32 impressions, uint32 clicks, uint32 conversions, bool isDecrypted) {
        DecryptedAdData storage dData = decryptedAdRecords[adId];
        return (dData.impressions, dData.clicks, dData.conversions, dData.isDecrypted);
    }

    function aggregateEncryptedAdData(uint256[] memory adIds) public view returns (euint32 totalImpressions, euint32 totalClicks, euint32 totalConversions) {
        totalImpressions = FHE.asEuint32(0);
        totalClicks = FHE.asEuint32(0);
        totalConversions = FHE.asEuint32(0);

        for (uint i = 0; i < adIds.length; i++) {
            EncryptedAdData storage data = encryptedAdRecords[adIds[i]];
            totalImpressions = FHE.add(totalImpressions, data.encryptedImpressions);
            totalClicks = FHE.add(totalClicks, data.encryptedClicks);
            totalConversions = FHE.add(totalConversions, data.encryptedConversions);
        }
    }
}
