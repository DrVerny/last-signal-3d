// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint8, externalEuint8} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title Last Signal - Sealed Choices
/// @author Moshood Sodiq Olasunkanmi (@verrnny / DrVerny)
/// @notice Zama Developer Program Season 5 - Confidential Gaming.
///         THE LAST SIGNAL's two sealed choices, encrypted with FHEVM.
///
/// WHAT STAYS ENCRYPTED, AND WHEN IT IS REVEALED
/// ----------------------------------------------
/// 1. Act I - Priority power (0 = Hospital, 1 = Residential,
///    2 = Industrial). Sealed in the browser with the Relayer SDK
///    and stored as an `euint8`. Nobody can see it while sealed.
/// 2. Act III - The final fix (0 = Quick Fix, 1 = Rebuild,
///    2 = Third Way). Sealed the same way, stored as an `euint8`.
/// 3. ONLY after the game ends - both choices sealed - anyone may
///    call revealChoices(player). That calls
///    FHE.makePubliclyDecryptable() on both choices. After that,
///    and only after that, anyone can decrypt them through the
///    Zama Relayer. Before reveal, public decryption is impossible.
/// 4. The frontend shows the decrypted choices on the Act III end
///    card, next to the ending they produced. The contract never
///    branches on a plaintext choice, so no information leaks
///    through gas, events, or return values.
///
/// WHY THIS ONLY WORKS WITH FHE
/// -----------------------------
/// On a fully transparent chain, a "sealed choice" is impossible:
/// every choice would be visible in the mempool / storage, so other
/// players (and the host) could see it before the reveal. Here the
/// choices stay encrypted until the game ends, exactly as the story
/// demands: "nobody, not even the other players, can see it until
/// the reveal."
///
/// HOW A GAME PLAYS
/// -----------------
/// 1. The player plays Act I and picks a priority-power line.
///    The frontend encrypts the pick (0, 1 or 2) in the browser
///    and calls sealPriorityPower(). One seal per player.
/// 2. The player plays Acts II and III. In Act III, Chapter 1,
///    the player picks the final fix. The frontend encrypts it
///    and calls sealFinalChoice(). One seal per player.
/// 3. After the Act III end card, anyone calls
///    revealChoices(player). Both choices become publicly
///    decryptable, and the frontend decrypts them with the
///    Relayer SDK and shows them on the end card.
///
/// NOTES / HONEST LIMITS
/// ---------------------
/// - The contract cannot range-check an encrypted choice without
///   leaking it. The frontend enforces 0, 1 or 2 before
///   encrypting; an out-of-range value simply decrypts to a
///   number the frontend treats as invalid (it cannot match any
///   ending). This is the same limit as Sealed Fortune's 1-100.
/// - Reveal is per player, not per game: each player's two
///   choices are revealed together once that player has sealed
///   both. There is no global deadline; the game ends when the
///   player seals the final choice and reaches the end card.
/// - This is a testnet game for the Zama Developer Program, not
///   real money. No ETH or prizes are escrowed in this contract.
/// - Demo mode (no wallet) plays the whole game with the choices
///   simulated locally, exactly as before. Only a connected
///   wallet on Sepolia writes to this contract.
contract LastSignalSealedChoice is ZamaEthereumConfig {
    /// @dev player => their encrypted Act I choice (euint8 handle).
    mapping(address => euint8) private _priorityPower;
    /// @dev player => their encrypted Act III choice (euint8 handle).
    mapping(address => euint8) private _finalChoice;
    /// @dev player => has this player sealed their Act I choice?
    mapping(address => bool) public hasSealedPriorityPower;
    /// @dev player => has this player sealed their Act III choice?
    mapping(address => bool) public hasSealedFinalChoice;
    /// @dev player => have this player's choices been revealed?
    mapping(address => bool) public isRevealed;
    /// @dev all players who sealed at least one choice, so the
    ///      frontend can enumerate them.
    address[] public players;
    /// @dev player => is this address already in `players`?
    mapping(address => bool) private _isPlayer;

    event PriorityPowerSealed(address indexed player);
    event FinalChoiceSealed(address indexed player);
    event ChoicesRevealed(address indexed player);

    /// @notice Seal the Act I priority-power choice. One seal per player.
    /// @param encryptedChoice The pick (0, 1 or 2), encrypted in the
    ///        browser with the Relayer SDK (externalEuint8).
    /// @param inputProof The Relayer SDK input proof for the choice.
    function sealPriorityPower(
        externalEuint8 encryptedChoice,
        bytes calldata inputProof
    ) external {
        require(!hasSealedPriorityPower[msg.sender], "Priority power already sealed");

        euint8 choice = FHE.fromExternal(encryptedChoice, inputProof);
        _priorityPower[msg.sender] = choice;
        FHE.allowThis(choice);
        // Only the player may user-decrypt their own choice.
        FHE.allow(choice, msg.sender);

        hasSealedPriorityPower[msg.sender] = true;
        _addPlayer(msg.sender);

        emit PriorityPowerSealed(msg.sender);
    }

    /// @notice Seal the Act III final choice. One seal per player.
    /// @param encryptedChoice The pick (0, 1 or 2), encrypted in the
    ///        browser with the Relayer SDK (externalEuint8).
    /// @param inputProof The Relayer SDK input proof for the choice.
    function sealFinalChoice(
        externalEuint8 encryptedChoice,
        bytes calldata inputProof
    ) external {
        require(!hasSealedFinalChoice[msg.sender], "Final choice already sealed");

        euint8 choice = FHE.fromExternal(encryptedChoice, inputProof);
        _finalChoice[msg.sender] = choice;
        FHE.allowThis(choice);
        // Only the player may user-decrypt their own choice.
        FHE.allow(choice, msg.sender);

        hasSealedFinalChoice[msg.sender] = true;
        _addPlayer(msg.sender);

        emit FinalChoiceSealed(msg.sender);
    }

    /// @notice Reveal a player's choices after the game ends. This is
    ///         the ONLY moment anything becomes decryptable. Both
    ///         choices must be sealed first; after this call they can
    ///         be publicly decrypted through the Zama Relayer.
    /// @param player The player whose choices are revealed.
    function revealChoices(address player) external {
        require(
            hasSealedPriorityPower[player] && hasSealedFinalChoice[player],
            "Both choices must be sealed first"
        );
        require(!isRevealed[player], "Choices already revealed");

        isRevealed[player] = true;

        FHE.makePubliclyDecryptable(_priorityPower[player]);
        FHE.makePubliclyDecryptable(_finalChoice[player]);

        emit ChoicesRevealed(player);
    }

    /// @notice A player's encrypted Act I choice (a handle, not a
    ///         plaintext number). Only decryptable after reveal.
    function getPriorityPower(address player) external view returns (euint8) {
        return _priorityPower[player];
    }

    /// @notice A player's encrypted Act III choice (a handle, not a
    ///         plaintext number). Only decryptable after reveal.
    function getFinalChoice(address player) external view returns (euint8) {
        return _finalChoice[player];
    }

    /// @notice All players who sealed at least one choice, for
    ///         reveal-time enumeration.
    function getPlayers() external view returns (address[] memory) {
        return players;
    }

    function _addPlayer(address player) internal {
        if (!_isPlayer[player]) {
            _isPlayer[player] = true;
            players.push(player);
        }
    }
}
