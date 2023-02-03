/*
  SMARTy Pay Subscriptions Client SDK
  @author Evgeny Dolganov <evgenij.dolganov@gmail.com>
*/
import {TokenMaxAbsoluteAmount, wallet, Web3ApiProvider, Web3Common,} from 'smartypay-client-web3-common';
import {Assets, CurrencyKeys, Subscription, SubscriptionStatus, util,} from 'smartypay-client-model';
import {findApiByContactAddress} from './util';
import {getJsonFetcher, postJsonFetcher} from './util/fetch-util';


export type SmartyPaySubscriptionsBrowserEvent =
  wallet.WalletApiEvent
  | 'subscription-updating';


export interface SmartyPaySubscriptionsBrowserProp {
  smartyApiUrl?: string
}


class SmartyPaySubscriptionsBrowserImpl extends wallet.WalletApi<SmartyPaySubscriptionsBrowserEvent> {

  private props: SmartyPaySubscriptionsBrowserProp|undefined;
  private updatingSubscriptions = new Set<string>();

  constructor(props?: SmartyPaySubscriptionsBrowserProp) {
    super('SmartyPaySubscriptionsBrowser');
    this.setApiProps(props);
  }

  setApiProps(props: SmartyPaySubscriptionsBrowserProp|undefined){
    this.props = props;
  }

  addListener(event: SmartyPaySubscriptionsBrowserEvent, listener: util.EventListener){
    super.addListener(event as any, listener);
  }

  getUpdatingSubscriptions(): string[]{
    return Array.from(this.updatingSubscriptions);
  }

  async activateSubscriptionInWallet(subscriptionGetter: ()=>Promise<Subscription>){
    await this.useApiLock('activateSubscription', async ()=>{

      const wallet = this.getActiveWallet();
      const address = await wallet.getAddress();
      const subscription = await subscriptionGetter();

      if(!subscription){
        throw util.makeError('Undefined subscription to activate');
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
        throw util.makeError('Can not activate subscription: unknown amount currency', amountVal);
      }

      const token = Assets[currency];
      const amountToPay = Web3Common.toAbsoluteForm(amount, token);

      const curBalanceVal = await Web3Common.getTokenBalance(token, address);
      const curBalance = Web3Common.toAbsoluteForm(curBalanceVal, token);
      if(amountToPay.gt(curBalance)){
        throw util.makeError(`Not enough ${token.abbr} token funds to activate the subscription`);
      }

      // take approval from wallet to spend a token by subscription contract
      let approveTx: string;
      try {
        approveTx = await Web3Common.walletTokenApprove(
          wallet,
          token,
          address,
          contractAddress,
          TokenMaxAbsoluteAmount
        );
        this.fireEvent('blockchain-transaction', 'token-approve-tx', approveTx);
      } catch (e){
        // skip long error info
        throw util.makeError(this.name, 'Can not approve token amount.');
      }

      // direct api notification
      const apiUrl = await this.getCheckStatusUrl(contractAddress);
      const {isAccepted} = await postJsonFetcher(`${apiUrl}/integration/subscriptions/hint-update-state`, {
        hash: approveTx,
        blockchain: token.network
      });

      if( ! isAccepted){
        throw util.makeError(this.name, 'Can not notify SmartyPay server about subscription');
      }

      // async check subscription status update
      this.waitSubscriptionStatusUpdate(contractAddress, status, 'Active').catch(console.error);
    })
  }

  private async waitSubscriptionStatusUpdate(
    contractAddress: string,
    initStatus: SubscriptionStatus,
    targetStatus?: SubscriptionStatus){

    // already in set
    if(this.updatingSubscriptions.has(contractAddress)){
      return;
    }

    const apiUrl = await this.getCheckStatusUrl(contractAddress);
    const waitNextTryDelta = 8000;
    const stopWaitTimeout = Date.now() + waitNextTryDelta * 5;

    this.updatingSubscriptions.add(contractAddress);
    this.fireEvent('subscription-updating', contractAddress, true);

    const onDone = ()=>{
      this.updatingSubscriptions.delete(contractAddress);
      this.fireEvent('subscription-updating', contractAddress, false);
    }

    while(Date.now() <= stopWaitTimeout){

      // wait delta
      await util.waitTimeout(waitNextTryDelta);

      // check status
      const {status} = await getJsonFetcher(`${apiUrl}/integration/subscriptions/${contractAddress}/status`);
      if(status !== initStatus && (!targetStatus || targetStatus === status)){
        onDone();
        return;
      }
    }

    // timeout
    onDone();
  }

  private async getCheckStatusUrl(contractAddress: string): Promise<string>{

    if(this.props?.smartyApiUrl){
      return this.props.smartyApiUrl;
    }

    const apiUrl = await findApiByContactAddress(contractAddress);
    if(!apiUrl){
      throw util.makeError(this.name, 'Can not find SmartyPay api url');
    }
    return apiUrl;
  }
}



/**
 * Subscriptions browser sdk single instance
 */
export const SmartyPaySubscriptionsBrowser = new SmartyPaySubscriptionsBrowserImpl();

export async function restoreOldWalletConnectionFromAny(...providers: Web3ApiProvider[]): Promise<boolean>{
  return wallet.restoreOldWalletConnectionFromAny(SmartyPaySubscriptionsBrowser, ...providers);
}