// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/CLAWDVault.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Mock CLAWD token
contract MockCLAWD is ERC20 {
    constructor() ERC20("CLAWD", "CLAWD") {
        _mint(msg.sender, 1_000_000 ether);
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// Mock Strategy
contract MockStrategy is IStrategy {
    IERC20 public token;
    uint256 public _totalAssets;
    uint256 public pendingRewards;
    address public vault;

    constructor(address _token, address _vault) {
        token = IERC20(_token);
        vault = _vault;
    }

    function want() external view returns (address) { return address(token); }
    function totalAssets() external view returns (uint256) { return _totalAssets; }

    function deposit(uint256 amount) external {
        token.transferFrom(msg.sender, address(this), amount);
        _totalAssets += amount;
    }

    function withdraw(uint256 amount) external returns (uint256) {
        uint256 toWithdraw = amount > _totalAssets ? _totalAssets : amount;
        _totalAssets -= toWithdraw;
        token.transfer(msg.sender, toWithdraw);
        return toWithdraw;
    }

    function harvest() external returns (uint256) {
        uint256 rewards = pendingRewards;
        pendingRewards = 0;
        if (rewards > 0) {
            token.transfer(vault, rewards);
        }
        return rewards;
    }

    function setPendingRewards(uint256 amount) external {
        pendingRewards = amount;
    }
}

contract CLAWDVaultTest is Test {
    CLAWDVault public vault;
    MockCLAWD public clawd;
    MockStrategy public strategy;

    address owner = address(0xBEEF);
    address treasury = address(0xCAFE);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        clawd = new MockCLAWD();
        vault = new CLAWDVault(address(clawd), treasury, owner);

        // Fund users
        clawd.mint(alice, 100_000 ether);
        clawd.mint(bob, 100_000 ether);

        // Setup strategy
        strategy = new MockStrategy(address(clawd), address(vault));

        vm.prank(owner);
        vault.addStrategy(address(strategy));

        // Approve vault
        vm.prank(alice);
        clawd.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        clawd.approve(address(vault), type(uint256).max);
    }

    function test_deposit() public {
        vm.prank(alice);
        vault.deposit(1000 ether, CLAWDVault.LockTier.NONE);

        assertEq(vault.balanceOf(alice), 1000 ether);
        assertEq(vault.totalAssets(), 1000 ether);
    }

    function test_deposit_with_lock() public {
        vm.prank(alice);
        vault.deposit(1000 ether, CLAWDVault.LockTier.SIX_MONTH);

        (uint256 shares, uint256 lockExpiry, CLAWDVault.LockTier tier) = vault.userDeposits(alice);
        assertEq(shares, 1000 ether);
        assertEq(lockExpiry, block.timestamp + 180 days);
        assertEq(uint(tier), uint(CLAWDVault.LockTier.SIX_MONTH));
    }

    function test_withdraw() public {
        vm.prank(alice);
        vault.deposit(1000 ether, CLAWDVault.LockTier.NONE);

        vm.prank(alice);
        vault.withdraw(1000 ether);

        assertEq(vault.balanceOf(alice), 0);
        assertEq(clawd.balanceOf(alice), 100_000 ether);
    }

    function test_withdraw_locked_reverts() public {
        vm.prank(alice);
        vault.deposit(1000 ether, CLAWDVault.LockTier.THREE_MONTH);

        vm.prank(alice);
        vm.expectRevert();
        vault.withdraw(1000 ether);
    }

    function test_withdraw_after_lock() public {
        vm.prank(alice);
        vault.deposit(1000 ether, CLAWDVault.LockTier.THREE_MONTH);

        vm.warp(block.timestamp + 91 days);

        vm.prank(alice);
        vault.withdraw(1000 ether);
        assertEq(vault.balanceOf(alice), 0);
    }

    function test_compound() public {
        vm.prank(alice);
        vault.deposit(1000 ether, CLAWDVault.LockTier.NONE);

        // Deploy to strategy
        vm.prank(owner);
        vault.deployToStrategy(0, 500 ether);

        // Simulate rewards
        clawd.mint(address(strategy), 100 ether);
        strategy.setPendingRewards(100 ether);

        uint256 treasuryBefore = clawd.balanceOf(treasury);
        uint256 burnBefore = clawd.balanceOf(vault.BURN_ADDRESS());

        vault.compound();

        // 100 * 0.5% = 0.5 fee
        // 0.5 * 50% = 0.25 burn
        // 0.5 * 25% = 0.125 treasury
        // 0.5 * 25% = 0.125 stakers (stays in vault)
        uint256 fee = (100 ether * 50) / 10000; // 0.5 ether
        uint256 feeBurn = (fee * 5000) / 10000;
        uint256 feeTreasury = (fee * 2500) / 10000;

        assertEq(clawd.balanceOf(vault.BURN_ADDRESS()) - burnBefore, feeBurn);
        assertEq(clawd.balanceOf(treasury) - treasuryBefore, feeTreasury);

        // Vault total should be 1000 + 100 - feeBurn - feeTreasury
        assertEq(vault.totalAssets(), 1000 ether + 100 ether - feeBurn - feeTreasury);
    }

    function test_share_value_increases_after_compound() public {
        vm.prank(alice);
        vault.deposit(1000 ether, CLAWDVault.LockTier.NONE);

        vm.prank(owner);
        vault.deployToStrategy(0, 500 ether);

        clawd.mint(address(strategy), 100 ether);
        strategy.setPendingRewards(100 ether);

        vault.compound();

        // Alice's shares should now be worth more than 1000
        uint256 aliceValue = vault.convertToAssets(vault.balanceOf(alice));
        assertGt(aliceValue, 1000 ether);
    }

    function test_zero_deposit_reverts() public {
        vm.prank(alice);
        vm.expectRevert(CLAWDVault.ZeroAmount.selector);
        vault.deposit(0, CLAWDVault.LockTier.NONE);
    }

    function test_zero_withdraw_reverts() public {
        vm.prank(alice);
        vm.expectRevert(CLAWDVault.ZeroAmount.selector);
        vault.withdraw(0);
    }

    function test_add_strategy_not_owner_reverts() public {
        MockStrategy s2 = new MockStrategy(address(clawd), address(vault));
        vm.prank(alice);
        vm.expectRevert();
        vault.addStrategy(address(s2));
    }

    function test_remove_strategy() public {
        vm.prank(alice);
        vault.deposit(1000 ether, CLAWDVault.LockTier.NONE);
        vm.prank(owner);
        vault.deployToStrategy(0, 500 ether);

        vm.prank(owner);
        vault.removeStrategy(address(strategy));

        assertEq(vault.strategyCount(), 0);
        // Funds should be back in vault
        assertEq(clawd.balanceOf(address(vault)), 1000 ether);
    }

    function test_set_treasury() public {
        address newTreasury = address(0xDEAD);
        vm.prank(owner);
        vault.setTreasury(newTreasury);
        assertEq(vault.treasury(), newTreasury);
    }

    function test_transfer_shares() public {
        vm.prank(alice);
        vault.deposit(1000 ether, CLAWDVault.LockTier.NONE);

        vm.prank(alice);
        vault.transfer(bob, 500 ether);

        assertEq(vault.balanceOf(bob), 500 ether);

        // Bob can withdraw immediately (no lock)
        vm.prank(bob);
        vault.withdraw(500 ether);
    }

    function test_multiple_deposits() public {
        vm.prank(alice);
        vault.deposit(1000 ether, CLAWDVault.LockTier.NONE);

        vm.prank(bob);
        vault.deposit(2000 ether, CLAWDVault.LockTier.NONE);

        assertEq(vault.totalAssets(), 3000 ether);
        assertEq(vault.balanceOf(alice), 1000 ether);
        assertEq(vault.balanceOf(bob), 2000 ether);
    }

    function test_withdraw_from_strategy_on_large_withdrawal() public {
        vm.prank(alice);
        vault.deposit(1000 ether, CLAWDVault.LockTier.NONE);

        vm.prank(owner);
        vault.deployToStrategy(0, 900 ether);

        // Only 100 idle in vault, alice wants all 1000
        vm.prank(alice);
        vault.withdraw(1000 ether);

        assertEq(clawd.balanceOf(alice), 100_000 ether);
    }
}
