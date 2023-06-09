import request from 'graphql-request';
import fetchMarketState from './fetchMarketState';
import { totalAssets, totalFloatingBorrowAssets } from './shareValueProportion';
import { MarketState } from './types';

const totalFixedDepositAssets = ({ fixedPools }: MarketState) => (
  fixedPools?.reduce((acc, { supplied }) => acc + supplied, 0n) ?? 0n);

const totalFixedBorrowAssets = ({ fixedPools }: MarketState) => (
  fixedPools?.reduce((acc, { borrowed }) => acc + borrowed, 0n) ?? 0n);

export default async (subgraph: string) => {
  const now = Math.floor(Date.now() / 1000);

  const { markets } = await request<{ markets: { id: string }[] }>(
    subgraph,
    '{markets {id}}',
  );

  const marketStates = await Promise.all(
    markets.map((market) => fetchMarketState(now, market.id, subgraph)),
  );

  return {
    totalBorrows: Object.fromEntries(
      marketStates.map((ms) => [
        ms.market.id,
        Number(
          totalFloatingBorrowAssets(now, ms) + totalFixedBorrowAssets(ms),
        )
        / 10 ** ms.market.decimals,
      ]),
    ),
    totalDeposits: Object.fromEntries(
      marketStates.map((ms) => [
        ms.market.id,
        Number(
          totalAssets(now, ms) + totalFixedDepositAssets(ms),
        )
        / 10 ** ms.market.decimals,
      ]),
    ),
  };
};