import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

/**
 * Tests for LastSignalSealedChoice.
 *
 * These use the @fhevm/hardhat-plugin mocked FHEVM environment
 * (the same setup as Zama's fhevm-hardhat-template and as
 * Sealed Fortune's tests), so encrypted values can be created
 * and decrypted in tests without a live Sepolia node.
 * Run with: npm test
 *
 * What is tested here is the GAME LOGIC around the encryption:
 * one seal per choice per player, no reveal before both choices
 * are sealed, no second reveal, players stay independent, and -
 * the important one - the two sealed choices decrypt to exactly
 * the numbers the player picked, and only after reveal.
 *
 * Choice numbers: Act I priority power 0 = Hospital,
 * 1 = Residential, 2 = Industrial. Act III final fix
 * 0 = Quick Fix, 1 = Rebuild, 2 = Third Way.
 */
describe("LastSignalSealedChoice", function () {
  async function deploy() {
    const [host, alice, bob] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("LastSignalSealedChoice");
    const game = await factory.deploy();
    return { game, host, alice, bob };
  }

  async function sealPriority(game: any, player: any, value: number) {
    const address = await game.getAddress();
    const input = await fhevm.createEncryptedInput(address, player.address).add8(value).encrypt();
    await game.connect(player).sealPriorityPower(input.handles[0], input.inputProof);
  }

  async function sealFinal(game: any, player: any, value: number) {
    const address = await game.getAddress();
    const input = await fhevm.createEncryptedInput(address, player.address).add8(value).encrypt();
    await game.connect(player).sealFinalChoice(input.handles[0], input.inputProof);
  }

  it("seals the Act I priority-power choice and records the player", async function () {
    const { game, alice } = await deploy();
    const address = await game.getAddress();
    const input = await fhevm.createEncryptedInput(address, alice.address).add8(0).encrypt();
    await expect(game.connect(alice).sealPriorityPower(input.handles[0], input.inputProof))
      .to.emit(game, "PriorityPowerSealed");
    expect(await game.hasSealedPriorityPower(alice.address)).to.equal(true);
    expect(await game.hasSealedFinalChoice(alice.address)).to.equal(false);
    expect(await game.isRevealed(alice.address)).to.equal(false);
    expect(await game.getPlayers()).to.deep.equal([alice.address]);
    // The stored choice is only a ciphertext handle on-chain.
    expect(await game.getPriorityPower(alice.address)).to.not.equal(ethers.ZeroHash);
  });

  it("seals the Act III final choice and records the player", async function () {
    const { game, alice } = await deploy();
    const address = await game.getAddress();
    const input = await fhevm.createEncryptedInput(address, alice.address).add8(2).encrypt();
    await expect(game.connect(alice).sealFinalChoice(input.handles[0], input.inputProof))
      .to.emit(game, "FinalChoiceSealed");
    expect(await game.hasSealedFinalChoice(alice.address)).to.equal(true);
    expect(await game.hasSealedPriorityPower(alice.address)).to.equal(false);
    expect(await game.getFinalChoice(alice.address)).to.not.equal(ethers.ZeroHash);
  });

  it("rejects a second seal of the same choice from the same player", async function () {
    const { game, alice } = await deploy();
    await sealPriority(game, alice, 1);
    const address = await game.getAddress();
    const input = await fhevm.createEncryptedInput(address, alice.address).add8(2).encrypt();
    await expect(game.connect(alice).sealPriorityPower(input.handles[0], input.inputProof))
      .to.be.revertedWith("Priority power already sealed");
    await sealFinal(game, alice, 0);
    const input2 = await fhevm.createEncryptedInput(address, alice.address).add8(1).encrypt();
    await expect(game.connect(alice).sealFinalChoice(input2.handles[0], input2.inputProof))
      .to.be.revertedWith("Final choice already sealed");
  });

  it("rejects reveal before both choices are sealed", async function () {
    const { game, alice } = await deploy();
    await sealPriority(game, alice, 0);
    await expect(game.revealChoices(alice.address))
      .to.be.revertedWith("Both choices must be sealed first");
  });

  it("rejects reveal for a player who sealed nothing", async function () {
    const { game, bob } = await deploy();
    await expect(game.revealChoices(bob.address))
      .to.be.revertedWith("Both choices must be sealed first");
  });

  it("reveals both choices after both are sealed and emits ChoicesRevealed", async function () {
    const { game, alice } = await deploy();
    await sealPriority(game, alice, 0);
    await sealFinal(game, alice, 2);
    await expect(game.revealChoices(alice.address)).to.emit(game, "ChoicesRevealed");
    expect(await game.isRevealed(alice.address)).to.equal(true);
  });

  it("rejects a second reveal", async function () {
    const { game, alice } = await deploy();
    await sealPriority(game, alice, 0);
    await sealFinal(game, alice, 2);
    await game.revealChoices(alice.address);
    await expect(game.revealChoices(alice.address))
      .to.be.revertedWith("Choices already revealed");
  });

  it("decrypts to exactly the numbers the player picked, only after reveal", async function () {
    const { game, alice } = await deploy();
    await sealPriority(game, alice, 1); // Residential
    await sealFinal(game, alice, 2); // Third Way
    await game.revealChoices(alice.address);
    const priorityHandle = await game.getPriorityPower(alice.address);
    const finalHandle = await game.getFinalChoice(alice.address);
    const { clearValues } = await fhevm.publicDecrypt([priorityHandle, finalHandle]);
    const priority = clearValues[priorityHandle.toLowerCase()] ?? clearValues[priorityHandle];
    const final = clearValues[finalHandle.toLowerCase()] ?? clearValues[finalHandle];
    expect(priority).to.equal(1n);
    expect(final).to.equal(2n);
  });

  it("keeps players independent - one player's seal and reveal do not affect another", async function () {
    const { game, alice, bob } = await deploy();
    await sealPriority(game, alice, 0);
    await sealFinal(game, alice, 0);
    await sealPriority(game, bob, 2);
    await game.revealChoices(alice.address);
    expect(await game.isRevealed(alice.address)).to.equal(true);
    expect(await game.isRevealed(bob.address)).to.equal(false);
    expect(await game.hasSealedFinalChoice(bob.address)).to.equal(false);
    // Bob can still seal and reveal his own choices.
    await sealFinal(game, bob, 1);
    await game.revealChoices(bob.address);
    const bobPriority = await game.getPriorityPower(bob.address);
    const bobFinal = await game.getFinalChoice(bob.address);
    const { clearValues } = await fhevm.publicDecrypt([bobPriority, bobFinal]);
    const p = clearValues[bobPriority.toLowerCase()] ?? clearValues[bobPriority];
    const f = clearValues[bobFinal.toLowerCase()] ?? clearValues[bobFinal];
    expect(p).to.equal(2n);
    expect(f).to.equal(1n);
    expect(await game.getPlayers()).to.deep.equal([alice.address, bob.address]);
  });
});
