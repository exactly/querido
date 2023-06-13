import { WAD } from './FixedPointMathLib';
import accountsWorth from './accountsWorth';
import fetchAccounts from './fetchAccounts';
import rewardsAPR from './rewardsAPR';
import { Asset } from './types';

type FixedPosition = {
  principal: bigint
  fee: bigint
  borrow: boolean
  maturity: number
  rate: bigint
};

const fixedRewardsAPRWeighted = (
  positions: FixedPosition[],
  timestamp: number,
  borrowRewardAPR: bigint,
) => (
  positions?.reduce(
    (acc, {
      principal, borrow, maturity,
    }) => (maturity >= timestamp && borrow
      ? acc + principal * borrowRewardAPR
      : 0n),
    0n,
  ) ?? 0n);

export default async (
  address: string,
  subgraph: string,
  assets: Record<string, Asset>,
) => {
  const accounts = await fetchAccounts(subgraph, address);
  const timestamp = Math.floor(Date.now() / 1_000);

  const totalWeightedAPR = await accounts.reduce(async (
    total,
    account,
  ) => {
    const {
      depositShares,
      borrowShares,
      fixedPositions,
      market,
    } = account;

    const {
      borrow: borrowRewardAPR,
      deposit: depositRewardAPR,
    } = await rewardsAPR(timestamp, subgraph, market.id, assets);

    const { asset, decimals } = market;
    const { price, decimals: assetDecimals } = assets[asset];
    if (!price) throw new Error(`missing price for ${asset}`);

    const floatingWeightedAPR = depositRewardAPR * depositShares
      + borrowRewardAPR * borrowShares;

    const weightedAPR = (
      (floatingWeightedAPR + fixedRewardsAPRWeighted(fixedPositions, timestamp, depositRewardAPR))
      * ((price * WAD) / BigInt(10 ** assetDecimals)))
      / (BigInt(10 ** decimals));

    return (await total) + weightedAPR;
  }, Promise.resolve(0n));

  const total = accountsWorth(accounts, timestamp, assets);

  if (total === 0n) return 0n;

  return Number((totalWeightedAPR * WAD) / total) / 1e18;
};
