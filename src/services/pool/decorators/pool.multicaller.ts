import {
  InvestmentPool__factory,
  StablePool__factory,
  Vault__factory,
  WeightedPool__factory,
} from '@balancer-labs/typechain';

import {
  isStableLike,
  isSwappingHaltable,
  isWeightedLike,
  isComposableStableLike,
  isComposableStable,
} from '@/composables/usePool';
import ERC20_ABI from '@/lib/abi/ERC20.json';
import IERC4626 from '@/lib/abi/IERC4626.json';
import LinearPoolABI from '@/lib/abi/LinearPool.json';
import StablePhantomPoolABI from '@/lib/abi/StablePhantomPool.json';
import StaticATokenLMABI from '@/lib/abi/StaticATokenLM.json';
import { configService } from '@/services/config/config.service';
import { Multicaller } from '@/services/multicalls/multicaller';

import { Pool, RawOnchainPoolDataMap } from '../types';

const PoolTypeABIs = Object.values(
  Object.fromEntries(
    [
      ...WeightedPool__factory.abi,
      ...StablePool__factory.abi,
      ...InvestmentPool__factory.abi,
      ...StablePhantomPoolABI,
      ...LinearPoolABI,
      ...StaticATokenLMABI,
      ...ERC20_ABI,
      ...IERC4626,
    ].map(row => [row.name, row])
  )
);

export class PoolMulticaller {
  constructor(
    public readonly pools: Pool[],
    private readonly MulticallerClass = Multicaller,
    private readonly vaultAddress = configService.network.addresses.vault
  ) {}

  public async fetch(): Promise<RawOnchainPoolDataMap> {
    let result = <RawOnchainPoolDataMap>{};
    const multicaller = new this.MulticallerClass();

    this.pools.forEach(pool => {
      multicaller
        .call({
          key: `${pool.id}.totalSupply`,
          address: pool.address,
          function: 'totalSupply',
          abi: PoolTypeABIs,
        })
        .call({
          key: `${pool.id}.decimals`,
          address: pool.address,
          function: 'decimals',
          abi: PoolTypeABIs,
        })
        .call({
          key: `${pool.id}.swapFee`,
          address: pool.address,
          function: 'getSwapFeePercentage',
          abi: PoolTypeABIs,
        });

      if (isWeightedLike(pool.poolType)) {
        multicaller.call({
          key: `${pool.id}.weights`,
          address: pool.address,
          function: 'getNormalizedWeights',
          abi: PoolTypeABIs,
        });

        if (isSwappingHaltable(pool.poolType)) {
          multicaller.call({
            key: `${pool.id}.swapEnabled`,
            address: pool.address,
            function: 'getSwapEnabled',
            abi: PoolTypeABIs,
          });
        }
      } else if (isStableLike(pool.poolType)) {
        multicaller.call({
          key: `${pool.id}.amp`,
          address: pool.address,
          function: 'getAmplificationParameter',
          abi: PoolTypeABIs,
        });

        if (isComposableStableLike(pool.poolType)) {
          // Overwrite totalSupply with virtualSupply for StablePhantom pools
          multicaller.call({
            key: `${pool.id}.totalSupply`,
            address: pool.address,
            function: 'getVirtualSupply',
            abi: PoolTypeABIs,
          });
          if (isComposableStable(pool.poolType)) {
            multicaller.call({
              key: `${pool.id}.totalSupply`,
              address: pool.address,
              function: 'getActualSupply',
              abi: PoolTypeABIs,
            });
          }
        }
      }
    });

    result = await multicaller.execute();

    this.pools.forEach(pool => {
      multicaller.call({
        key: `${pool.id}.poolTokens`,
        address: this.vaultAddress,
        function: 'getPoolTokens',
        abi: Vault__factory.abi,
        params: [pool.id],
      });
    });

    return await multicaller.execute(result);
  }
}
