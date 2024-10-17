import { parseUnits, zeroAddress } from "viem";
import { describe, expect, inject, it } from "vitest";

import { previewerAbi } from "./generated/contracts.js";
import anvilClient from "./utils/anvilClient.js";
import accountLiquidity, { normalizeCollateral, normalizeDebt } from "../src/auditor/accountLiquidity.js";
import borrowLimit from "../src/auditor/borrowLimit.js";
import healthFactor from "../src/auditor/healthFactor.js";
import withdrawLimit from "../src/auditor/withdrawLimit.js";
import divWad from "../src/fixed-point-math/divWad.js";
import divWadUp from "../src/fixed-point-math/divWadUp.js";
import min from "../src/fixed-point-math/min.js";
import mulDiv from "../src/fixed-point-math/mulDiv.js";
import mulWad from "../src/fixed-point-math/mulWad.js";
import { MATURITY_INTERVAL } from "../src/interest-rate-model/fixedRate.js";

describe("with static data", () => {
  const exactly = [
    {
      market: "0x6926B434CCe9b5b7966aE1BfEef6D0A7DCF3A8bb",
      decimals: 6,
      usdPrice: parseUnits("1", 18),
      adjustFactor: parseUnits("0.91", 18),
      isCollateral: true,
      floatingBorrowAssets: parseUnits("1000", 6),
      floatingDepositAssets: parseUnits("10000", 6),
      fixedBorrowPositions: [
        {
          maturity: BigInt(MATURITY_INTERVAL),
          position: { principal: parseUnits("990", 6), fee: parseUnits("10", 6) },
        },
      ],
      penaltyRate: parseUnits("0.000000052083333333", 18),
    },
    {
      market: "0xc4d4500326981eacD020e20A81b1c479c161c7EF",
      decimals: 18,
      usdPrice: parseUnits("2500", 18),
      adjustFactor: parseUnits("0.86", 18),
      isCollateral: true,
      floatingBorrowAssets: parseUnits("1", 18),
      floatingDepositAssets: parseUnits("1", 18),
      fixedBorrowPositions: [
        {
          maturity: BigInt(MATURITY_INTERVAL),
          position: { principal: parseUnits("0.9", 18), fee: parseUnits("0.1", 18) },
        },
      ],
      penaltyRate: parseUnits("0.000000052083333333", 18),
    },
  ] as const;

  function exactlyAccountLiquidity(): { collateral: bigint; debt: bigint } {
    const usdcBaseUnit = 10n ** 6n;
    return {
      collateral:
        mulDiv(parseUnits("10000", 6), parseUnits("0.91", 18), usdcBaseUnit) +
        mulDiv(mulWad(parseUnits("1", 18), parseUnits("2500", 18)), parseUnits("0.86", 18), 10n ** 18n),
      debt:
        divWadUp(parseUnits("2000", 18), parseUnits("0.91", 18)) +
        divWadUp(parseUnits("5000", 18), parseUnits("0.86", 18)),
    };
  }

  it("account liquidity", () => {
    const { collateral, debt } = exactlyAccountLiquidity();
    const { adjCollateral, adjDebt } = accountLiquidity(exactly, 0);

    expect(adjCollateral).toBe(collateral);
    expect(adjDebt).toBe(debt);
  });

  it("health factor", () => {
    const { collateral, debt } = exactlyAccountLiquidity();

    expect(healthFactor(exactly, 0)).toBe(divWad(collateral, debt));
  });

  it("withdraw limit", () => {
    const { collateral, debt } = exactlyAccountLiquidity();
    const targetHF = BigInt(1.1 * 10 ** 18);
    const minCollateral = mulWad(debt, targetHF);
    const limit = min(collateral - minCollateral, collateral);
    const normalizedLimit = normalizeCollateral(
      limit,
      exactly[0].usdPrice,
      10n ** BigInt(exactly[0].decimals),
      exactly[0].adjustFactor,
    );

    expect(normalizedLimit).toBe(withdrawLimit(exactly, exactly[0].market, 0, targetHF));

    const withdrawable = withdrawLimit(exactly, exactly[0].market, 0, targetHF);

    const exaWithdrawn = [
      {
        ...exactly[0],
        floatingDepositAssets: exactly[0].floatingDepositAssets - withdrawable,
      },
      ...exactly.slice(1),
    ];

    expect(healthFactor(exaWithdrawn, 0)).toBeGreaterThanOrEqual(targetHF);

    const impossibleHF = healthFactor(exactly, 0) + 1n;

    expect(withdrawLimit(exactly, exactly[0].market, 0, impossibleHF)).toBe(0n);
  });

  it("borrow limit", () => {
    const { collateral, debt } = exactlyAccountLiquidity();
    const targetHF = BigInt(1.1 * 10 ** 18);
    const maxDebt = divWad(collateral, targetHF);
    const maxNewDebt = maxDebt - debt;

    const bLimit = borrowLimit(exactly, exactly[0].market, 0, targetHF);

    expect(
      normalizeDebt(maxNewDebt, exactly[0].usdPrice, 10n ** BigInt(exactly[0].decimals), exactly[0].adjustFactor),
    ).toBe(borrowLimit(exactly, exactly[0].market, 0, targetHF));

    const exaBorrowed = [
      {
        ...exactly[0],
        floatingBorrowAssets: exactly[0].floatingBorrowAssets + bLimit,
      },
      ...exactly.slice(1),
    ];

    expect(healthFactor(exaBorrowed, 0)).toBeGreaterThanOrEqual(targetHF);

    const exaBorrowedTooMuch = [
      {
        ...exactly[0],
        floatingBorrowAssets: exactly[0].floatingBorrowAssets + bLimit + 1n,
      },
      ...exactly.slice(1),
    ];

    expect(healthFactor(exaBorrowedTooMuch, 0)).toBeLessThan(targetHF);
  });
});

describe("with previewer data", async () => {
  const exactly = await anvilClient.readContract({
    address: inject("Previewer"),
    functionName: "exactly",
    args: [zeroAddress],
    abi: previewerAbi,
  });

  it("account liquidity", () => {
    accountLiquidity(exactly, 0);
  });

  it("health factor", () => {
    healthFactor(exactly, 0);
  });

  it("withdraw limit", () => {
    withdrawLimit(exactly, inject("MarketUSDC"), 0);
  });
});
