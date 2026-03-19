// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DeployHelpers.s.sol";
import "../contracts/BotsterToken.sol";
import "../contracts/BotsterRewards.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract DeployBotster is ScaffoldETHDeploy {
    // Existing RedBotsterStaking on Base (immutable)
    address constant STAKING = 0xaff101e17c735F3b8F5209FC9ff3AfaEc86fb6Cf;
    uint256 constant REWARDS_ALLOCATION = 5_000_000_000e18;

    function run() external ScaffoldEthDeployerRunner {
        // Deploy token — all 10B minted to deployer
        BotsterToken token = new BotsterToken(deployer);

        // Deploy rewards — owner = deployer
        BotsterRewards rewards = new BotsterRewards(address(token), STAKING, deployer);

        // Transfer 5B to rewards contract
        IERC20(address(token)).transfer(address(rewards), REWARDS_ALLOCATION);
    }
}
