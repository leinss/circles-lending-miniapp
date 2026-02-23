// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Enum} from "safe-contracts/contracts/libraries/Enum.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

interface ISafe {
    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation
    ) external returns (bool success);
}

interface ICirclesHub {
    function isTrusted(
        address _truster, address _trusted
    ) external view returns (bool);
}

contract RailaModule {

    // Interest rates use Basis Points, and denominator is 1e18
    struct UserLimits {
        uint256 lendingCap;
        uint256 minLendIR;
        // Borrowing settings only make sense for autoborrow (right?)
        uint256 borrowCap;
        uint256 maxBorrowIR; // 0 for "not a relayer"
        uint256 minIRMargin;
    }

    struct UserBalance {
        uint256 lent;
        uint256 owedPerSecond;
        uint256 borrowed;
        uint256 owesPerSecond;
        uint256 timestamp;
    }

    struct Loan {
        uint256 amount;
        // borrowing on an already existing loan will
        // mutate the borrow to the weighted average
        // of the existing amount, and the borrowed amount
        uint256 interestRatePerSecond;
        uint256 timestamp;
    }

    IERC20 immutable TOKEN;
    ICirclesHub immutable CIRCLES_HUB;

    uint256 constant DENOMINATOR = 1e18;

    mapping(address => UserLimits) public limits;
    mapping(address => UserBalance) public balances;
    // loans[lender][borrower]
    mapping(address => mapping(address => Loan)) public loans;

    constructor(IERC20 _token, ICirclesHub _circlesHub) {
        TOKEN = _token;
        CIRCLES_HUB = _circlesHub;
    }

    function setSettings(UserLimits memory _limits) external {
        limits[msg.sender] = _limits;
    }

    function borrow(
        uint256 amount,
        address[] calldata path,
        uint256[] calldata irs
    ) external {
        if (path.length == 0) revert EmptyPath();
        if (path.length != irs.length) {
            revert DifferentLengthsPathIRs(path.length, irs.length);
        }

        for (uint256 i = 0; i < path.length; i++) {
            // original lender is first address in the path.
            // caller (the safe) is the not included last element.
            address sender = path[i];
            address receiver = i < path.length - 1 ? path[i+1] : msg.sender;

            updateLoan(sender, receiver);
            _borrow(sender, receiver, amount, irs[i]);

            if (balances[sender].lent > limits[sender].lendingCap) {
                revert OverLendingCap(sender, balances[sender].lent);
            }
            if (irs[i] < limits[sender].minLendIR) {
                revert UnderLenderMinIR(sender, irs[i]);
            }

            if (i < path.length - 1) {
                // As original borrower, you can exceed your safety limits
                // since you're purposely calling this.
                // Borrowing limits only apply while relaying the loan.
                if (balances[receiver].borrowed > limits[receiver].borrowCap) {
                    revert OverBorrowingCap(receiver, balances[receiver].borrowed);
                }
                if (irs[i] > limits[receiver].maxBorrowIR) {
                    revert OverBorrowerMaxIR(receiver, irs[i]);
                }

                if (irs[i + 1] < irs[i]) {
                    revert UnderRelayerMargin(receiver, 0);
                }
                uint256 margin = irs[i + 1] - irs[i];
                if (margin < limits[receiver].minIRMargin) {
                    revert UnderRelayerMargin(receiver, margin);
                }
            }

            if (!CIRCLES_HUB.isTrusted(sender, receiver)) {
                revert LenderDoesNotTrustBorrower(sender, receiver);
            }
        }

        bytes memory data = abi.encodeWithSelector(
            IERC20.transfer.selector,
            msg.sender,
            amount
        );
        if (!ISafe(path[0]).execTransactionFromModule(
            address(TOKEN),
            0,
            data,
            Enum.Operation.Call
        )) revert TransferFailed();
    }

    function repay(
        uint256 amount,
        address[] calldata path
    ) external {
        if (path.length == 0) revert EmptyPath();
        for (uint256 i = 0; i < path.length - 1; i++) {
            address borrower = path[i];
            address lender = path[i + 1];

            updateLoan(lender, borrower);

            uint256 repaid = _repay(lender, borrower, amount);

            if (amount - repaid > 0 && i > 0) {
                TOKEN.transferFrom(msg.sender, borrower, amount - repaid);
            }
            amount = repaid;
        }

        if (amount > 0) {
            TOKEN.transferFrom(msg.sender, path[path.length - 1], amount);
        }
    }

    function updateLoan(
        address lender,
        address borrower
    ) public {
        Loan storage loan = loans[lender][borrower];

        if (loan.amount > 0) {
            uint256 elapsed = block.timestamp - loan.timestamp;
            uint256 interest = loan.amount * loan.interestRatePerSecond * elapsed / DENOMINATOR;
            loan.amount += interest;

            uint256 d = interest * loan.interestRatePerSecond / DENOMINATOR;
            balances[lender].owedPerSecond += d;
            balances[borrower].owesPerSecond += d;

            balances[lender].lent += interest;
            balances[borrower].borrowed += interest;
        }

        loan.timestamp = block.timestamp;
        balances[lender].timestamp = block.timestamp;
        balances[borrower].timestamp = block.timestamp;
    }

    // assume the loan is updated before calling this!
    function _borrow(
        address lender,
        address borrower,
        uint256 amount,
        uint256 ir
    ) internal {
        Loan storage loan = loans[lender][borrower];

        uint256 d = amount * ir / DENOMINATOR;
        balances[lender].owedPerSecond += d;
        balances[borrower].owesPerSecond += d;

        uint256 newAmount = loan.amount + amount;
        uint256 newIr = loan.amount == 0
            ? ir
            : (loan.amount * loan.interestRatePerSecond + amount * ir) / newAmount;

        loan.amount = newAmount;
        loan.interestRatePerSecond = newIr;

        balances[lender].lent += amount;
        balances[borrower].borrowed += amount;
    }

    // assume the loan is updated before calling this!
    function _repay(
        address lender,
        address borrower,
        uint256 offered
    ) internal returns (uint256 repaid) {
        Loan storage loan = loans[lender][borrower];
        repaid = offered < loan.amount ? offered : loan.amount;

        uint256 d = repaid * loan.interestRatePerSecond / DENOMINATOR;
        balances[lender].owedPerSecond -= d;
        balances[borrower].owesPerSecond -= d;

        loan.amount -= repaid;
        balances[lender].lent -= repaid;
        balances[borrower].borrowed -= repaid;
    }

    error EmptyPath();
    error DifferentLengthsPathIRs(uint256 pathLength, uint256 irsLength);
    error OverLendingCap(address lender, uint256 amount);
    error OverBorrowingCap(address borrower, uint256 amount);
    error UnderLenderMinIR(address lender, uint256 ir);
    error OverBorrowerMaxIR(address borrower, uint256 ir);
    error UnderRelayerMargin(address borrower, uint256 margin);
    error LenderDoesNotTrustBorrower(address lender, address borrower);
    error TransferFailed();
}
