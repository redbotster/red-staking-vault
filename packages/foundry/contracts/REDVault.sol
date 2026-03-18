// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/// @title IStrategy - Pluggable yield strategy interface
interface IStrategy {
    /// @notice Deposit RED into the strategy
    function deposit(uint256 amount) external;
    /// @notice Withdraw RED from the strategy
    function withdraw(uint256 amount) external returns (uint256 withdrawn);
    /// @notice Harvest rewards, returning them as RED to the vault
    function harvest() external returns (uint256 harvested);
    /// @notice Total RED managed by this strategy
    function totalAssets() external view returns (uint256);
    /// @notice The underlying token (should be RED)
    function want() external view returns (address);
}

/// @title REDVault - Auto-compounding ERC4626-style vault for RED
/// @notice Deposit RED → receive stRED shares. Auto-compounds yield via strategies.
/// @dev NOT a strict ERC4626 due to lock tier logic, but follows the pattern closely.
contract REDVault is ERC20, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    // ─── Constants ───────────────────────────────────────────────────
    IERC20 public immutable red;
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // ─── Fee config (basis points) ──────────────────────────────────
    uint256 public constant FEE_BPS = 50; // 0.5%
    uint256 public constant FEE_BURN_SHARE = 5000;     // 50% of fee burned
    uint256 public constant FEE_TREASURY_SHARE = 2500;  // 25% to treasury
    uint256 public constant FEE_STAKER_SHARE = 2500;    // 25% to stakers (added to vault)
    uint256 public constant BPS = 10000;

    // ─── Lock tiers ─────────────────────────────────────────────────
    enum LockTier { NONE, THREE_MONTH, SIX_MONTH, ONE_YEAR }

    struct LockTierConfig {
        uint256 duration;       // lock duration in seconds
        uint256 feeDiscount;    // fee discount in BPS (e.g., 2000 = 20% discount on the 0.5% fee)
        uint256 yieldMultiplier; // multiplier in BPS (e.g., 10000 = 1x, 12000 = 1.2x)
    }

    mapping(LockTier => LockTierConfig) public lockTierConfigs;

    // ─── User state ─────────────────────────────────────────────────
    struct UserDeposit {
        uint256 shares;
        uint256 lockExpiry;
        LockTier tier;
    }

    mapping(address => UserDeposit) public userDeposits;

    // ─── Strategy management ────────────────────────────────────────
    IStrategy[] public strategies;
    mapping(address => bool) public isStrategy;

    // ─── Treasury ───────────────────────────────────────────────────
    address public treasury;

    // ─── ERC4626 inflation attack protection ─────────────────────────
    uint256 public constant VIRTUAL_SHARES = 1e6;
    uint256 public constant VIRTUAL_ASSETS = 1e6;

    // ─── Strategy limit ─────────────────────────────────────────────
    uint256 public constant MAX_STRATEGIES = 10;

    // ─── Idle RED (not deployed to strategies) ────────────────────
    // totalAssets = idleBalance + sum(strategy.totalAssets())

    // ─── Events ─────────────────────────────────────────────────────
    event Deposited(address indexed user, uint256 assets, uint256 shares, LockTier tier);
    event Withdrawn(address indexed user, uint256 assets, uint256 shares);
    event Compounded(address indexed caller, uint256 totalHarvested, uint256 feeBurned, uint256 feeTreasury, uint256 feeStakers);
    event StrategyAdded(address indexed strategy);
    event StrategyRemoved(address indexed strategy);
    event TreasuryUpdated(address indexed newTreasury);

    // ─── Errors ─────────────────────────────────────────────────────
    error ZeroAmount();
    error LockNotExpired(uint256 expiry);
    error InsufficientShares(uint256 requested, uint256 available);
    error StrategyAlreadyAdded();
    error StrategyNotFound();
    error InvalidStrategy();
    error ZeroAddress();

    constructor(
        address _red,
        address _treasury,
        address _owner
    ) ERC20("Staked RED", "stRED") Ownable(_owner) {
        if (_red == address(0) || _treasury == address(0) || _owner == address(0)) revert ZeroAddress();
        red = IERC20(_red);
        treasury = _treasury;

        // Configure lock tiers
        lockTierConfigs[LockTier.NONE] = LockTierConfig({
            duration: 0,
            feeDiscount: 0,
            yieldMultiplier: 10000 // 1x
        });
        lockTierConfigs[LockTier.THREE_MONTH] = LockTierConfig({
            duration: 90 days,
            feeDiscount: 1000, // 10% discount
            yieldMultiplier: 10500 // 1.05x
        });
        lockTierConfigs[LockTier.SIX_MONTH] = LockTierConfig({
            duration: 180 days,
            feeDiscount: 2500, // 25% discount
            yieldMultiplier: 11500 // 1.15x
        });
        lockTierConfigs[LockTier.ONE_YEAR] = LockTierConfig({
            duration: 365 days,
            feeDiscount: 5000, // 50% discount
            yieldMultiplier: 13000 // 1.3x
        });
    }

    // ─── View functions ─────────────────────────────────────────────

    /// @notice Total RED managed by the vault (idle + strategies)
    function totalAssets() public view returns (uint256 total) {
        total = red.balanceOf(address(this));
        for (uint256 i = 0; i < strategies.length; i++) {
            total += strategies[i].totalAssets();
        }
    }

    /// @notice Convert assets to shares (for deposit) — uses virtual offset to prevent inflation attack
    function convertToShares(uint256 assets) public view returns (uint256) {
        return assets.mulDiv(totalSupply() + VIRTUAL_SHARES, totalAssets() + VIRTUAL_ASSETS, Math.Rounding.Floor);
    }

    /// @notice Convert shares to assets (for withdrawal) — uses virtual offset
    function convertToAssets(uint256 shares) public view returns (uint256) {
        return shares.mulDiv(totalAssets() + VIRTUAL_ASSETS, totalSupply() + VIRTUAL_SHARES, Math.Rounding.Floor);
    }

    /// @notice Preview how many shares a deposit would yield
    function previewDeposit(uint256 assets) external view returns (uint256) {
        return convertToShares(assets);
    }

    /// @notice Preview how many assets a withdrawal would yield
    function previewWithdraw(uint256 shares) external view returns (uint256) {
        return convertToAssets(shares);
    }

    /// @notice Get user's underlying RED value
    function underlyingBalance(address user) external view returns (uint256) {
        return convertToAssets(userDeposits[user].shares);
    }

    /// @notice Number of active strategies
    function strategyCount() external view returns (uint256) {
        return strategies.length;
    }

    // ─── Core functions ─────────────────────────────────────────────

    /// @notice Deposit RED and receive stRED shares
    /// @param assets Amount of RED to deposit
    /// @param tier Lock tier to use
    function deposit(uint256 assets, LockTier tier) external nonReentrant {
        if (assets == 0) revert ZeroAmount();

        uint256 shares = convertToShares(assets);
        if (shares == 0) revert ZeroAmount();

        // Transfer RED from user
        red.safeTransferFrom(msg.sender, address(this), assets);

        // Update user deposit
        UserDeposit storage ud = userDeposits[msg.sender];

        // If user already has a deposit, they keep the longer lock
        uint256 newExpiry = block.timestamp + lockTierConfigs[tier].duration;
        if (newExpiry > ud.lockExpiry) {
            ud.lockExpiry = newExpiry;
            ud.tier = tier;
        }
        ud.shares += shares;

        // Mint stRED
        _mint(msg.sender, shares);

        emit Deposited(msg.sender, assets, shares, tier);
    }

    /// @notice Withdraw RED by burning stRED shares
    /// @param shares Amount of stRED shares to burn
    function withdraw(uint256 shares) external nonReentrant {
        if (shares == 0) revert ZeroAmount();

        UserDeposit storage ud = userDeposits[msg.sender];
        if (block.timestamp < ud.lockExpiry) revert LockNotExpired(ud.lockExpiry);
        if (shares > ud.shares) revert InsufficientShares(shares, ud.shares);

        uint256 assets = convertToAssets(shares);
        if (assets == 0) revert ZeroAmount();

        // Update user state
        ud.shares -= shares;

        // Burn stRED
        _burn(msg.sender, shares);

        // Ensure enough idle RED
        uint256 idle = red.balanceOf(address(this));
        if (idle < assets) {
            _withdrawFromStrategies(assets - idle);
        }

        // Transfer RED to user
        red.safeTransfer(msg.sender, assets);

        emit Withdrawn(msg.sender, assets, shares);
    }

    /// @notice Compound: harvest all strategies, take fee, reinvest
    /// @dev Permissionless — anyone can call this
    function compound() external nonReentrant {
        uint256 totalHarvested = 0;

        for (uint256 i = 0; i < strategies.length; i++) {
            totalHarvested += strategies[i].harvest();
        }

        if (totalHarvested == 0) return;

        // Calculate fee
        uint256 fee = (totalHarvested * FEE_BPS) / BPS;
        uint256 feeBurn = (fee * FEE_BURN_SHARE) / BPS;
        uint256 feeTreasury = (fee * FEE_TREASURY_SHARE) / BPS;
        uint256 feeStakers = fee - feeBurn - feeTreasury;

        // Execute fee distribution
        if (feeBurn > 0) {
            red.safeTransfer(BURN_ADDRESS, feeBurn);
        }
        if (feeTreasury > 0) {
            red.safeTransfer(treasury, feeTreasury);
        }
        // feeStakers stays in the vault → increases share value for all holders

        emit Compounded(msg.sender, totalHarvested, feeBurn, feeTreasury, feeStakers);
    }

    // ─── Strategy management (owner only) ───────────────────────────

    error TooManyStrategies();

    /// @notice Add a new yield strategy
    function addStrategy(address _strategy) external onlyOwner {
        if (_strategy == address(0)) revert ZeroAddress();
        if (strategies.length >= MAX_STRATEGIES) revert TooManyStrategies();
        if (isStrategy[_strategy]) revert StrategyAlreadyAdded();
        if (IStrategy(_strategy).want() != address(red)) revert InvalidStrategy();

        strategies.push(IStrategy(_strategy));
        isStrategy[_strategy] = true;

        // Approve strategy to pull RED
        red.approve(_strategy, type(uint256).max);

        emit StrategyAdded(_strategy);
    }

    /// @notice Remove a strategy and withdraw all funds
    function removeStrategy(address _strategy) external onlyOwner {
        if (!isStrategy[_strategy]) revert StrategyNotFound();

        // Withdraw all from strategy
        IStrategy(_strategy).withdraw(IStrategy(_strategy).totalAssets());

        // Remove from array
        for (uint256 i = 0; i < strategies.length; i++) {
            if (address(strategies[i]) == _strategy) {
                strategies[i] = strategies[strategies.length - 1];
                strategies.pop();
                break;
            }
        }

        isStrategy[_strategy] = false;
        red.approve(_strategy, 0);

        emit StrategyRemoved(_strategy);
    }

    /// @notice Deploy idle RED to a strategy
    function deployToStrategy(uint256 strategyIndex, uint256 amount) external onlyOwner {
        if (strategyIndex >= strategies.length) revert InvalidStrategy();
        if (amount == 0) revert ZeroAmount();

        strategies[strategyIndex].deposit(amount);
    }

    // ─── Admin ──────────────────────────────────────────────────────

    /// @notice Update treasury address
    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    // ─── Internal ───────────────────────────────────────────────────

    /// @dev Withdraw from strategies to cover a withdrawal
    function _withdrawFromStrategies(uint256 needed) internal {
        for (uint256 i = 0; i < strategies.length && needed > 0; i++) {
            uint256 available = strategies[i].totalAssets();
            uint256 toWithdraw = available < needed ? available : needed;
            if (toWithdraw > 0) {
                uint256 withdrawn = strategies[i].withdraw(toWithdraw);
                needed -= withdrawn;
            }
        }
    }

    // ─── Transfer restrictions ──────────────────────────────────────
    // stRED is transferable, but the lock applies to the original depositor's withdrawal
    // Transfers of stRED do NOT transfer the lock — recipients can withdraw immediately
    // (their userDeposits entry will have lockExpiry = 0 if they didn't deposit themselves)

    /// @dev Override transfer to track shares
    function _update(address from, address to, uint256 amount) internal override {
        super._update(from, to, amount);

        // Track shares for non-mint/burn transfers
        if (from != address(0) && to != address(0)) {
            UserDeposit storage fromDeposit = userDeposits[from];
            if (amount <= fromDeposit.shares) {
                fromDeposit.shares -= amount;
            } else {
                fromDeposit.shares = 0;
            }

            UserDeposit storage toDeposit = userDeposits[to];
            toDeposit.shares += amount;
        }
    }
}
