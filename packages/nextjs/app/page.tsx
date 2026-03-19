"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { formatEther, parseEther } from "viem";
import { base } from "viem/chains";
import { useAccount, useSwitchChain } from "wagmi";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth/RainbowKitCustomConnectButton";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";

const LOCK_TIERS = [
  { value: 0, label: "No Lock", tag: "Appetizer", description: "No fee discount, 1x yield", emoji: "🦐" },
  { value: 1, label: "90 Days", tag: "Crab Feast", description: "10% fee discount, 1.05x yield", emoji: "🦀" },
  { value: 2, label: "180 Days", tag: "Lobster Tail", description: "25% fee discount, 1.15x yield", emoji: "🦞" },
  { value: 3, label: "365 Days", tag: "Admiral's Platter", description: "50% fee discount, 1.3x yield", emoji: "👑" },
] as const;

const RED_TOKEN = "0x2e662015a501f066e043d64d04f77ffe551a4b07";

const Home: NextPage = () => {
  const { address, isConnected, chain } = useAccount();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [selectedTier, setSelectedTier] = useState(0);
  const [isDepositing, setIsDepositing] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [approveCooldown, setApproveCooldown] = useState(false);
  const [isCompounding, setIsCompounding] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [redPrice, setRedPrice] = useState<number>(0);

  const targetChainId = chain?.id === 31337 ? 31337 : base.id;
  const wrongNetwork = isConnected && chain?.id !== targetChainId;

  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${RED_TOKEN}`);
        const data = await res.json();
        if (data.pairs?.[0]?.priceUsd) {
          setRedPrice(parseFloat(data.pairs[0].priceUsd));
        }
      } catch {
        /* price fetch is best-effort */
      }
    };
    fetchPrice();
    const interval = setInterval(fetchPrice, 30000);
    return () => clearInterval(interval);
  }, []);

  const { data: vaultInfo } = useDeployedContractInfo("REDVault");
  const vaultAddress = vaultInfo?.address;

  const { data: totalAssets } = useScaffoldReadContract({
    contractName: "REDVault",
    functionName: "totalAssets",
    watch: true,
  });

  const { data: userDeposit } = useScaffoldReadContract({
    contractName: "REDVault",
    functionName: "userDeposits",
    args: [address],
    watch: true,
  });

  const { data: stRedBalance } = useScaffoldReadContract({
    contractName: "REDVault",
    functionName: "balanceOf",
    args: [address],
    watch: true,
  });

  const { data: underlyingBal } = useScaffoldReadContract({
    contractName: "REDVault",
    functionName: "underlyingBalance",
    args: [address],
    watch: true,
  });

  const { data: totalSupply } = useScaffoldReadContract({
    contractName: "REDVault",
    functionName: "totalSupply",
    watch: true,
  });

  const { data: redAllowance } = useScaffoldReadContract({
    contractName: "REDToken",
    functionName: "allowance",
    args: [address, vaultAddress],
    watch: true,
  });

  const { data: redBalance } = useScaffoldReadContract({
    contractName: "REDToken",
    functionName: "balanceOf",
    args: [address],
    watch: true,
  });

  // BOTSTER token reads
  const { data: botsterBalance } = useScaffoldReadContract({
    contractName: "BotsterToken",
    functionName: "balanceOf",
    args: [address],
    watch: true,
  });

  const { data: botsterClaimable } = useScaffoldReadContract({
    contractName: "BotsterRewards",
    functionName: "earned",
    args: [address],
    watch: true,
  });

  const { data: currentEpoch } = useScaffoldReadContract({
    contractName: "BotsterRewards",
    functionName: "currentEpoch",
    watch: true,
  });

  const { writeContractAsync: vaultWrite } = useScaffoldWriteContract("REDVault");
  const { writeContractAsync: tokenWrite } = useScaffoldWriteContract("REDToken");
  const { writeContractAsync: rewardsWrite } = useScaffoldWriteContract("BotsterRewards");

  const depositAmountWei = depositAmount ? parseEther(depositAmount) : 0n;
  const needsApproval = !redAllowance || redAllowance < depositAmountWei;

  const handleApprove = async () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0 || !vaultAddress) return;
    setIsApproving(true);
    try {
      const approveAmount = depositAmountWei * 3n;
      await tokenWrite({
        functionName: "approve",
        args: [vaultAddress, approveAmount],
      });
      setApproveCooldown(true);
      setTimeout(() => setApproveCooldown(false), 4000);
    } catch (e) {
      console.error("Approve failed:", e);
    } finally {
      setIsApproving(false);
    }
  };

  const syncBotsterRewards = async () => {
    if (!address) return;
    try {
      await rewardsWrite({
        functionName: "sync",
        args: [address],
      });
    } catch (e) {
      console.error("BOTSTER sync failed:", e);
    }
  };

  const handleDeposit = async () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0) return;
    setIsDepositing(true);
    try {
      await vaultWrite({
        functionName: "deposit",
        args: [parseEther(depositAmount), selectedTier],
      });
      setDepositAmount("");
      await syncBotsterRewards();
    } catch (e) {
      console.error("Deposit failed:", e);
    } finally {
      setIsDepositing(false);
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) return;
    setIsWithdrawing(true);
    try {
      await vaultWrite({
        functionName: "withdraw",
        args: [parseEther(withdrawAmount)],
      });
      setWithdrawAmount("");
      await syncBotsterRewards();
    } catch (e) {
      console.error("Withdraw failed:", e);
    } finally {
      setIsWithdrawing(false);
    }
  };

  const handleCompound = async () => {
    setIsCompounding(true);
    try {
      await vaultWrite({ functionName: "compound" });
    } catch (e) {
      console.error("Compound failed:", e);
    } finally {
      setIsCompounding(false);
    }
  };

  const handleClaim = async () => {
    setIsClaiming(true);
    try {
      await rewardsWrite({ functionName: "claim" });
    } catch (e) {
      console.error("Claim failed:", e);
    } finally {
      setIsClaiming(false);
    }
  };

  const tvl = totalAssets ? formatEther(totalAssets) : "0";
  const tvlUsd = redPrice > 0 ? `~$${(parseFloat(tvl) * redPrice).toFixed(2)}` : "";
  const userShares = stRedBalance ? formatEther(stRedBalance) : "0";
  const userUnderlying = underlyingBal ? formatEther(underlyingBal) : "0";
  const userUnderlyingUsd = redPrice > 0 ? `~$${(parseFloat(userUnderlying) * redPrice).toFixed(2)}` : "";
  const userRedBal = redBalance ? formatEther(redBalance) : "0";
  const userRedBalUsd = redPrice > 0 ? `~$${(parseFloat(userRedBal) * redPrice).toFixed(2)}` : "";
  const userBotsterBal = botsterBalance ? formatEther(botsterBalance) : "0";
  const userBotsterClaimable = botsterClaimable ? formatEther(botsterClaimable) : "0";

  const lockExpiry = userDeposit ? Number(userDeposit[1]) : 0;
  const lockTier = userDeposit ? Number(userDeposit[2]) : 0;
  const isLocked = lockExpiry > Math.floor(Date.now() / 1000);

  const renderDepositButton = () => {
    if (!isConnected) {
      return <RainbowKitCustomConnectButton />;
    }
    if (wrongNetwork) {
      return (
        <button
          className="btn btn-warning w-full"
          onClick={() => switchChain({ chainId: base.id })}
          disabled={isSwitching}
        >
          {isSwitching ? (
            <>
              <span className="loading loading-spinner loading-sm" /> Switching...
            </>
          ) : (
            "Switch to Base"
          )}
        </button>
      );
    }
    if (needsApproval && depositAmount && parseFloat(depositAmount) > 0) {
      return (
        <button
          className="btn bg-[#cc0000] hover:bg-[#aa0000] text-white border-none w-full"
          onClick={handleApprove}
          disabled={isApproving || approveCooldown}
        >
          {isApproving || approveCooldown ? (
            <>
              <span className="loading loading-spinner loading-sm" /> Approving...
            </>
          ) : (
            "Approve RED"
          )}
        </button>
      );
    }
    return (
      <button
        className="btn bg-[#cc0000] hover:bg-[#aa0000] text-white border-none w-full"
        onClick={handleDeposit}
        disabled={isDepositing || !depositAmount || parseFloat(depositAmount) <= 0}
      >
        {isDepositing ? (
          <>
            <span className="loading loading-spinner loading-sm" /> Depositing...
          </>
        ) : (
          "Place Your Order"
        )}
      </button>
    );
  };

  const renderWithdrawButton = () => {
    if (!isConnected) {
      return <RainbowKitCustomConnectButton />;
    }
    if (wrongNetwork) {
      return (
        <button
          className="btn btn-warning w-full"
          onClick={() => switchChain({ chainId: base.id })}
          disabled={isSwitching}
        >
          {isSwitching ? (
            <>
              <span className="loading loading-spinner loading-sm" /> Switching...
            </>
          ) : (
            "Switch to Base"
          )}
        </button>
      );
    }
    return (
      <button
        className="btn bg-[#8b0000] hover:bg-[#6b0000] text-white border-none w-full"
        onClick={handleWithdraw}
        disabled={isWithdrawing || !withdrawAmount || parseFloat(withdrawAmount) <= 0 || isLocked}
      >
        {isWithdrawing ? (
          <>
            <span className="loading loading-spinner loading-sm" /> Withdrawing...
          </>
        ) : isLocked ? (
          "Still Marinating..."
        ) : (
          "Cash Out"
        )}
      </button>
    );
  };

  return (
    <div className="flex flex-col items-center gap-6 p-4 md:p-8 min-h-screen">
      {/* Hero Banner */}
      <div className="w-full max-w-5xl bg-gradient-to-r from-[#cc0000] via-[#990000] to-[#cc0000] rounded-xl shadow-xl p-8 text-center text-white relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, transparent, transparent 20px, rgba(255,255,255,0.1) 20px, rgba(255,255,255,0.1) 40px)",
          }}
        />
        <div className="relative z-10">
          <div className="flex justify-center mb-4">
            <div className="w-20 h-20 rounded-full overflow-hidden border-4 border-[#d4a017] shadow-lg">
              <Image src="/pfp.jpg" alt="RedBotster" width={80} height={80} className="object-cover" />
            </div>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-2" style={{ fontFamily: "Georgia, serif" }}>
            Red Botster
          </h1>
          <p className="text-lg text-white/80 tracking-widest uppercase mb-1" style={{ fontFamily: "Georgia, serif" }}>
            Staking & Seafood
          </p>
          <p className="text-sm text-white/60 max-w-xl mx-auto">
            Deposit your RED tokens into our vault and watch your yield simmer. Auto-compounding rewards served fresh on
            Base.
          </p>
        </div>
      </div>

      {/* Today's Specials — Stats */}
      <div className="w-full max-w-5xl">
        <h2
          className="text-center text-xs tracking-[0.3em] uppercase opacity-50 mb-3"
          style={{ fontFamily: "Georgia, serif" }}
        >
          Today&apos;s Specials
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="card bg-base-100 shadow-md border border-[#cc0000]/10">
            <div className="card-body p-5 text-center">
              <p className="text-3xl mb-1">🦞</p>
              <h2 className="text-xs tracking-widest uppercase opacity-50" style={{ fontFamily: "Georgia, serif" }}>
                Total Value Locked
              </h2>
              <p className="text-2xl font-bold text-[#cc0000]">{parseFloat(tvl).toLocaleString()} RED</p>
              {tvlUsd && <p className="text-sm opacity-50">{tvlUsd}</p>}
            </div>
          </div>
          <div className="card bg-base-100 shadow-md border border-[#cc0000]/10">
            <div className="card-body p-5 text-center">
              <p className="text-3xl mb-1">🍽️</p>
              <h2 className="text-xs tracking-widest uppercase opacity-50" style={{ fontFamily: "Georgia, serif" }}>
                stRED Served
              </h2>
              <p className="text-2xl font-bold text-[#cc0000]">
                {totalSupply ? parseFloat(formatEther(totalSupply)).toLocaleString() : "0"}
              </p>
            </div>
          </div>
          <div className="card bg-base-100 shadow-md border border-[#cc0000]/10">
            <div className="card-body p-5 text-center">
              <p className="text-3xl mb-1">🔥</p>
              <h2 className="text-xs tracking-widest uppercase opacity-50" style={{ fontFamily: "Georgia, serif" }}>
                House Fee
              </h2>
              <p className="text-xl font-bold text-[#cc0000]">0.5% on rewards</p>
              <p className="text-xs opacity-50">50% burn | 25% treasury | 25% stakers</p>
            </div>
          </div>
        </div>
      </div>

      {/* BOTSTER Rewards Card */}
      {isConnected && (
        <div className="card bg-base-100 shadow-md w-full max-w-5xl border border-[#d4a017]/30 bg-gradient-to-r from-base-100 to-[#d4a017]/5">
          <div className="card-body">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">🏆</span>
              <h2 className="text-xs tracking-[0.3em] uppercase opacity-50" style={{ fontFamily: "Georgia, serif" }}>
                BOTSTER Rewards
              </h2>
              {currentEpoch !== undefined && (
                <span className="badge badge-sm bg-[#d4a017]/20 text-[#d4a017] border-[#d4a017]/30">
                  Epoch {currentEpoch.toString()}
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
              <div className="text-center">
                <p className="text-xs tracking-widest uppercase opacity-50">BOTSTER Balance</p>
                <p className="text-2xl font-bold text-[#d4a017]">
                  {parseFloat(userBotsterBal).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs tracking-widest uppercase opacity-50">Claimable</p>
                <p className="text-2xl font-bold text-[#2d8f3c]">
                  {parseFloat(userBotsterClaimable).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </p>
              </div>
              <div className="text-center">
                <button
                  className="btn bg-[#d4a017] hover:bg-[#b8900f] text-white border-none w-full"
                  onClick={handleClaim}
                  disabled={isClaiming || !botsterClaimable || botsterClaimable === 0n}
                >
                  {isClaiming ? (
                    <>
                      <span className="loading loading-spinner loading-sm" /> Claiming...
                    </>
                  ) : (
                    "Claim BOTSTER"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Your Tab */}
      {isConnected && (
        <div className="card bg-base-100 shadow-md w-full max-w-5xl border border-[#cc0000]/10">
          <div className="card-body">
            <h2 className="text-xs tracking-[0.3em] uppercase opacity-50 mb-3" style={{ fontFamily: "Georgia, serif" }}>
              Your Tab
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <p className="text-xs tracking-widest uppercase opacity-50">RED Balance</p>
                <p className="text-xl font-bold">{parseFloat(userRedBal).toLocaleString()}</p>
                {userRedBalUsd && <p className="text-xs opacity-50">{userRedBalUsd}</p>}
              </div>
              <div className="text-center">
                <p className="text-xs tracking-widest uppercase opacity-50">stRED Balance</p>
                <p className="text-xl font-bold">{parseFloat(userShares).toLocaleString()}</p>
              </div>
              <div className="text-center">
                <p className="text-xs tracking-widest uppercase opacity-50">Underlying RED</p>
                <p className="text-xl font-bold">{parseFloat(userUnderlying).toLocaleString()}</p>
                {userUnderlyingUsd && <p className="text-xs opacity-50">{userUnderlyingUsd}</p>}
              </div>
              <div className="text-center">
                <p className="text-xs tracking-widest uppercase opacity-50">Status</p>
                {isLocked ? (
                  <p className="text-lg font-bold text-[#d4a017]">
                    Marinating until {new Date(lockExpiry * 1000).toLocaleDateString()}
                  </p>
                ) : (
                  <p className="text-lg font-bold text-[#2d8f3c]">Ready to Serve</p>
                )}
                <p className="text-xs opacity-50">Tier: {LOCK_TIERS[lockTier]?.tag || "None"}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Menu — Deposit / Withdraw */}
      <div className="w-full max-w-5xl">
        <h2
          className="text-center text-xs tracking-[0.3em] uppercase opacity-50 mb-3"
          style={{ fontFamily: "Georgia, serif" }}
        >
          The Menu
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Deposit */}
          <div className="card bg-base-100 shadow-md border border-[#cc0000]/10">
            <div className="card-body">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">🦞</span>
                <h2 className="card-title text-[#cc0000]" style={{ fontFamily: "Georgia, serif" }}>
                  Deposit RED
                </h2>
              </div>
              <p className="text-xs opacity-50 mt-0 mb-3">Stake your RED and let us do the cooking.</p>
              <div className="form-control">
                <label className="label">
                  <span className="label-text text-xs tracking-widest uppercase opacity-60">Amount</span>
                </label>
                <input
                  type="number"
                  placeholder="0.0"
                  className="input input-bordered w-full bg-base-200 focus:border-[#cc0000]"
                  value={depositAmount}
                  onChange={e => setDepositAmount(e.target.value)}
                  disabled={isDepositing || isApproving}
                />
                {depositAmount && redPrice > 0 && (
                  <p className="text-xs opacity-50 mt-1">
                    ≈ ${(parseFloat(depositAmount || "0") * redPrice).toFixed(2)} USD
                  </p>
                )}
              </div>
              <div className="form-control mt-3">
                <label className="label">
                  <span className="label-text text-xs tracking-widest uppercase opacity-60">Marination Period</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {LOCK_TIERS.map(t => (
                    <button
                      key={t.value}
                      onClick={() => setSelectedTier(t.value)}
                      className={`p-3 rounded-lg border-2 text-left transition-all ${
                        selectedTier === t.value
                          ? "border-[#cc0000] bg-[#cc0000]/5"
                          : "border-base-300 hover:border-[#cc0000]/30"
                      }`}
                    >
                      <div className="flex items-center gap-1">
                        <span>{t.emoji}</span>
                        <span className="font-bold text-sm">{t.tag}</span>
                      </div>
                      <p className="text-xs opacity-60 mt-1 mb-0">
                        {t.label} {t.value > 0 ? `lock` : ""}
                      </p>
                      <p className="text-xs opacity-40 mb-0">{t.description}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div className="card-actions mt-4">{renderDepositButton()}</div>
            </div>
          </div>

          {/* Withdraw */}
          <div className="card bg-base-100 shadow-md border border-[#cc0000]/10">
            <div className="card-body">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">🧾</span>
                <h2 className="card-title text-[#8b0000]" style={{ fontFamily: "Georgia, serif" }}>
                  Withdraw RED
                </h2>
              </div>
              <p className="text-xs opacity-50 mt-0 mb-3">Leaving so soon? Take your RED to go.</p>
              <div className="form-control">
                <label className="label">
                  <span className="label-text text-xs tracking-widest uppercase opacity-60">stRED Shares</span>
                </label>
                <input
                  type="number"
                  placeholder="0.0"
                  className="input input-bordered w-full bg-base-200 focus:border-[#8b0000]"
                  value={withdrawAmount}
                  onChange={e => setWithdrawAmount(e.target.value)}
                  disabled={isWithdrawing}
                />
                {withdrawAmount && (
                  <p className="text-xs opacity-50 mt-1">
                    ≈ {withdrawAmount} RED{" "}
                    {redPrice > 0 && `(~$${(parseFloat(withdrawAmount || "0") * redPrice).toFixed(2)})`}
                  </p>
                )}
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  className="btn btn-sm bg-[#cc0000]/10 text-[#cc0000] border-[#cc0000]/20 hover:bg-[#cc0000]/20"
                  onClick={() => setWithdrawAmount(userShares)}
                >
                  All of it
                </button>
              </div>
              <div className="card-actions mt-4">{renderWithdrawButton()}</div>

              {/* Compound section below withdraw */}
              <div className="divider text-xs opacity-30">OR</div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🔄</span>
                    <h3 className="font-bold text-sm" style={{ fontFamily: "Georgia, serif" }}>
                      Auto-Compound
                    </h3>
                  </div>
                  <p className="text-xs opacity-50 mt-1 mb-0">Ring the dinner bell to harvest and reinvest rewards</p>
                </div>
                <button
                  className="btn bg-[#d4a017] hover:bg-[#b8900f] text-white border-none btn-sm"
                  onClick={handleCompound}
                  disabled={isCompounding}
                >
                  {isCompounding ? (
                    <>
                      <span className="loading loading-spinner loading-xs" /> Cooking...
                    </>
                  ) : (
                    "Compound"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Contract Info */}
      {vaultAddress && (
        <div className="text-center mt-2 text-xs opacity-40">
          <p className="mb-1">Vault:</p>
          <Address address={vaultAddress} />
          <p className="mt-2 mb-1">RED Token:</p>
          <Address address={RED_TOKEN} />
          <p className="mt-2 mb-1">BOTSTER Token:</p>
          <Address address="0x3187862bdd73d84f11190c4ba9909597c5faad98" />
          <p className="mt-2 mb-1">BOTSTER Rewards:</p>
          <Address address="0x74331ad21816954ad61563e30daf5645d8d96a5d" />
        </div>
      )}
    </div>
  );
};

export default Home;
