// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/BotsterToken.sol";
import "../contracts/BotsterRewards.sol";

// Mock staking contract that simulates RedBotsterStaking
contract MockStaking is IRedBotsterStaking {
    mapping(address => uint256) public stakes;
    uint256 public total;

    function setStake(address user, uint256 amount) external {
        total = total - stakes[user] + amount;
        stakes[user] = amount;
    }

    function getUserTotalStaked(address user) external view returns (uint256) {
        return stakes[user];
    }

    function totalStakedGlobal() external view returns (uint256) {
        return total;
    }
}

contract BotsterRewardsTest is Test {
    BotsterToken public token;
    BotsterRewards public rewards;
    MockStaking public staking;

    address owner = address(0xBEEF);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    uint256 constant REWARDS_ALLOCATION = 5_000_000_000e18;
    uint256 constant EPOCH_DURATION = 180 days;

    function setUp() public {
        token = new BotsterToken(owner);
        staking = new MockStaking();
        rewards = new BotsterRewards(address(token), address(staking), owner);

        // Fund rewards contract with 5B
        vm.prank(owner);
        token.transfer(address(rewards), REWARDS_ALLOCATION);
    }

    function test_initialState() public view {
        assertEq(token.balanceOf(address(rewards)), REWARDS_ALLOCATION);
        assertEq(rewards.currentEpoch(), 0);
        assertEq(rewards.rewardPerTokenStored(), 0);
    }

    function test_rateForEpoch() public view {
        uint256 epoch0Rate = rewards.rateForEpoch(0);
        uint256 epoch1Rate = rewards.rateForEpoch(1);
        uint256 epoch2Rate = rewards.rateForEpoch(2);

        assertEq(epoch0Rate, 2_500_000_000e18 / EPOCH_DURATION);
        assertEq(epoch1Rate, epoch0Rate / 2);
        assertEq(epoch2Rate, epoch0Rate / 4);
    }

    function test_earnedAccruesOverTime() public {
        staking.setStake(alice, 1000e18);
        rewards.sync(alice);

        vm.warp(block.timestamp + 100);

        uint256 earned = rewards.earned(alice);
        // Alice is the only staker, so she gets full rate for 100 seconds
        // Small rounding from 1e18 scaling in rewardPerToken math
        uint256 expectedRate = rewards.rateForEpoch(0);
        assertApproxEqAbs(earned, expectedRate * 100, 1000);
    }

    function test_twoStakersSplitRewards() public {
        staking.setStake(alice, 1000e18);
        staking.setStake(bob, 1000e18);
        rewards.sync(alice);
        rewards.sync(bob);

        vm.warp(block.timestamp + 100);

        uint256 aliceEarned = rewards.earned(alice);
        uint256 bobEarned = rewards.earned(bob);

        // Equal stakes = equal share
        assertEq(aliceEarned, bobEarned);

        uint256 expectedRate = rewards.rateForEpoch(0);
        // Each gets half of total (rounding from 1e18 scaling)
        assertApproxEqAbs(aliceEarned, (expectedRate * 100) / 2, 1000);
    }

    function test_proportionalRewards() public {
        staking.setStake(alice, 3000e18);
        staking.setStake(bob, 1000e18);
        rewards.sync(alice);
        rewards.sync(bob);

        vm.warp(block.timestamp + 100);

        uint256 aliceEarned = rewards.earned(alice);
        uint256 bobEarned = rewards.earned(bob);

        // Alice has 3x bob's stake
        assertApproxEqAbs(aliceEarned, bobEarned * 3, 1);
    }

    function test_claimTransfersTokens() public {
        staking.setStake(alice, 1000e18);
        rewards.sync(alice);

        vm.warp(block.timestamp + 100);

        uint256 expectedEarned = rewards.earned(alice);
        assertGt(expectedEarned, 0);

        vm.prank(alice);
        rewards.claim();

        assertEq(token.balanceOf(alice), expectedEarned);
        assertEq(rewards.earned(alice), 0);
    }

    function test_claimTwice() public {
        staking.setStake(alice, 1000e18);
        rewards.sync(alice);

        vm.warp(block.timestamp + 100);
        vm.prank(alice);
        rewards.claim();
        uint256 firstClaim = token.balanceOf(alice);

        vm.warp(block.timestamp + 100);
        vm.prank(alice);
        rewards.claim();
        uint256 secondClaim = token.balanceOf(alice) - firstClaim;

        // Both claims should be roughly equal (same duration, same rate)
        assertApproxEqAbs(firstClaim, secondClaim, 1);
    }

    function test_syncAfterStakeChange() public {
        staking.setStake(alice, 1000e18);
        rewards.sync(alice);

        vm.warp(block.timestamp + 100);

        // Sync BEFORE stake change to lock in rewards at old totalStaked
        rewards.sync(alice);
        uint256 earnedAfterSync = rewards.rewards(alice);
        uint256 expectedRate = rewards.rateForEpoch(0);
        assertApproxEqAbs(earnedAfterSync, expectedRate * 100, 1000);

        // Now increase stake and sync again
        staking.setStake(alice, 2000e18);
        rewards.sync(alice);
        // Rewards should not change (no time passed)
        assertEq(rewards.rewards(alice), earnedAfterSync);
    }

    function test_epochTransition() public {
        staking.setStake(alice, 1000e18);
        rewards.sync(alice);

        // Warp to epoch 1
        vm.warp(block.timestamp + EPOCH_DURATION + 100);
        assertEq(rewards.currentEpoch(), 1);

        uint256 earned = rewards.earned(alice);
        // Should include full epoch 0 + 100 seconds of epoch 1
        uint256 epoch0Rate = rewards.rateForEpoch(0);
        uint256 epoch1Rate = rewards.rateForEpoch(1);
        uint256 expected = epoch0Rate * EPOCH_DURATION + epoch1Rate * 100;
        assertApproxEqAbs(earned, expected, 1000);
    }

    function test_halvingRateCorrect() public view {
        uint256 epoch0Rate = rewards.rateForEpoch(0);
        assertEq(rewards.rateForEpoch(1), epoch0Rate / 2);
        assertEq(rewards.rateForEpoch(2), epoch0Rate / 4);
        assertEq(rewards.rateForEpoch(3), epoch0Rate / 8);
    }

    function test_noStakersNoAccrual() public {
        // No stakers — rewardPerToken shouldn't change
        vm.warp(block.timestamp + 1000);
        assertEq(rewards.rewardPerToken(), 0);
    }

    function test_emergencyWithdraw() public {
        vm.prank(owner);
        rewards.emergencyWithdraw();
        assertEq(token.balanceOf(owner), token.totalSupply()); // owner gets back everything
        assertEq(token.balanceOf(address(rewards)), 0);
    }

    function test_emergencyWithdrawNotOwnerReverts() public {
        vm.prank(alice);
        vm.expectRevert();
        rewards.emergencyWithdraw();
    }

    function test_syncPermissionless() public {
        staking.setStake(alice, 1000e18);
        // Bob can sync alice's rewards
        vm.prank(bob);
        rewards.sync(alice);
        // Should not revert
    }

    function test_zeroEarnedBeforeSync() public view {
        assertEq(rewards.earned(alice), 0);
    }

    function test_claimWithNoRewards() public {
        vm.prank(alice);
        rewards.claim();
        // Should not revert, just transfer 0
        assertEq(token.balanceOf(alice), 0);
    }

    function test_lateStakerGetsNoBackpay() public {
        staking.setStake(alice, 1000e18);
        rewards.sync(alice);

        vm.warp(block.timestamp + 1000);

        // Bob stakes and syncs late
        staking.setStake(bob, 1000e18);
        rewards.sync(bob);

        // Bob should have 0 earned at this point
        assertEq(rewards.rewards(bob), 0);

        // Move forward another 1000 seconds
        vm.warp(block.timestamp + 1000);

        uint256 bobEarned = rewards.earned(bob);
        uint256 aliceEarned = rewards.earned(alice);

        // Alice earned for 2000s, bob for 1000s (but at split rate for the last 1000s)
        assertGt(aliceEarned, bobEarned);
    }
}
