// Registry events — human-readable form for viem's parseAbi.
import { parseAbi } from "viem";

export const REGISTRY_EVENTS = parseAbi([
  "event BotRegistered(uint256 indexed botId, address indexed operator, string manifestURI, bytes32 manifestHash, uint256 stake)",
  "event WalletLinked(uint256 indexed botId, address indexed wallet)",
  "event WalletUnlinked(uint256 indexed botId, address indexed wallet)",
  "event MissionAttested(uint256 indexed botId, string epochId, bytes32 strategyHash, string manifestURI)",
  "event StakeIncreased(uint256 indexed botId, uint256 added, uint256 newTotal)",
  "event StakeWithdrawn(uint256 indexed botId, uint256 amount)",
  "event ManifestUpdated(uint256 indexed botId, string manifestURI, bytes32 manifestHash)",
  "event EpochCommitted(uint256 indexed botId, string epochId, bytes32 merkleRoot)",
  "event ChallengeOpened(uint256 indexed challengeId, uint256 indexed botId, address indexed challenger, uint256 stake, string reason, string evidenceURI)",
  "event ChallengeResolved(uint256 indexed challengeId, bool upheld)",
  "event BotSlashed(uint256 indexed botId, uint256 amount, address recipient)",
  "event OwnerTransferred(address indexed previousOwner, address indexed newOwner)",
]);
