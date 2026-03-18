"use client";

import { useEffect, useState } from "react";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { formatEther, parseEther } from "viem";
import { useAccount } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";

const LOCK_TIERS = [
  { value: 0, label: "No Lock", description: "No fee discount, 1x yield" },
  { value: 1, label: "90 Days", description: "10% fee discount, 1.05x yield" },
  { value: 2, label: "180 Days", description: "25% fee discount, 1.15x yield" },
  { value: 3, label: "365 Days", description: "50% fee discount, 1.3x yield" },
] as const;

const CLAWD_TOKEN = "0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07";

const Home: NextPage = () => {
  const { address, isConnected } = useAccount();

  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [selectedTier, setSelectedTier] = useState(0);
  const [isDepositing, setIsDepositing] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [isCompounding, setIsCompounding] = useState(false);
  const [clawdPrice, setClawdPrice] = useState<number>(0);

  // Fetch CLAWD price from DexScreener
  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${CLAWD_TOKEN}`);
        const data = await res.json();
        if (data.pairs?.[0]?.priceUsd) {
          setClawdPrice(parseFloat(data.pairs[0].priceUsd));
        }
      } catch {}
    };
    fetchPrice();
    const interval = setInterval(fetchPrice, 30000);
    return () => clearInterval(interval);
  }, []);

  const { data: vaultInfo } = useDeployedContractInfo("CLAWDVault");
  const vaultAddress = vaultInfo?.address;

  // Read vault data
  const { data: totalAssets } = useScaffoldReadContract({
    contractName: "CLAWDVault",
    functionName: "totalAssets",
    watch: true,
  });

  const { data: userDeposit } = useScaffoldReadContract({
    contractName: "CLAWDVault",
    functionName: "userDeposits",
    args: [address],
    watch: true,
  });

  const { data: stClawdBalance } = useScaffoldReadContract({
    contractName: "CLAWDVault",
    functionName: "balanceOf",
    args: [address],
    watch: true,
  });

  const { data: underlyingBal } = useScaffoldReadContract({
    contractName: "CLAWDVault",
    functionName: "underlyingBalance",
    args: [address],
    watch: true,
  });

  const { data: totalSupply } = useScaffoldReadContract({
    contractName: "CLAWDVault",
    functionName: "totalSupply",
    watch: true,
  });

  // Write contracts
  const { writeContractAsync: vaultWrite } = useScaffoldWriteContract("CLAWDVault");

  const handleDeposit = async () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0) return;
    setIsDepositing(true);
    try {
      await vaultWrite({
        functionName: "deposit",
        args: [parseEther(depositAmount), selectedTier],
      });
      setDepositAmount("");
    } catch (e: any) {
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
    } catch (e: any) {
      console.error("Withdraw failed:", e);
    } finally {
      setIsWithdrawing(false);
    }
  };

  const handleCompound = async () => {
    setIsCompounding(true);
    try {
      await vaultWrite({ functionName: "compound" });
    } catch (e: any) {
      console.error("Compound failed:", e);
    } finally {
      setIsCompounding(false);
    }
  };

  const tvl = totalAssets ? formatEther(totalAssets) : "0";
  const tvlUsd = clawdPrice > 0 ? `~$${(parseFloat(tvl) * clawdPrice).toFixed(2)}` : "";
  const userShares = stClawdBalance ? formatEther(stClawdBalance) : "0";
  const userUnderlying = underlyingBal ? formatEther(underlyingBal) : "0";
  const userUnderlyingUsd = clawdPrice > 0 ? `~$${(parseFloat(userUnderlying) * clawdPrice).toFixed(2)}` : "";

  const lockExpiry = userDeposit ? Number(userDeposit[1]) : 0;
  const lockTier = userDeposit ? Number(userDeposit[2]) : 0;
  const isLocked = lockExpiry > Math.floor(Date.now() / 1000);

  return (
    <div className="flex flex-col items-center gap-6 p-4 md:p-8 bg-base-200 min-h-screen">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-4xl">
        <div className="card bg-base-100 shadow-md">
          <div className="card-body p-4">
            <h2 className="card-title text-sm opacity-70">Total Value Locked</h2>
            <p className="text-2xl font-bold">{parseFloat(tvl).toLocaleString()} CLAWD</p>
            {tvlUsd && <p className="text-sm opacity-60">{tvlUsd}</p>}
          </div>
        </div>
        <div className="card bg-base-100 shadow-md">
          <div className="card-body p-4">
            <h2 className="card-title text-sm opacity-70">Total stCLAWD Supply</h2>
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <p className="text-sm opacity-70">stCLAWD Balance</p>
                <p className="text-xl font-bold">{parseFloat(userShares).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-sm opacity-70">Underlying CLAWD</p>
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
            <h2 className="card-title">Deposit CLAWD</h2>
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
                disabled={isDepositing}
              />
              {depositAmount && clawdPrice > 0 && (
                <p className="text-sm opacity-60 mt-1">
                  ≈ ${(parseFloat(depositAmount || "0") * clawdPrice).toFixed(2)} USD
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
            <div className="card-actions mt-4">
              {!isConnected ? (
                <button className="btn btn-primary w-full" disabled>
                  Connect Wallet
                </button>
              ) : (
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
              )}
            </div>
            <p className="text-xs opacity-50 mt-1">
              Note: You must first approve CLAWD spending on the token contract.
            </p>
          </div>
        </div>

        {/* Withdraw */}
        <div className="card bg-base-100 shadow-md">
          <div className="card-body">
            <h2 className="card-title">Withdraw CLAWD</h2>
            <div className="form-control">
              <label className="label">
                <span className="label-text">stCLAWD Shares</span>
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
                  ≈ {withdrawAmount} CLAWD{" "}
                  {clawdPrice > 0 && `(~$${(parseFloat(withdrawAmount || "0") * clawdPrice).toFixed(2)})`}
                </p>
              )}
            </div>
            <div className="flex gap-2 mt-2">
              <button className="btn btn-xs btn-outline" onClick={() => setWithdrawAmount(userShares)}>
                Max
              </button>
            </div>
            <div className="card-actions mt-4">
              {!isConnected ? (
                <button className="btn btn-secondary w-full" disabled>
                  Connect Wallet
                </button>
              ) : (
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
              )}
            </div>
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
              "🔄 Compound"
            )}
          </button>
        </div>
      </div>

      {/* Contract Info */}
      {vaultAddress && (
        <div className="text-center mt-4 text-sm opacity-70">
          <p>Vault Contract:</p>
          <Address address={vaultAddress} />
          <p className="mt-2">CLAWD Token:</p>
          <Address address={CLAWD_TOKEN} />
        </div>
      )}
    </div>
  );
};

export default Home;
