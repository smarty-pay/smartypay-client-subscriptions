/*
  SMARTy Pay Subscriptions Client SDK
  @author Evgeny Dolganov <evgenij.dolganov@gmail.com>
*/
import {TokenMaxAbsoluteAmount, wallet, Web3ApiProvider, Web3Common, TokenZeroAmount} from 'smartypay-client-web3-common';
import {abi, Assets, CurrencyKeys, Subscription, SubscriptionStatus, util} from 'smartypay-client-model';
import {findApiByContactAddress} from './util';
import {getJsonFetcher, postJsonFetcher} from './util/fetch-util';


export {
  TokenMaxAbsoluteAmount,
  TokenZeroAmount
};

export type SmartyPaySubscriptionsBrowserEvent =
  wallet.WalletApiEvent
  | 'subscription-updating'
  | 'subscription-updated';

export type SubscriptionsEvent = util.Event;
export type SubscriptionsEventListener = (event: SubscriptionsEvent)=>void;


export interface SmartyPaySubscriptionsBrowserProp {
  smartyApiUrl?: string,
  checkStatusDelta?: number,
  checkStatusMaxAttempts?: number,
}


export interface ActivateSubscriptionInWalletProps {
  approveAbsoluteAmount?: string,
}


class SmartyPaySubscriptionsBrowserImpl extends wallet.WalletApi<SmartyPaySubscriptionsBrowserEvent> {

  private props: SmartyPaySubscriptionsBrowserProp|undefined;
  private updatingSubscriptions = new Map<string, string>(); // subId - planId

  constructor(props?: SmartyPaySubscriptionsBrowserProp) {
    super('SmartyPaySubscriptionsBrowser');
    this.setApiProps(props);
  }

  setApiProps(props: SmartyPaySubscriptionsBrowserProp|undefined){
    this.props = props;
  }

  addListener(event: SmartyPaySubscriptionsBrowserEvent, listener: SubscriptionsEventListener){
    super.addListener(event as any, listener);
  }

  addGlobalListener(listener: SubscriptionsEventListener){
    super.addGlobalListener(listener);
  }

  removeListener(listener: SubscriptionsEventListener) {
    super.removeListener(listener);
  }

  getUpdatingSubscriptions(): string[]{
    const subscriptionsSet = this.updatingSubscriptions.keys();
    return Array.from(subscriptionsSet);
  }

  getUpdatingSubscriptionsPlans(): string[]{
    const plansSet = new Set(this.updatingSubscriptions.values());
    return Array.from(plansSet);
  }

  async activateSubscriptionInWallet(
    subscriptionGetter: ()=>Promise<Subscription>,
    props?: ActivateSubscriptionInWalletProps,
  ){
    await this.useApiLock('activateSubscription', async ()=>{

      const wallet = this.getActiveWallet();
      const address = await wallet.getAddress();
      const subscription = await subscriptionGetter();

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

      // use target network in wallet before start operation
      await Web3Common.switchWalletToAssetNetwork(wallet, token);

      const amountToPay = Web3Common.toAbsoluteForm(amount, token);

      const curBalanceVal = await Web3Common.getTokenBalance(token, address);
      const curBalance = Web3Common.toAbsoluteForm(curBalanceVal, token);
      if(amountToPay.gt(curBalance)){
        throw util.makeError(`Not enough ${token.abbr} token funds to activate the subscription`);
      }

      // take approval from wallet to spend a token by subscription contract
      let resultTx: string;
      try {
        resultTx = await Web3Common.walletTokenApprove(
          wallet,
          token,
          address,
          contractAddress,
          props?.approveAbsoluteAmount || TokenMaxAbsoluteAmount
        );
        this.fireEvent('blockchain-transaction', 'token-approve-tx', resultTx);
      } catch (e){
        // skip long error info
        throw util.makeError(this.name, 'Can not approve token amount.');
      }

      await this.directApiNotification(subscription, resultTx, 'Active');
    })
  }

  async pauseSubscriptionInWallet(subscriptionGetter: ()=>Promise<Subscription>){
    await this.useApiLock('pauseSubscriptionInWallet', async ()=>{

      const wallet = this.getActiveWallet();
      const subscription = await subscriptionGetter();

      const {
        contractAddress,
        status,
      } = subscription;

      // subscription can't be paused
      if(status !== 'Active'){
        return;
      }

      let resultTx;
      try {
        const contract = await Web3Common.getContractForWallet(wallet, contractAddress, abi.SubscriptionABI);
        const txResp = await contract.freeze();
        const {transactionHash} = await txResp.wait();
        resultTx = transactionHash;
        this.fireEvent('blockchain-transaction', 'subscription-pause-tx', resultTx);
      } catch (e){
        // skip long error info
        throw util.makeError(this.name, 'Can not pause subscription.');
      }

      await this.directApiNotification(subscription, resultTx, 'Paused');
    });
  }


  async unPauseSubscriptionInWallet(subscriptionGetter: ()=>Promise<Subscription>){
    await this.useApiLock('unPauseSubscriptionInWallet', async ()=>{

      const wallet = this.getActiveWallet();
      const subscription = await subscriptionGetter();

      const {
        contractAddress,
        status,
      } = subscription;

      // subscription can't be unpause
      if(status !== 'Paused'){
        return;
      }

      let resultTx;
      try {
        const contract = await Web3Common.getContractForWallet(wallet, contractAddress, abi.SubscriptionABI);
        const txResp = await contract.unfreeze();
        const {transactionHash} = await txResp.wait();
        resultTx = transactionHash;
        this.fireEvent('blockchain-transaction', 'subscription-unpause-tx', resultTx);
      } catch (e){
        // skip long error info
        throw util.makeError(this.name, 'Can not unpause subscription.');
      }

      await this.directApiNotification(subscription, resultTx, 'Active');
    });
  }


  async cancelSubscriptionInWallet(subscriptionGetter: ()=>Promise<Subscription>){
    await this.useApiLock('cancelSubscriptionInWallet', async ()=>{

      const wallet = this.getActiveWallet();
      const address = await wallet.getAddress();
      const subscription = await subscriptionGetter();

      const {
        asset,
        contractAddress
      } = subscription;

      const currency = CurrencyKeys.find(c => c === asset);
      if( ! currency || currency === 'UNKNOWN'){
        throw util.makeError('Unknown subscription asset', asset);
      }

      const token = Assets[currency];


      // take approval from wallet to spend a token by subscription contract
      let resultTx: string;
      try {
        resultTx = await Web3Common.walletTokenApprove(
          wallet,
          token,
          address,
          contractAddress,
          TokenZeroAmount
        );
        this.fireEvent('blockchain-transaction', 'token-approve-tx', resultTx);
      } catch (e){
        // skip long error info
        throw util.makeError(this.name, 'Can not deactivate subscription.');
      }

      await this.directApiNotification(subscription, resultTx);
    })
  }





  private async directApiNotification(
    subscription: Subscription,
    resultTx: string,
    targetStatus?: SubscriptionStatus,
  ){

    const {contractAddress, blockchain} = subscription;
    const apiUrl = await this.getCheckStatusUrl(contractAddress);

    const {isAccepted} = await postJsonFetcher(`${apiUrl}/integration/subscriptions/hint-update-state`, {
      hash: resultTx,
      blockchain,
    });

    if( ! isAccepted){
      throw util.makeError(this.name, 'Can not notify SmartyPay server about subscription');
    }

    // async check subscription status update
    this.waitSubscriptionStatusUpdate(subscription, targetStatus)
      .catch(console.error);
  }

  private async waitSubscriptionStatusUpdate(
    {
      planId,
      contractAddress,
      status: initStatus,
    }: Subscription,
    targetStatus?: SubscriptionStatus){

    // already in set
    if(this.updatingSubscriptions.has(contractAddress)){
      return;
    }

    const apiUrl = await this.getCheckStatusUrl(contractAddress);
    const waitNextTryDelta = this.props?.checkStatusDelta || 6000;
    const stopWaitTimeout = Date.now() + waitNextTryDelta * (this.props?.checkStatusMaxAttempts || 5);

    this.updatingSubscriptions.set(contractAddress, planId);
    this.fireEvent('subscription-updating', contractAddress, planId, true);

    const onDone = ()=>{
      this.updatingSubscriptions.delete(contractAddress);
      this.fireEvent('subscription-updating', contractAddress, planId, false);
      this.fireEvent('subscription-updated', contractAddress, planId);
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