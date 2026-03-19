// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/BotsterToken.sol";

contract BotsterTokenTest is Test {
    BotsterToken public token;
    address deployer = address(0xDEAD);

    function setUp() public {
        token = new BotsterToken(deployer);
    }

    function test_name() public view {
        assertEq(token.name(), "Botster");
    }

    function test_symbol() public view {
        assertEq(token.symbol(), "BOTSTER");
    }

    function test_totalSupply() public view {
        assertEq(token.totalSupply(), 10_000_000_000e18);
    }

    function test_allMintedToRecipient() public view {
        assertEq(token.balanceOf(deployer), 10_000_000_000e18);
    }

    function test_transfer() public {
        address alice = address(0xA11CE);
        vm.prank(deployer);
        token.transfer(alice, 1000e18);
        assertEq(token.balanceOf(alice), 1000e18);
        assertEq(token.balanceOf(deployer), 10_000_000_000e18 - 1000e18);
    }

    function test_decimals() public view {
        assertEq(token.decimals(), 18);
    }
}
