// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Bot Reputation Registry
/// @notice Minimal on-chain registry where autonomous trading bots commit their
///         identity, declare their strategy ahead of action, and put stake on
///         the line so fraud can be challenged. Performance computation lives
///         off-chain; only the trust layer is on-chain.
///
///         Source of truth = events. Indexers replay events into Postgres.
///         The contract holds: stake, operator keys, current liveness flag.
contract Registry {
    // ─── Token / config ────────────────────────────────────────────────────
    IERC20  public immutable stakeToken;     // USDC on Base
    uint256 public immutable minStake;       // e.g. 100e6 (100 USDC)
    uint256 public immutable minChallenge;   // e.g. 50e6  (50 USDC)
    address public owner;                     // resolver of challenges; replace with multisig later

    // ─── Bots ──────────────────────────────────────────────────────────────
    struct Bot {
        address operator;
        string  manifestURI;
        bytes32 manifestHash;
        uint256 stake;
        uint64  registeredAt;
        bool    active;
    }

    uint256 public nextBotId = 1;
    mapping(uint256 => Bot)       public bots;
    mapping(uint256 => address[]) internal _wallets;
    mapping(address => uint256)   public walletToBotId;   // 0 = unlinked

    // ─── Challenges ────────────────────────────────────────────────────────
    struct Challenge {
        uint256 botId;
        address challenger;
        uint256 stake;
        string  reason;
        string  evidenceURI;
        bool    resolved;
        bool    upheld;
    }

    uint256 public nextChallengeId = 1;
    mapping(uint256 => Challenge) public challenges;

    // ─── Events ────────────────────────────────────────────────────────────
    event BotRegistered(
        uint256 indexed botId,
        address indexed operator,
        string manifestURI,
        bytes32 manifestHash,
        uint256 stake
    );
    event WalletLinked(uint256 indexed botId, address indexed wallet);
    event WalletUnlinked(uint256 indexed botId, address indexed wallet);
    event MissionAttested(
        uint256 indexed botId,
        string  epochId,
        bytes32 strategyHash,
        string  manifestURI
    );
    event StakeIncreased(uint256 indexed botId, uint256 added, uint256 newTotal);
    event StakeWithdrawn(uint256 indexed botId, uint256 amount);
    event EpochCommitted(uint256 indexed botId, string epochId, bytes32 merkleRoot);
    event ChallengeOpened(
        uint256 indexed challengeId,
        uint256 indexed botId,
        address indexed challenger,
        uint256 stake,
        string  reason,
        string  evidenceURI
    );
    event ChallengeResolved(uint256 indexed challengeId, bool upheld);
    event BotSlashed(uint256 indexed botId, uint256 amount, address recipient);
    event ManifestUpdated(uint256 indexed botId, string manifestURI, bytes32 manifestHash);
    event OwnerTransferred(address indexed previousOwner, address indexed newOwner);

    // ─── Errors ────────────────────────────────────────────────────────────
    error NotOperator();
    error NotOwner();
    error WalletAlreadyLinked();
    error WalletNotLinked();
    error BotNotActive();
    error InsufficientStake();
    error AlreadyResolved();
    error TransferFailed();
    error ZeroAddress();

    // ─── Modifiers ─────────────────────────────────────────────────────────
    modifier onlyOperator(uint256 botId) {
        if (bots[botId].operator != msg.sender) revert NotOperator();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _stakeToken, uint256 _minStake, uint256 _minChallenge) {
        if (_stakeToken == address(0)) revert ZeroAddress();
        stakeToken   = IERC20(_stakeToken);
        minStake     = _minStake;
        minChallenge = _minChallenge;
        owner        = msg.sender;
        emit OwnerTransferred(address(0), msg.sender);
    }

    // ─── Bot lifecycle ─────────────────────────────────────────────────────

    /// @notice Register a new bot. Operator must approve `stake` USDC first.
    /// @param  manifestURI   IPFS/Arweave URI for the canonical manifest JSON.
    /// @param  manifestHash  keccak256 of the canonical manifest content.
    /// @param  stake         USDC stake (>= minStake).
    function register(
        string calldata manifestURI,
        bytes32 manifestHash,
        uint256 stake
    ) external returns (uint256 botId) {
        if (stake < minStake) revert InsufficientStake();
        _pull(msg.sender, stake);
        botId = nextBotId++;
        bots[botId] = Bot({
            operator:     msg.sender,
            manifestURI:  manifestURI,
            manifestHash: manifestHash,
            stake:        stake,
            registeredAt: uint64(block.timestamp),
            active:       true
        });
        emit BotRegistered(botId, msg.sender, manifestURI, manifestHash, stake);
    }

    /// @notice Update the manifest. The hash must accompany the URI so the
    ///         indexer can verify what the operator claims to have published.
    function updateManifest(
        uint256 botId,
        string calldata manifestURI,
        bytes32 manifestHash
    ) external onlyOperator(botId) {
        if (!bots[botId].active) revert BotNotActive();
        bots[botId].manifestURI  = manifestURI;
        bots[botId].manifestHash = manifestHash;
        emit ManifestUpdated(botId, manifestURI, manifestHash);
    }

    /// @notice Link a trading wallet. Wallet must not be linked to any other bot.
    function linkWallet(uint256 botId, address wallet) external onlyOperator(botId) {
        if (!bots[botId].active) revert BotNotActive();
        if (wallet == address(0)) revert ZeroAddress();
        if (walletToBotId[wallet] != 0) revert WalletAlreadyLinked();
        walletToBotId[wallet] = botId;
        _wallets[botId].push(wallet);
        emit WalletLinked(botId, wallet);
    }

    /// @notice Unlink a previously linked wallet.
    function unlinkWallet(uint256 botId, address wallet) external onlyOperator(botId) {
        if (walletToBotId[wallet] != botId) revert WalletNotLinked();
        delete walletToBotId[wallet];
        // we leave the entry in _wallets[botId] for historical lookup; the canonical
        // "currently linked" check is walletToBotId.
        emit WalletUnlinked(botId, wallet);
    }

    // ─── Missions ──────────────────────────────────────────────────────────

    /// @notice Commit to a strategy BEFORE an epoch starts. The whole point:
    ///         once attested, the bot can't retroactively reframe its trades.
    /// @param  epochId       Free-form epoch identifier (e.g. "2026-06-08").
    /// @param  strategyHash  keccak256 of the strategy descriptor (params, rules).
    /// @param  manifestURI   IPFS URI for the mission JSON (benchmark, scope, limits).
    function attestMission(
        uint256 botId,
        string calldata epochId,
        bytes32 strategyHash,
        string calldata manifestURI
    ) external onlyOperator(botId) {
        if (!bots[botId].active) revert BotNotActive();
        emit MissionAttested(botId, epochId, strategyHash, manifestURI);
    }

    // ─── Stake ─────────────────────────────────────────────────────────────

    function increaseStake(uint256 botId, uint256 amount) external onlyOperator(botId) {
        if (!bots[botId].active) revert BotNotActive();
        _pull(msg.sender, amount);
        bots[botId].stake += amount;
        emit StakeIncreased(botId, amount, bots[botId].stake);
    }

    /// @notice Voluntary exit. Marks bot inactive and refunds the operator.
    ///         Indexer should freeze the bot's reputation as of this block.
    function withdrawStake(uint256 botId) external onlyOperator(botId) {
        Bot storage b = bots[botId];
        if (!b.active) revert BotNotActive();
        uint256 amount = b.stake;
        b.stake  = 0;
        b.active = false;
        _push(msg.sender, amount);
        emit StakeWithdrawn(botId, amount);
    }

    // ─── Epoch commits ─────────────────────────────────────────────────────

    /// @notice Owner commits the indexer's merkle root for a bot's epoch.
    ///         Anyone can later prove an off-chain stat against this root.
    function commitEpoch(
        uint256 botId,
        string calldata epochId,
        bytes32 merkleRoot
    ) external onlyOwner {
        emit EpochCommitted(botId, epochId, merkleRoot);
    }

    // ─── Challenges ────────────────────────────────────────────────────────

    /// @notice Open a challenge against a bot. Challenger stakes USDC.
    function openChallenge(
        uint256 botId,
        uint256 stake,
        string calldata reason,
        string calldata evidenceURI
    ) external returns (uint256 challengeId) {
        if (!bots[botId].active) revert BotNotActive();
        if (stake < minChallenge) revert InsufficientStake();
        _pull(msg.sender, stake);
        challengeId = nextChallengeId++;
        challenges[challengeId] = Challenge({
            botId:       botId,
            challenger:  msg.sender,
            stake:       stake,
            reason:      reason,
            evidenceURI: evidenceURI,
            resolved:    false,
            upheld:      false
        });
        emit ChallengeOpened(challengeId, botId, msg.sender, stake, reason, evidenceURI);
    }

    /// @notice Resolve a challenge. Upheld → slash bot, pay challenger.
    ///                              Rejected → bot keeps stake + challenger's stake.
    /// @dev    For MVP, the owner is the resolver. v2 = multisig or committee.
    function resolveChallenge(uint256 challengeId, bool upheld) external onlyOwner {
        Challenge storage c = challenges[challengeId];
        if (c.resolved) revert AlreadyResolved();
        c.resolved = true;
        c.upheld   = upheld;

        Bot storage b = bots[c.botId];
        if (upheld) {
            uint256 botStake = b.stake;
            b.stake  = 0;
            b.active = false;
            _push(c.challenger, botStake + c.stake);
            emit BotSlashed(c.botId, botStake, c.challenger);
        } else {
            b.stake += c.stake;
        }
        emit ChallengeResolved(challengeId, upheld);
    }

    // ─── Owner ─────────────────────────────────────────────────────────────

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address prev = owner;
        owner = newOwner;
        emit OwnerTransferred(prev, newOwner);
    }

    // ─── Views ─────────────────────────────────────────────────────────────

    function getWallets(uint256 botId) external view returns (address[] memory) {
        return _wallets[botId];
    }

    function isActive(uint256 botId) external view returns (bool) {
        return bots[botId].active;
    }

    // ─── Internals ─────────────────────────────────────────────────────────

    function _pull(address from, uint256 amount) internal {
        bool ok = stakeToken.transferFrom(from, address(this), amount);
        if (!ok) revert TransferFailed();
    }

    function _push(address to, uint256 amount) internal {
        bool ok = stakeToken.transfer(to, amount);
        if (!ok) revert TransferFailed();
    }
}

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}
