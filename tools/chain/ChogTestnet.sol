// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// Chog Genesis, testnet edition, for the Chog World demo.
///
/// Token ids match mainnet Chog Genesis (1..1969), and each one shows the same Chog: the app looks up
/// the traits by id. Anyone can claim up to three, so judges and testers can bring a Chog to life and
/// then sell or send it to see it go grey. Testnet only; nothing here has value.
contract ChogTestnet is ERC721 {
    using Strings for uint256;

    uint256 public constant MAX_SUPPLY = 1969;
    uint256 public constant MAX_PER_WALLET = 3;

    address public immutable owner;
    string private base;
    uint256 public claimed;
    mapping(address => uint256) public claims;

    error SoldOut();
    error ClaimLimit();
    error Taken();
    error BadId();
    error NotOwner();

    constructor(string memory baseURI_) ERC721("Chog Genesis (Testnet)", "tCHOG") {
        owner = msg.sender;
        base = baseURI_;
    }

    /// Claim a specific Chog by its mainnet id, so a demo can pick a good-looking one.
    function claim(uint256 id) external {
        if (id == 0 || id > MAX_SUPPLY) revert BadId();
        if (_ownerOf(id) != address(0)) revert Taken();
        _take(msg.sender, id);
    }

    /// Claim the next free Chog, pseudo-randomly (testnet, so plain block data is fine).
    function claimRandom() external returns (uint256 id) {
        if (claimed >= MAX_SUPPLY) revert SoldOut();
        id = (uint256(keccak256(abi.encode(block.prevrandao, msg.sender, claimed))) % MAX_SUPPLY) + 1;
        while (_ownerOf(id) != address(0)) id = id % MAX_SUPPLY + 1;
        _take(msg.sender, id);
    }

    function _take(address to, uint256 id) internal {
        if (claims[to] >= MAX_PER_WALLET) revert ClaimLimit();
        claims[to] += 1;
        claimed += 1;
        _mint(to, id);
    }

    /// Every Chog an address holds (for the app's sign-in screen; a free read, no gas).
    function tokensOf(address who) external view returns (uint256[] memory ids) {
        uint256 n = balanceOf(who);
        ids = new uint256[](n);
        uint256 k;
        for (uint256 id = 1; id <= MAX_SUPPLY && k < n; id++) {
            if (_ownerOf(id) == who) ids[k++] = id;
        }
    }

    function setBaseURI(string calldata baseURI_) external {
        if (msg.sender != owner) revert NotOwner();
        base = baseURI_;
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        return string.concat(base, id.toString(), ".json");
    }
}
