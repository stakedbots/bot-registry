const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const MIN_STAKE     = 100_000_000n;   // 100 USDC (6 decimals)
const MIN_CHALLENGE = 50_000_000n;    // 50  USDC
const MINT_AMOUNT   = 10_000_000_000n; // 10k USDC

const MANIFEST_URI  = "ipfs://bafkreigh2akiscaildc6jclzj7uo6lyl5gpxn2pfgwqzqfanphjg";
const MANIFEST_HASH = ethers.keccak256(ethers.toUtf8Bytes("manifest-v1"));
const STRATEGY_HASH = ethers.keccak256(ethers.toUtf8Bytes("strategy-v1"));
const EPOCH_ID      = "2026-06-08";
const MISSION_URI   = "ipfs://bafkreimissionjsonhash";

async function deployFixture() {
  const [owner, op1, op2, challenger, wallet1, wallet2, other] = await ethers.getSigners();

  const Usdc = await ethers.getContractFactory("MockUSDC");
  const usdc = await Usdc.deploy();

  for (const s of [op1, op2, challenger]) {
    await usdc.mint(s.address, MINT_AMOUNT);
  }

  const Registry = await ethers.getContractFactory("Registry");
  const registry = await Registry.deploy(await usdc.getAddress(), MIN_STAKE, MIN_CHALLENGE);

  for (const s of [op1, op2, challenger]) {
    await usdc.connect(s).approve(await registry.getAddress(), ethers.MaxUint256);
  }

  return { registry, usdc, owner, op1, op2, challenger, wallet1, wallet2, other };
}

async function registerBot(registry, op, stake = MIN_STAKE) {
  const tx = await registry.connect(op).register(MANIFEST_URI, MANIFEST_HASH, stake);
  await tx.wait();
}

describe("Registry", () => {
  describe("constructor", () => {
    it("sets immutables and owner", async () => {
      const { registry, usdc, owner } = await loadFixture(deployFixture);
      expect(await registry.stakeToken()).to.equal(await usdc.getAddress());
      expect(await registry.minStake()).to.equal(MIN_STAKE);
      expect(await registry.minChallenge()).to.equal(MIN_CHALLENGE);
      expect(await registry.owner()).to.equal(owner.address);
      expect(await registry.nextBotId()).to.equal(1n);
    });

    it("reverts on zero stake token", async () => {
      const Registry = await ethers.getContractFactory("Registry");
      await expect(Registry.deploy(ethers.ZeroAddress, MIN_STAKE, MIN_CHALLENGE))
        .to.be.revertedWithCustomError(Registry, "ZeroAddress");
    });
  });

  describe("register", () => {
    it("registers a bot, pulls stake, emits event, increments id", async () => {
      const { registry, usdc, op1 } = await loadFixture(deployFixture);
      const registryAddr = await registry.getAddress();

      await expect(registry.connect(op1).register(MANIFEST_URI, MANIFEST_HASH, MIN_STAKE))
        .to.emit(registry, "BotRegistered")
        .withArgs(1n, op1.address, MANIFEST_URI, MANIFEST_HASH, MIN_STAKE);

      expect(await usdc.balanceOf(registryAddr)).to.equal(MIN_STAKE);
      expect(await registry.nextBotId()).to.equal(2n);

      const bot = await registry.bots(1n);
      expect(bot.operator).to.equal(op1.address);
      expect(bot.manifestURI).to.equal(MANIFEST_URI);
      expect(bot.manifestHash).to.equal(MANIFEST_HASH);
      expect(bot.stake).to.equal(MIN_STAKE);
      expect(bot.active).to.equal(true);
    });

    it("reverts under minStake", async () => {
      const { registry, op1 } = await loadFixture(deployFixture);
      await expect(registry.connect(op1).register(MANIFEST_URI, MANIFEST_HASH, MIN_STAKE - 1n))
        .to.be.revertedWithCustomError(registry, "InsufficientStake");
    });

    it("assigns sequential ids across operators", async () => {
      const { registry, op1, op2 } = await loadFixture(deployFixture);
      await registerBot(registry, op1);
      await registerBot(registry, op2);
      expect((await registry.bots(1n)).operator).to.equal(op1.address);
      expect((await registry.bots(2n)).operator).to.equal(op2.address);
    });
  });

  describe("updateManifest", () => {
    it("operator can update; emits event", async () => {
      const { registry, op1 } = await loadFixture(deployFixture);
      await registerBot(registry, op1);
      const newUri  = "ipfs://new";
      const newHash = ethers.keccak256(ethers.toUtf8Bytes("v2"));
      await expect(registry.connect(op1).updateManifest(1n, newUri, newHash))
        .to.emit(registry, "ManifestUpdated").withArgs(1n, newUri, newHash);
      const bot = await registry.bots(1n);
      expect(bot.manifestURI).to.equal(newUri);
      expect(bot.manifestHash).to.equal(newHash);
    });

    it("non-operator reverts", async () => {
      const { registry, op1, op2 } = await loadFixture(deployFixture);
      await registerBot(registry, op1);
      await expect(registry.connect(op2).updateManifest(1n, "ipfs://x", MANIFEST_HASH))
        .to.be.revertedWithCustomError(registry, "NotOperator");
    });

    it("reverts when bot inactive", async () => {
      const { registry, op1 } = await loadFixture(deployFixture);
      await registerBot(registry, op1);
      await registry.connect(op1).withdrawStake(1n);
      await expect(registry.connect(op1).updateManifest(1n, "ipfs://x", MANIFEST_HASH))
        .to.be.revertedWithCustomError(registry, "BotNotActive");
    });
  });

  describe("linkWallet / unlinkWallet", () => {
    it("operator links and unlinks; emits; views update", async () => {
      const { registry, op1, wallet1 } = await loadFixture(deployFixture);
      await registerBot(registry, op1);

      await expect(registry.connect(op1).linkWallet(1n, wallet1.address))
        .to.emit(registry, "WalletLinked").withArgs(1n, wallet1.address);

      expect(await registry.walletToBotId(wallet1.address)).to.equal(1n);
      expect(await registry.getWallets(1n)).to.deep.equal([wallet1.address]);

      await expect(registry.connect(op1).unlinkWallet(1n, wallet1.address))
        .to.emit(registry, "WalletUnlinked").withArgs(1n, wallet1.address);
      expect(await registry.walletToBotId(wallet1.address)).to.equal(0n);
    });

    it("rejects wallet already linked to another bot", async () => {
      const { registry, op1, op2, wallet1 } = await loadFixture(deployFixture);
      await registerBot(registry, op1);
      await registerBot(registry, op2);
      await registry.connect(op1).linkWallet(1n, wallet1.address);
      await expect(registry.connect(op2).linkWallet(2n, wallet1.address))
        .to.be.revertedWithCustomError(registry, "WalletAlreadyLinked");
    });

    it("rejects zero address", async () => {
      const { registry, op1 } = await loadFixture(deployFixture);
      await registerBot(registry, op1);
      await expect(registry.connect(op1).linkWallet(1n, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(registry, "ZeroAddress");
    });

    it("non-operator cannot link or unlink", async () => {
      const { registry, op1, op2, wallet1 } = await loadFixture(deployFixture);
      await registerBot(registry, op1);
      await expect(registry.connect(op2).linkWallet(1n, wallet1.address))
        .to.be.revertedWithCustomError(registry, "NotOperator");

      await registry.connect(op1).linkWallet(1n, wallet1.address);
      await expect(registry.connect(op2).unlinkWallet(1n, wallet1.address))
        .to.be.revertedWithCustomError(registry, "NotOperator");
    });

    it("unlinking a wallet not linked to this bot reverts", async () => {
      const { registry, op1, wallet1 } = await loadFixture(deployFixture);
      await registerBot(registry, op1);
      await expect(registry.connect(op1).unlinkWallet(1n, wallet1.address))
        .to.be.revertedWithCustomError(registry, "WalletNotLinked");
    });

    it("allows re-linking after unlink (to same or different bot)", async () => {
      const { registry, op1, op2, wallet1 } = await loadFixture(deployFixture);
      await registerBot(registry, op1);
      await registerBot(registry, op2);
      await registry.connect(op1).linkWallet(1n, wallet1.address);
      await registry.connect(op1).unlinkWallet(1n, wallet1.address);
      await expect(registry.connect(op2).linkWallet(2n, wallet1.address))
        .to.emit(registry, "WalletLinked").withArgs(2n, wallet1.address);
      expect(await registry.walletToBotId(wallet1.address)).to.equal(2n);
    });
  });

  describe("attestMission", () => {
    it("operator attests; emits event with all fields", async () => {
      const { registry, op1 } = await loadFixture(deployFixture);
      await registerBot(registry, op1);
      await expect(registry.connect(op1).attestMission(1n, EPOCH_ID, STRATEGY_HASH, MISSION_URI))
        .to.emit(registry, "MissionAttested")
        .withArgs(1n, EPOCH_ID, STRATEGY_HASH, MISSION_URI);
    });

    it("non-operator reverts", async () => {
      const { registry, op1, op2 } = await loadFixture(deployFixture);
      await registerBot(registry, op1);
      await expect(registry.connect(op2).attestMission(1n, EPOCH_ID, STRATEGY_HASH, MISSION_URI))
        .to.be.revertedWithCustomError(registry, "NotOperator");
    });

    it("reverts when bot inactive", async () => {
      const { registry, op1 } = await loadFixture(deployFixture);
      await registerBot(registry, op1);
      await registry.connect(op1).withdrawStake(1n);
      await expect(registry.connect(op1).attestMission(1n, EPOCH_ID, STRATEGY_HASH, MISSION_URI))
        .to.be.revertedWithCustomError(registry, "BotNotActive");
    });
  });

  describe("increaseStake / withdrawStake", () => {
    it("increaseStake pulls funds and grows stake", async () => {
      const { registry, usdc, op1 } = await loadFixture(deployFixture);
      await registerBot(registry, op1);
      const extra = 50_000_000n;
      await expect(registry.connect(op1).increaseStake(1n, extra))
        .to.emit(registry, "StakeIncreased").withArgs(1n, extra, MIN_STAKE + extra);
      expect((await registry.bots(1n)).stake).to.equal(MIN_STAKE + extra);
      expect(await usdc.balanceOf(await registry.getAddress())).to.equal(MIN_STAKE + extra);
    });

    it("withdrawStake refunds operator, marks inactive", async () => {
      const { registry, usdc, op1 } = await loadFixture(deployFixture);
      await registerBot(registry, op1);
      const before = await usdc.balanceOf(op1.address);
      await expect(registry.connect(op1).withdrawStake(1n))
        .to.emit(registry, "StakeWithdrawn").withArgs(1n, MIN_STAKE);
      expect(await usdc.balanceOf(op1.address)).to.equal(before + MIN_STAKE);
      const bot = await registry.bots(1n);
      expect(bot.stake).to.equal(0n);
      expect(bot.active).to.equal(false);
    });

    it("withdrawStake twice reverts", async () => {
      const { registry, op1 } = await loadFixture(deployFixture);
      await registerBot(registry, op1);
      await registry.connect(op1).withdrawStake(1n);
      await expect(registry.connect(op1).withdrawStake(1n))
        .to.be.revertedWithCustomError(registry, "BotNotActive");
    });

    it("non-operator cannot increase or withdraw", async () => {
      const { registry, op1, op2 } = await loadFixture(deployFixture);
      await registerBot(registry, op1);
      await expect(registry.connect(op2).increaseStake(1n, 1n))
        .to.be.revertedWithCustomError(registry, "NotOperator");
      await expect(registry.connect(op2).withdrawStake(1n))
        .to.be.revertedWithCustomError(registry, "NotOperator");
    });
  });

  describe("commitEpoch", () => {
    it("owner emits epoch commit", async () => {
      const { registry, owner, op1 } = await loadFixture(deployFixture);
      await registerBot(registry, op1);
      const root = ethers.keccak256(ethers.toUtf8Bytes("merkle-root-v1"));
      await expect(registry.connect(owner).commitEpoch(1n, EPOCH_ID, root))
        .to.emit(registry, "EpochCommitted").withArgs(1n, EPOCH_ID, root);
    });

    it("non-owner cannot commit", async () => {
      const { registry, op1 } = await loadFixture(deployFixture);
      await registerBot(registry, op1);
      await expect(registry.connect(op1).commitEpoch(1n, EPOCH_ID, ethers.ZeroHash))
        .to.be.revertedWithCustomError(registry, "NotOwner");
    });
  });

  describe("openChallenge", () => {
    it("challenger opens, contract pulls stake, emits event", async () => {
      const { registry, usdc, op1, challenger } = await loadFixture(deployFixture);
      await registerBot(registry, op1);
      const before = await usdc.balanceOf(await registry.getAddress());

      await expect(
        registry.connect(challenger).openChallenge(1n, MIN_CHALLENGE, "wash_trade", "ipfs://evidence")
      ).to.emit(registry, "ChallengeOpened")
       .withArgs(1n, 1n, challenger.address, MIN_CHALLENGE, "wash_trade", "ipfs://evidence");

      expect(await usdc.balanceOf(await registry.getAddress())).to.equal(before + MIN_CHALLENGE);
      const ch = await registry.challenges(1n);
      expect(ch.botId).to.equal(1n);
      expect(ch.challenger).to.equal(challenger.address);
      expect(ch.resolved).to.equal(false);
    });

    it("under minChallenge reverts", async () => {
      const { registry, op1, challenger } = await loadFixture(deployFixture);
      await registerBot(registry, op1);
      await expect(
        registry.connect(challenger).openChallenge(1n, MIN_CHALLENGE - 1n, "wash_trade", "ipfs://x")
      ).to.be.revertedWithCustomError(registry, "InsufficientStake");
    });

    it("against inactive bot reverts", async () => {
      const { registry, op1, challenger } = await loadFixture(deployFixture);
      await registerBot(registry, op1);
      await registry.connect(op1).withdrawStake(1n);
      await expect(
        registry.connect(challenger).openChallenge(1n, MIN_CHALLENGE, "wash_trade", "ipfs://x")
      ).to.be.revertedWithCustomError(registry, "BotNotActive");
    });
  });

  describe("resolveChallenge", () => {
    it("upheld: slashes bot, pays challenger total pool, bot inactive", async () => {
      const { registry, usdc, owner, op1, challenger } = await loadFixture(deployFixture);
      await registerBot(registry, op1, MIN_STAKE);
      await registry.connect(challenger).openChallenge(1n, MIN_CHALLENGE, "wash_trade", "ipfs://x");

      const challengerBefore = await usdc.balanceOf(challenger.address);
      await expect(registry.connect(owner).resolveChallenge(1n, true))
        .to.emit(registry, "BotSlashed").withArgs(1n, MIN_STAKE, challenger.address)
        .and.to.emit(registry, "ChallengeResolved").withArgs(1n, true);

      const bot = await registry.bots(1n);
      expect(bot.stake).to.equal(0n);
      expect(bot.active).to.equal(false);
      expect(await usdc.balanceOf(challenger.address))
        .to.equal(challengerBefore + MIN_STAKE + MIN_CHALLENGE);
    });

    it("rejected: bot keeps stake + absorbs challenger stake; bot still active", async () => {
      const { registry, owner, op1, challenger } = await loadFixture(deployFixture);
      await registerBot(registry, op1, MIN_STAKE);
      await registry.connect(challenger).openChallenge(1n, MIN_CHALLENGE, "wash_trade", "ipfs://x");

      await expect(registry.connect(owner).resolveChallenge(1n, false))
        .to.emit(registry, "ChallengeResolved").withArgs(1n, false);

      const bot = await registry.bots(1n);
      expect(bot.stake).to.equal(MIN_STAKE + MIN_CHALLENGE);
      expect(bot.active).to.equal(true);
    });

    it("non-owner cannot resolve", async () => {
      const { registry, op1, challenger } = await loadFixture(deployFixture);
      await registerBot(registry, op1);
      await registry.connect(challenger).openChallenge(1n, MIN_CHALLENGE, "wash_trade", "ipfs://x");
      await expect(registry.connect(op1).resolveChallenge(1n, true))
        .to.be.revertedWithCustomError(registry, "NotOwner");
    });

    it("cannot resolve twice", async () => {
      const { registry, owner, op1, challenger } = await loadFixture(deployFixture);
      await registerBot(registry, op1);
      await registry.connect(challenger).openChallenge(1n, MIN_CHALLENGE, "wash_trade", "ipfs://x");
      await registry.connect(owner).resolveChallenge(1n, false);
      await expect(registry.connect(owner).resolveChallenge(1n, true))
        .to.be.revertedWithCustomError(registry, "AlreadyResolved");
    });
  });

  describe("transferOwnership", () => {
    it("owner transfers; emits event", async () => {
      const { registry, owner, op1 } = await loadFixture(deployFixture);
      await expect(registry.connect(owner).transferOwnership(op1.address))
        .to.emit(registry, "OwnerTransferred").withArgs(owner.address, op1.address);
      expect(await registry.owner()).to.equal(op1.address);
    });

    it("non-owner cannot transfer", async () => {
      const { registry, op1, op2 } = await loadFixture(deployFixture);
      await expect(registry.connect(op1).transferOwnership(op2.address))
        .to.be.revertedWithCustomError(registry, "NotOwner");
    });

    it("rejects zero address", async () => {
      const { registry, owner } = await loadFixture(deployFixture);
      await expect(registry.connect(owner).transferOwnership(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(registry, "ZeroAddress");
    });
  });

  describe("isActive view", () => {
    it("returns true after register, false after withdraw, false after slash", async () => {
      const { registry, owner, op1, op2, challenger } = await loadFixture(deployFixture);
      await registerBot(registry, op1);
      expect(await registry.isActive(1n)).to.equal(true);
      await registry.connect(op1).withdrawStake(1n);
      expect(await registry.isActive(1n)).to.equal(false);

      await registerBot(registry, op2);
      await registry.connect(challenger).openChallenge(2n, MIN_CHALLENGE, "wash_trade", "ipfs://x");
      await registry.connect(owner).resolveChallenge(1n, true);
      expect(await registry.isActive(2n)).to.equal(false);
    });
  });
});
