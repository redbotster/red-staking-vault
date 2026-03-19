// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IRedBotsterStaking {
    function getUserTotalStaked(address user) external view returns (uint256);
    function totalStakedGlobal() external view returns (uint256);
}

contract BotsterRewards is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable botsterToken;
    IRedBotsterStaking public immutable staking;

    uint256 public immutable startTime;

    uint256 public constant EPOCH_DURATION = 180 days;
    uint256 public constant EPOCH_0_TOKENS = 2_500_000_000e18;
    // INITIAL_RATE = 2,500,000,000e18 / (180 * 86400) ≈ 160.75e18 per second
    uint256 public constant INITIAL_RATE = EPOCH_0_TOKENS / EPOCH_DURATION;

    // Global accounting
    uint256 public rewardPerTokenStored;
    uint256 public lastUpdateTime;

    // Per-user accounting
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;
    // Snapshot of user's staked balance at last sync
    mapping(address => uint256) public userStakedSnapshot;

    event Synced(address indexed user, uint256 earned);
    event Claimed(address indexed user, uint256 amount);
    event EmergencyWithdraw(address indexed owner, uint256 amount);

    constructor(address _botsterToken, address _staking, address _owner) Ownable(_owner) {
        botsterToken = IERC20(_botsterToken);
        staking = IRedBotsterStaking(_staking);
        startTime = block.timestamp;
        lastUpdateTime = block.timestamp;
    }

    function currentEpoch() public view returns (uint256) {
        return (block.timestamp - startTime) / EPOCH_DURATION;
    }

    function rateForEpoch(uint256 epoch) public pure returns (uint256) {
        return INITIAL_RATE >> epoch;
    }

    function rewardPerToken() public view returns (uint256) {
        uint256 totalStaked = staking.totalStakedGlobal();
        if (totalStaked == 0) {
            return rewardPerTokenStored;
        }
        return rewardPerTokenStored + _pendingRewardPerToken(lastUpdateTime, block.timestamp, totalStaked);
    }

    function earned(address account) public view returns (uint256) {
        uint256 stakedBal = staking.getUserTotalStaked(account);
        return rewards[account]
            + (stakedBal * (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18;
    }

    function sync(address account) external {
        _updateReward(account);
    }

    function claim() external {
        _updateReward(msg.sender);
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            botsterToken.safeTransfer(msg.sender, reward);
            emit Claimed(msg.sender, reward);
        }
    }

    function emergencyWithdraw() external onlyOwner {
        uint256 balance = botsterToken.balanceOf(address(this));
        botsterToken.safeTransfer(owner(), balance);
        emit EmergencyWithdraw(owner(), balance);
    }

    // -- Internal --

    function _updateReward(address account) internal {
        uint256 totalStaked = staking.totalStakedGlobal();
        if (totalStaked > 0) {
            rewardPerTokenStored += _pendingRewardPerToken(lastUpdateTime, block.timestamp, totalStaked);
        }
        lastUpdateTime = block.timestamp;

        if (account != address(0)) {
            uint256 stakedBal = staking.getUserTotalStaked(account);
            rewards[account] = rewards[account]
                + (userStakedSnapshot[account] * (rewardPerTokenStored - userRewardPerTokenPaid[account])) / 1e18;
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
            userStakedSnapshot[account] = stakedBal;
            emit Synced(account, rewards[account]);
        }
    }

    /// @dev Computes reward-per-token accrued between `from` and `to`, handling epoch boundaries.
    function _pendingRewardPerToken(uint256 from, uint256 to, uint256 totalStaked) internal view returns (uint256) {
        if (from >= to) return 0;

        uint256 accumulated = 0;
        uint256 cursor = from;

        while (cursor < to) {
            uint256 epoch = (cursor - startTime) / EPOCH_DURATION;
            uint256 rate = rateForEpoch(epoch);

            // If rate has halved to zero, no more rewards
            if (rate == 0) break;

            uint256 epochEnd = startTime + (epoch + 1) * EPOCH_DURATION;
            uint256 segmentEnd = to < epochEnd ? to : epochEnd;
            uint256 dt = segmentEnd - cursor;

            accumulated += (dt * rate * 1e18) / totalStaked;
            cursor = segmentEnd;
        }

        return accumulated;
    }
}
