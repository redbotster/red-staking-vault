"use client";

import { useEffect, useState } from "react";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { formatEther, parseEther } from "viem";
import { base } from "viem/chains";
import { useAccount, useSwitchChain } from "wagmi";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth/RainbowKitCustomConnectButton";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";

const LOCK_TIERS = [
  { value: 0, label: "No Lock", description: "No fee discount, 1x yield" },
  { value: 1, label: "90 Days", description: "10% fee discount, 1.05x yield" },
  { value: 2, label: "180 Days", description: "25% fee discount, 1.15x yield" },
  { value: 3, label: "365 Days", description: "50% fee discount, 1.3x yield" },
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
  const [redPrice, setRedPrice] = useState<number>(0);

  // Target chain - Base for production, foundry for dev
  const targetChainId = chain?.id === 31337 ? 31337 : base.id;
  const wrongNetwork = isConnected && chain?.id !== targetChainId;

  // Fetch RED price from DexScreener
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

  // Read vault data
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

  // Read RED allowance for vault
  const { data: redAllowance } = useScaffoldReadContract({
    contractName: "REDToken",
    functionName: "allowance",
    args: [address, vaultAddress],
    watch: true,
  });

  // Read RED balance
  const { data: redBalance } = useScaffoldReadContract({
    contractName: "REDToken",
    functionName: "balanceOf",
    args: [address],
    watch: true,
  });

  // Write contracts
  const { writeContractAsync: vaultWrite } = useScaffoldWriteContract("REDVault");
  const { writeContractAsync: tokenWrite } = useScaffoldWriteContract("REDToken");

  const depositAmountWei = depositAmount ? parseEther(depositAmount) : 0n;
  const needsApproval = !redAllowance || redAllowance < depositAmountWei;

  const handleApprove = async () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0 || !vaultAddress) return;
    setIsApproving(true);
    try {
      // Approve 3x the amount for convenience
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

  const handleDeposit = async () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0) return;
    setIsDepositing(true);
    try {
      await vaultWrite({
        functionName: "deposit",
        args: [parseEther(depositAmount), selectedTier],
      });
      setDepositAmount("");
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

  const tvl = totalAssets ? formatEther(totalAssets) : "0";
  const tvlUsd = redPrice > 0 ? `~$${(parseFloat(tvl) * redPrice).toFixed(2)}` : "";
  const userShares = stRedBalance ? formatEther(stRedBalance) : "0";
  const userUnderlying = underlyingBal ? formatEther(underlyingBal) : "0";
  const userUnderlyingUsd = redPrice > 0 ? `~$${(parseFloat(userUnderlying) * redPrice).toFixed(2)}` : "";
  const userRedBal = redBalance ? formatEther(redBalance) : "0";
  const userRedBalUsd = redPrice > 0 ? `~$${(parseFloat(userRedBal) * redPrice).toFixed(2)}` : "";

  const lockExpiry = userDeposit ? Number(userDeposit[1]) : 0;
  const lockTier = userDeposit ? Number(userDeposit[2]) : 0;
  const isLocked = lockExpiry > Math.floor(Date.now() / 1000);

  // Four-state deposit button
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
        <button className="btn btn-primary w-full" onClick={handleApprove} disabled={isApproving || approveCooldown}>
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
        className="btn btn-primary w-full"
        onClick={handleDeposit}
        disabled={isDepositing || !depositAmount || parseFloat(depositAmount) <= 0}
      >
        {isDepositing ? (
          <>
            <span className="loading loading-spinner loading-sm" /> Depositing...
          </>
        ) : (
          "Deposit"
        )}
      </button>
    );
  };

  // Four-state withdraw button
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
        className="btn btn-secondary w-full"
        onClick={handleWithdraw}
        disabled={isWithdrawing || !withdrawAmount || parseFloat(withdrawAmount) <= 0 || isLocked}
      >
        {isWithdrawing ? (
          <>
            <span className="loading loading-spinner loading-sm" /> Withdrawing...
          </>
        ) : isLocked ? (
          "Locked"
        ) : (
          "Withdraw"
        )}
      </button>
    );
  };

  return (
    <div className="flex flex-col items-center gap-6 p-4 md:p-8 bg-base-200 min-h-screen">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-4xl">
        <div className="card bg-base-100 shadow-md">
          <div className="card-body p-4">
            <h2 className="card-title text-sm opacity-70">Total Value Locked</h2>
            <p className="text-2xl font-bold">{parseFloat(tvl).toLocaleString()} RED</p>
            {tvlUsd && <p className="text-sm opacity-60">{tvlUsd}</p>}
          </div>
        </div>
        <div className="card bg-base-100 shadow-md">
          <div className="card-body p-4">
            <h2 className="card-title text-sm opacity-70">Total stRED Supply</h2>
            <p className="text-2xl font-bold">
              {totalSupply ? parseFloat(formatEther(totalSupply)).toLocaleString() : "0"}
            </p>
          </div>
        </div>
        <div className="card bg-base-100 shadow-md">
          <div className="card-body p-4">
            <h2 className="card-title text-sm opacity-70">Fee Structure</h2>
            <p className="text-lg font-bold">0.5% on rewards</p>
            <p className="text-xs opacity-60">50% burn · 25% treasury · 25% stakers</p>
          </div>
        </div>
      </div>

      {/* Your Position */}
      {isConnected && (
        <div className="card bg-base-100 shadow-md w-full max-w-4xl">
          <div className="card-body">
            <h2 className="card-title">Your Position</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm opacity-70">RED Balance</p>
                <p className="text-xl font-bold">{parseFloat(userRedBal).toLocaleString()}</p>
                {userRedBalUsd && <p className="text-sm opacity-60">{userRedBalUsd}</p>}
              </div>
              <div>
                <p className="text-sm opacity-70">stRED Balance</p>
                <p className="text-xl font-bold">{parseFloat(userShares).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-sm opacity-70">Underlying RED</p>
                <p className="text-xl font-bold">{parseFloat(userUnderlying).toLocaleString()}</p>
                {userUnderlyingUsd && <p className="text-sm opacity-60">{userUnderlyingUsd}</p>}
              </div>
              <div>
                <p className="text-sm opacity-70">Lock Status</p>
                {isLocked ? (
                  <p className="text-lg font-bold text-warning">
                    Locked until {new Date(lockExpiry * 1000).toLocaleDateString()}
                  </p>
                ) : (
                  <p className="text-lg font-bold text-success">Unlocked</p>
                )}
                <p className="text-xs opacity-60">Tier: {LOCK_TIERS[lockTier]?.label || "None"}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Deposit / Withdraw */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-4xl">
        {/* Deposit */}
        <div className="card bg-base-100 shadow-md">
          <div className="card-body">
            <h2 className="card-title">Deposit RED</h2>
            <div className="form-control">
              <label className="label">
                <span className="label-text">Amount</span>
              </label>
              <input
                type="number"
                placeholder="0.0"
                className="input input-bordered w-full"
                value={depositAmount}
                onChange={e => setDepositAmount(e.target.value)}
                disabled={isDepositing || isApproving}
              />
              {depositAmount && redPrice > 0 && (
                <p className="text-sm opacity-60 mt-1">
                  ≈ ${(parseFloat(depositAmount || "0") * redPrice).toFixed(2)} USD
                </p>
              )}
            </div>
            <div className="form-control mt-2">
              <label className="label">
                <span className="label-text">Lock Tier</span>
              </label>
              <select
                className="select select-bordered w-full"
                value={selectedTier}
                onChange={e => setSelectedTier(Number(e.target.value))}
              >
                {LOCK_TIERS.map(t => (
                  <option key={t.value} value={t.value}>
                    {t.label} — {t.description}
                  </option>
                ))}
              </select>
            </div>
            <div className="card-actions mt-4">{renderDepositButton()}</div>
          </div>
        </div>

        {/* Withdraw */}
        <div className="card bg-base-100 shadow-md">
          <div className="card-body">
            <h2 className="card-title">Withdraw RED</h2>
            <div className="form-control">
              <label className="label">
                <span className="label-text">stRED Shares</span>
              </label>
              <input
                type="number"
                placeholder="0.0"
                className="input input-bordered w-full"
                value={withdrawAmount}
                onChange={e => setWithdrawAmount(e.target.value)}
                disabled={isWithdrawing}
              />
              {withdrawAmount && (
                <p className="text-sm opacity-60 mt-1">
                  ≈ {withdrawAmount} RED{" "}
                  {redPrice > 0 && `(~$${(parseFloat(withdrawAmount || "0") * redPrice).toFixed(2)})`}
                </p>
              )}
            </div>
            <div className="flex gap-2 mt-2">
              <button className="btn btn-xs btn-outline" onClick={() => setWithdrawAmount(userShares)}>
                Max
              </button>
            </div>
            <div className="card-actions mt-4">{renderWithdrawButton()}</div>
          </div>
        </div>
      </div>

      {/* Compound Button */}
      <div className="card bg-base-100 shadow-md w-full max-w-4xl">
        <div className="card-body flex-row items-center justify-between">
          <div>
            <h2 className="card-title">Auto-Compound</h2>
            <p className="text-sm opacity-60">Anyone can trigger compounding to harvest and reinvest rewards</p>
          </div>
          <button className="btn btn-accent" onClick={handleCompound} disabled={isCompounding}>
            {isCompounding ? (
              <>
                <span className="loading loading-spinner loading-sm" /> Compounding...
              </>
            ) : (
              "Compound"
            )}
          </button>
        </div>
      </div>

      {/* Contract Info */}
      {vaultAddress && (
        <div className="text-center mt-4 text-sm opacity-70">
          <p>Vault Contract:</p>
          <Address address={vaultAddress} />
          <p className="mt-2">RED Token:</p>
          <Address address={RED_TOKEN} />
        </div>
      )}
    </div>
  );
};

export default Home;
