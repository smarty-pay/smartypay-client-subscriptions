/*
  SMARTy Pay Subscriptions Client SDK
  @author Evgeny Dolganov <evgenij.dolganov@gmail.com>
*/
import {TokenMaxAbsoluteAmount, wallet, Web3ApiProvider, Web3Common,} from 'smartypay-client-web3-common';
import {Assets, CurrencyKeys, Subscription, util,} from 'smartypay-client-model';


export type SmartyPaySubscriptionsBrowserEvent = wallet.WalletApiEvent;


class SmartyPaySubscriptionsBrowserImpl extends wallet.WalletApi<SmartyPaySubscriptionsBrowserEvent> {

  constructor() {
    super('SmartyPaySubscriptionsBrowser');
  }

  addListener(event: SmartyPaySubscriptionsBrowserEvent, listener: (...args: any[])=>void){
    super.addListener(event as any, listener);
  }

  async activateSubscriptionInWallet(subscriptionGetter: ()=>Promise<Subscription>){
    await this.useApiLock('activateSubscription', async ()=>{

      const wallet = this.getActiveWallet();
      const address = await wallet.getAddress();
      const subscription = await subscriptionGetter();

      if(!subscription){
        throw util.makeError('undefined subscription to activate');
      }

      const {
        status,
        amount: amountVal,
        contractAddress
      } = subscription;

      // subscription already activated
      if(status !== 'Draft'){
        return;
      }

      const [amount, asset] = amountVal.split(' ');
      const currency = CurrencyKeys.find(c => c === asset);
      if( ! currency || currency === 'UNKNOWN'){
        throw util.makeError('can not activate subscription: unknown amount currency', amountVal);
      }

      const token = Assets[currency];
      const amountToPay = Web3Common.toAbsoluteForm(amount, token);

      const curBalanceVal = await Web3Common.getTokenBalance(token, address);
      const curBalance = Web3Common.toAbsoluteForm(curBalanceVal, token);
      if(amountToPay.gt(curBalance)){
        throw util.makeError(`Not enough ${token.abbr} token funds to activate the subscription`);
      }

      const curAllowanceVal = await Web3Common.getTokenAllowance(token, address, contractAddress);
      const curAllowance = Web3Common.toAbsoluteForm(curAllowanceVal, token);

      // take approval from wallet to spend a token by subscription contract
      if(amountToPay.gt(curAllowance)){

        try {
          const resultTx = await Web3Common.walletTokenApprove(
            wallet,
            token,
            address,
            contractAddress,
            TokenMaxAbsoluteAmount
          );

          console.log('!! walletTokenApprove result tx', resultTx)
        } catch (e){
          // skip long error info
          throw new Error('Can not approve token amount.');
        }
      }

      // todo call hint activation
      console.log('!! activateSubscriptionInWallet success done')

    })
  }
}



/**
 * Subscriptions browser sdk single instance
 */
export const SmartyPaySubscriptionsBrowser = new SmartyPaySubscriptionsBrowserImpl();

export async function restoreOldWalletConnectionFromAny(...providers: Web3ApiProvider[]): Promise<boolean>{
  return wallet.restoreOldWalletConnectionFromAny(SmartyPaySubscriptionsBrowser, ...providers);
}