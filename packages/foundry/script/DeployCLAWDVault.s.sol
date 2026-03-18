// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import "../contracts/CLAWDVault.sol";

contract DeployCLAWDVault is ScaffoldETHDeploy {
    // CLAWD token on Base
    address constant CLAWD_TOKEN = 0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07;
    // Client wallet = owner + treasury
    address constant CLIENT_WALLET = 0xdB7720eBFdA08CDeFc7917C81c599432a3E4b65b;

    function run() external ScaffoldEthDeployerRunner {
        new CLAWDVault(CLAWD_TOKEN, CLIENT_WALLET, CLIENT_WALLET);
    }
}
