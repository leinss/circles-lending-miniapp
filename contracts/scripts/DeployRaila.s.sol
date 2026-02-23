// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Script.sol";
import "../src/RailaModule.sol";

contract DeployRaila is Script {
    function run() external {
        vm.startBroadcast();

        new RailaModule(
            // USDC.e
            IERC20(0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0),
            ICirclesHub(0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8)
        );

        vm.stopBroadcast();
    }
}
