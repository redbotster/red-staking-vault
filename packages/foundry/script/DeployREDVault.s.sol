// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import "../contracts/REDVault.sol";

contract DeployREDVault is ScaffoldETHDeploy {
    // RED (Red Botster) token on Base
    address constant RED_TOKEN = 0x2e662015a501f066e043d64d04f77ffe551a4b07;
    // RedBotster punkwallet = owner + treasury
    address constant TREASURY = 0xEF5527cC704C5Ca5443869EAECbB8613d9D97E5F;

    function run() external ScaffoldEthDeployerRunner {
        new REDVault(RED_TOKEN, TREASURY, TREASURY);
    }
}
