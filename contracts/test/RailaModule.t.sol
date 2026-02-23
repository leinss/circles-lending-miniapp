// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {RailaModule} from "../src/RailaModule.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {ICirclesHub} from "../src/RailaModule.sol";

contract MockToken is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    function name() external pure returns (string memory) { return "Mock"; }
    function symbol() external pure returns (string memory) { return "MOCK"; }
    function decimals() external pure returns (uint8) { return 18; }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function drain(address from) external {
        balanceOf[from] = 0;
    }
}

contract MockCirclesHub {
    mapping(address => mapping(address => bool)) public trust;

    function setTrust(address truster, address trusted, bool _trust) external {
        trust[truster][trusted] = _trust;
    }

    function isTrusted(address truster, address trusted) external view returns (bool) {
        return trust[truster][trusted];
    }
}

contract MockSafe {
    IERC20 token;

    constructor(IERC20 _token) {
        token = _token;
    }

    function execTransactionFromModule(
        address to,
        uint256,
        bytes memory data,
        uint8
    ) external returns (bool) {
        (bool success,) = to.call(data);
        return success;
    }
}

contract RailaModuleTest is Test {
    RailaModule module;
    MockToken token;
    MockCirclesHub hub;
    MockSafe safe1;
    MockSafe safe2;

    address alice;
    address bob;

    function setUp() public {
        token = new MockToken();
        hub = new MockCirclesHub();
        module = new RailaModule(IERC20(address(token)), ICirclesHub(address(hub)));

        alice = address(new MockSafe(token));
        bob = address(new MockSafe(token));

        safe1 = MockSafe(alice);
        safe2 = MockSafe(bob);

        token.mint(alice, 1000e18);
        token.approve(address(module), type(uint256).max);
        vm.prank(alice);
        token.approve(address(module), type(uint256).max);
    }

    function testSetSettings() public {
        vm.prank(alice);
        module.setSettings(RailaModule.UserLimits({
            lendingCap: 100e18,
            minLendIR: 1e18,
            borrowCap: 50e18,
            maxBorrowIR: 5e18,
            minIRMargin: 1e18
        }));

        (uint256 lendingCap,,,,) = module.limits(alice);
        assertEq(lendingCap, 100e18);
    }

    function testBorrowBasic() public {
        hub.setTrust(alice, bob, true);

        vm.prank(alice);
        module.setSettings(RailaModule.UserLimits({
            lendingCap: 100e18,
            minLendIR: 1e18,
            borrowCap: 0,
            maxBorrowIR: 0,
            minIRMargin: 0
        }));

        address[] memory path = new address[](1);
        path[0] = alice;
        uint256[] memory irs = new uint256[](1);
        irs[0] = 2e18;

        vm.prank(bob);
        module.borrow(10e18, path, irs);

        (uint256 amount,,) = module.loans(alice, bob);
        assertEq(amount, 10e18);
    }

    function testRepayBasic() public {
        hub.setTrust(alice, bob, true);

        vm.prank(alice);
        module.setSettings(RailaModule.UserLimits({
            lendingCap: 100e18,
            minLendIR: 1e18,
            borrowCap: 0,
            maxBorrowIR: 0,
            minIRMargin: 0
        }));

        address[] memory path = new address[](1);
        path[0] = alice;
        uint256[] memory irs = new uint256[](1);
        irs[0] = 2e18;

        vm.prank(bob);
        module.borrow(10e18, path, irs);

        token.mint(bob, 10e18);
        vm.prank(bob);
        token.approve(address(module), 10e18);

        address[] memory repayPath = new address[](2);
        repayPath[0] = bob;
        repayPath[1] = alice;

        vm.prank(bob);
        module.repay(5e18, repayPath);

        (uint256 amount,,) = module.loans(alice, bob);
        assertEq(amount, 5e18);
    }

    function testInterestAccrual() public {
        hub.setTrust(alice, bob, true);

        vm.prank(alice);
        module.setSettings(RailaModule.UserLimits({
            lendingCap: 200e18,
            minLendIR: 0.01e18,
            borrowCap: 0,
            maxBorrowIR: 0,
            minIRMargin: 0
        }));

        address[] memory path = new address[](1);
        path[0] = alice;
        uint256[] memory irs = new uint256[](1);
        irs[0] = 0.1e18; // 10% per second

        vm.prank(bob);
        module.borrow(100e18, path, irs);

        // Fast forward 10 seconds
        vm.warp(block.timestamp + 10);

        // Update the loan to accrue interest
        module.updateLoan(alice, bob);

        (uint256 amount,,) = module.loans(alice, bob);
        // interest = 100 * 0.1 * 10 / 1e18 = 100
        assertEq(amount, 200e18);
    }

    function testRevertUnderLenderMinIR() public {
        hub.setTrust(alice, bob, true);

        vm.prank(alice);
        module.setSettings(RailaModule.UserLimits({
            lendingCap: 100e18,
            minLendIR: 5e18,
            borrowCap: 0,
            maxBorrowIR: 0,
            minIRMargin: 0
        }));

        address[] memory path = new address[](1);
        path[0] = alice;
        uint256[] memory irs = new uint256[](1);
        irs[0] = 2e18; // below minLendIR

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(RailaModule.UnderLenderMinIR.selector, alice, 2e18));
        module.borrow(10e18, path, irs);
    }

    function testRevertOverLendingCap() public {
        hub.setTrust(alice, bob, true);

        vm.prank(alice);
        module.setSettings(RailaModule.UserLimits({
            lendingCap: 50e18,
            minLendIR: 1e18,
            borrowCap: 0,
            maxBorrowIR: 0,
            minIRMargin: 0
        }));

        address[] memory path = new address[](1);
        path[0] = alice;
        uint256[] memory irs = new uint256[](1);
        irs[0] = 2e18;

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(RailaModule.OverLendingCap.selector, alice, 100e18));
        module.borrow(100e18, path, irs);
    }

    function testRevertOverBorrowerMaxIR() public {
        hub.setTrust(alice, bob, true);
        hub.setTrust(bob, address(0xC0FFEE), true);

        vm.prank(alice);
        module.setSettings(RailaModule.UserLimits({
            lendingCap: 100e18,
            minLendIR: 1e18,
            borrowCap: 0,
            maxBorrowIR: 0,
            minIRMargin: 0
        }));

        vm.prank(bob);
        module.setSettings(RailaModule.UserLimits({
            lendingCap: 100e18,
            minLendIR: 1e18,
            borrowCap: 100e18,
            maxBorrowIR: 3e18,
            minIRMargin: 0.5e18
        }));

        address[] memory path = new address[](2);
        path[0] = alice;
        path[1] = bob;
        uint256[] memory irs = new uint256[](2);
        irs[0] = 5e18; // over bob's maxBorrowIR
        irs[1] = 6e18;

        vm.prank(address(0xC0FFEE));
        vm.expectRevert(abi.encodeWithSelector(RailaModule.OverBorrowerMaxIR.selector, bob, 5e18));
        module.borrow(10e18, path, irs);
    }

    function testRevertOverBorrowingCap() public {
        hub.setTrust(alice, bob, true);
        hub.setTrust(bob, address(0xC0FFEE), true);

        vm.prank(alice);
        module.setSettings(RailaModule.UserLimits({
            lendingCap: 100e18,
            minLendIR: 1e18,
            borrowCap: 0,
            maxBorrowIR: 0,
            minIRMargin: 0
        }));

        vm.prank(bob);
        module.setSettings(RailaModule.UserLimits({
            lendingCap: 100e18,
            minLendIR: 1e18,
            borrowCap: 20e18,
            maxBorrowIR: 5e18,
            minIRMargin: 0.5e18
        }));

        address[] memory path = new address[](2);
        path[0] = alice;
        path[1] = bob;
        uint256[] memory irs = new uint256[](2);
        irs[0] = 2e18;
        irs[1] = 3e18;

        vm.prank(address(0xC0FFEE));
        vm.expectRevert(abi.encodeWithSelector(RailaModule.OverBorrowingCap.selector, bob, 50e18));
        module.borrow(50e18, path, irs);
    }

    function testRepayMultiHopPath() public {
        MockSafe charlieS = new MockSafe(token);
        MockSafe dickS = new MockSafe(token);
        address charlie = address(charlieS);
        address dick = address(dickS);

        hub.setTrust(bob, alice, true);
        hub.setTrust(charlie, bob, true);
        hub.setTrust(dick, charlie, true);

        {
            vm.prank(alice);
            module.setSettings(RailaModule.UserLimits(1000e18, 0, 0, 0, 0));
            vm.prank(bob);
            module.setSettings(RailaModule.UserLimits(1000e18, 0, 1000e18, 10e18, 0));
            vm.prank(charlie);
            module.setSettings(RailaModule.UserLimits(1000e18, 0, 1000e18, 10e18, 0));
            vm.prank(dick);
            module.setSettings(RailaModule.UserLimits(1000e18, 0, 0, 0, 0));
        }

        {
            address[] memory p = new address[](1);
            uint256[] memory irs = new uint256[](1);
            irs[0] = 1e18;

            token.mint(bob, 100e18);
            p[0] = bob;
            vm.prank(alice);
            module.borrow(20e18, p, irs);

            token.mint(charlie, 100e18);
            p[0] = charlie;
            vm.prank(bob);
            module.borrow(60e18, p, irs);

            token.mint(dick, 100e18);
            p[0] = dick;
            vm.prank(charlie);
            module.borrow(5e18, p, irs);
        }

        {
            (uint256 d,,) = module.loans(bob, alice);
            assertEq(d, 20e18);
            (d,,) = module.loans(charlie, bob);
            assertEq(d, 60e18);
            (d,,) = module.loans(dick, charlie);
            assertEq(d, 5e18);

            token.drain(bob);
            token.drain(charlie);
            token.drain(dick);
        }

        {
            address[] memory p = new address[](4);
            p[0] = alice;
            p[1] = bob;
            p[2] = charlie;
            p[3] = dick;

            token.mint(alice, 30e18);
            vm.prank(alice);
            token.approve(address(module), 30e18);
            vm.prank(alice);
            module.repay(30e18, p);
        }

        assertEq(token.balanceOf(charlie), 15e18);
        assertEq(token.balanceOf(dick), 5e18);

        {
            (uint256 d,,) = module.loans(bob, alice);
            assertEq(d, 0);
            (d,,) = module.loans(charlie, bob);
            assertEq(d, 40e18);
            (d,,) = module.loans(dick, charlie);
            assertEq(d, 0);
        }
    }

    function testRevertUnderRelayerMargin() public {
        hub.setTrust(alice, bob, true);
        hub.setTrust(bob, address(0xC0FFEE), true);

        vm.prank(alice);
        module.setSettings(RailaModule.UserLimits({
            lendingCap: 100e18,
            minLendIR: 1e18,
            borrowCap: 0,
            maxBorrowIR: 0,
            minIRMargin: 0
        }));

        vm.prank(bob);
        module.setSettings(RailaModule.UserLimits({
            lendingCap: 100e18,
            minLendIR: 1e18,
            borrowCap: 100e18,
            maxBorrowIR: 5e18,
            minIRMargin: 2e18
        }));

        address[] memory path = new address[](2);
        path[0] = alice;
        path[1] = bob;
        uint256[] memory irs = new uint256[](2);
        irs[0] = 2e18;
        irs[1] = 3e18; // margin = 1e18, below minIRMargin of 2e18

        vm.prank(address(0xC0FFEE));
        vm.expectRevert(abi.encodeWithSelector(RailaModule.UnderRelayerMargin.selector, bob, 1e18));
        module.borrow(10e18, path, irs);
    }

    function testRevertLenderDoesNotTrust() public {
        vm.prank(alice);
        module.setSettings(RailaModule.UserLimits({
            lendingCap: 100e18,
            minLendIR: 1e18,
            borrowCap: 0,
            maxBorrowIR: 0,
            minIRMargin: 0
        }));

        address[] memory path = new address[](1);
        path[0] = alice;
        uint256[] memory irs = new uint256[](1);
        irs[0] = 2e18;

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(RailaModule.LenderDoesNotTrustBorrower.selector, alice, bob));
        module.borrow(10e18, path, irs);
    }

    function testRevertEmptyPath() public {
        address[] memory path = new address[](0);
        uint256[] memory irs = new uint256[](0);

        vm.prank(bob);
        vm.expectRevert(RailaModule.EmptyPath.selector);
        module.borrow(10e18, path, irs);
    }

    function testRevertDifferentLengths() public {
        address[] memory path = new address[](2);
        path[0] = alice;
        path[1] = bob;
        uint256[] memory irs = new uint256[](1);
        irs[0] = 2e18;

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(RailaModule.DifferentLengthsPathIRs.selector, 2, 1));
        module.borrow(10e18, path, irs);
    }
}
