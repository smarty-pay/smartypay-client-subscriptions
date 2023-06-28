/*
  SMARTy Pay Subscriptions Client SDK
  @author Evgeny Dolganov <evgenij.dolganov@gmail.com>
*/
import {
  TokenMaxAbsoluteAmount,
  TokenZeroAmount,
  wallet,
  Web3ApiProvider,
  Web3Common
} from 'smartypay-client-web3-common';
import {abi, getTokenByCurrency, getAmountWithTokenLabel, Subscription, SubscriptionStatus, util} from 'smartypay-client-model';
import {findApiByContactAddress} from './util';
import {getJsonFetcher, postJsonFetcher} from './util/fetch-util';


export {
  TokenMaxAbsoluteAmount,
  TokenZeroAmount,
  getTokenByCurrency,
  getAmountWithTokenLabel,
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

  async isValidBalanceToPay(subscription: Subscription): Promise<boolean> {

    const wallet = this.getActiveWallet();
    const address = await wallet.getAddress();

    const {
      amount: amountVal,
    } = subscription;

    const [amount, asset] = amountVal.split(' ');

    const token = getTokenByCurrency(asset);

    // use target network in wallet before start operation
    await Web3Common.switchWalletToAssetNetwork(wallet, token);

    const amountToPay = Web3Common.toAbsoluteForm(amount, token);

    const curBalanceVal = await Web3Common.getTokenBalance(token, address);
    const curBalance = Web3Common.toAbsoluteForm(curBalanceVal, token);

    return curBalance.gte(amountToPay);
  }

  async activateSubscriptionInWallet(
    subscriptionGetter: ()=>Promise<Subscription|undefined>,
    props?: ActivateSubscriptionInWalletProps,
  ){
    await this.useApiLock('activateSubscription', async ()=>{

      const subscription = await subscriptionGetter();
      if( ! subscription){
        return;
      }

      const wallet = this.getActiveWallet();
      const address = await wallet.getAddress();

      const {
        asset,
        contractAddress
      } = subscription;

      const token = getTokenByCurrency(asset);

      const isValidBalance = await this.isValidBalanceToPay(subscription);
      if( ! isValidBalance){
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
        throw util.errorCtx(util.makeError(this.name, 'Can not approve token amount.'),{
          originalError: e
        });
      }

      await this.directApiNotification(subscription, resultTx, {
        targetStatus: 'Active'
      });
    })
  }

  async pauseSubscriptionInWallet(subscriptionGetter: ()=>Promise<Subscription|undefined>){
    await this.useApiLock('pauseSubscriptionInWallet', async ()=>{

      const subscription = await subscriptionGetter();
      if( ! subscription){
        return;
      }

      const wallet = this.getActiveWallet();

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
        throw util.errorCtx(util.makeError(this.name, 'Can not pause subscription.'),{
          originalError: e
        });
      }

      await this.directApiNotification(subscription, resultTx, {
        targetStatus: 'Paused'
      });
    });
  }


  async unPauseSubscriptionInWallet(subscriptionGetter: ()=>Promise<Subscription|undefined>){
    await this.useApiLock('unPauseSubscriptionInWallet', async ()=>{

      const subscription = await subscriptionGetter();
      if( ! subscription){
        return;
      }

      const wallet = this.getActiveWallet();

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
        throw util.errorCtx(util.makeError(this.name, 'Can not unpause subscription.'),{
          originalError: e
        });
      }

      await this.directApiNotification(subscription, resultTx, {
        targetStatus: 'Active'
      });
    });
  }


  async cancelSubscriptionInWallet(subscriptionGetter: ()=>Promise<Subscription|undefined>){
    await this.useApiLock('cancelSubscriptionInWallet', async ()=>{

      const subscription = await subscriptionGetter();
      if( ! subscription){
        return;
      }

      // take approval from wallet to spend a token by subscription contract
      let resultTx: string;
      try {
        resultTx = await this.walletTokenApprove(TokenZeroAmount, subscription);
      } catch (e){
        // skip long error info
        throw util.errorCtx(util.makeError(this.name, 'Can not deactivate subscription.'), {
          originalError: e
        });
      }

      await this.directApiNotification(subscription, resultTx, {
        targetAllowanceIsLessThan: subscription.amount
      });
    })
  }


  async changeSubscriptionAllowanceInWallet(
    subscriptionGetter: ()=>Promise<Subscription>,
    approveAbsoluteAmount?: string,
  ){
    await this.useApiLock('changeSubscriptionAllowanceInWallet', async ()=>{

      const subscription = await subscriptionGetter();

      // take approval from wallet to spend a token by subscription contract
      let resultTx: string;
      try {
        resultTx = await this.walletTokenApprove(approveAbsoluteAmount || TokenMaxAbsoluteAmount, subscription);
      } catch (e){
        // skip long error info
        throw util.errorCtx(util.makeError(this.name, 'Can not change allowance.'), {
          originalError: e
        });
      }

      await this.directApiNotification(subscription, resultTx, {
        skipWaitSubscriptionUpdate: true
      });
    })
  }


  async getContractStatus(contractAddress: string): Promise<SubscriptionStatus> {
    const apiUrl = await this.getCheckStatusUrl(contractAddress);
    const {status} = await getJsonFetcher(`${apiUrl}/integration/subscriptions/${contractAddress}/status`);
    return status as SubscriptionStatus;
  }

  private async walletTokenApprove(
    approveAbsoluteAmount: string,
    subscription: Subscription
  ){

    const wallet = this.getActiveWallet();
    const address = await wallet.getAddress();

    const {
      asset,
      contractAddress
    } = subscription;

    const token = getTokenByCurrency(asset);

    // take approval from wallet to spend a token by subscription contract
    const resultTx = await Web3Common.walletTokenApprove(
      wallet,
      token,
      address,
      contractAddress,
      approveAbsoluteAmount,
    );

    this.fireEvent('blockchain-transaction', 'token-approve-tx', resultTx);

    return resultTx;
  }


  private async directApiNotification(
    subscription: Subscription,
    resultTx: string,
    props?: WaitSubscriptionUpdateProps,
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

    const skipWait = !! props?.skipWaitSubscriptionUpdate;
    if( ! skipWait) {
      // async check subscription status update
      this.waitSubscriptionUpdate(subscription, props)
        .catch(console.error);
    }
  }

  private async waitSubscriptionUpdate(
    {
      planId,
      contractAddress,
      status: initStatus,
      asset,
      amount,
      payer,
    }: Subscription,
    props?: WaitSubscriptionUpdateProps
  ){

    // already in set
    if(this.updatingSubscriptions.has(contractAddress)){
      return;
    }

    const token = getTokenByCurrency(asset);

    const checkUpdateByAllowanceLess = !! props?.targetAllowanceIsLessThan;
    const checkUpdateByStatus = ! checkUpdateByAllowanceLess;

    const waitNextTryDelta = this.props?.checkStatusDelta || 6000;
    const stopWaitTimeout = Date.now() + waitNextTryDelta * (this.props?.checkStatusMaxAttempts || 5);

    this.updatingSubscriptions.set(contractAddress, planId);

    this.fireEvent(
      'subscription-updating',
      contractAddress,
      planId,
      true,
      {
        checkUpdateByStatus,
        checkUpdateByAllowanceLess,
      });

    const onDone = ()=>{
      this.updatingSubscriptions.delete(contractAddress);
      this.fireEvent('subscription-updating', contractAddress, planId, false);
      this.fireEvent('subscription-updated', contractAddress, planId);
    }

    while(Date.now() <= stopWaitTimeout){

      // wait delta
      await util.waitTimeout(waitNextTryDelta);

      // check update by status change
      if(checkUpdateByStatus){

        const status = await this.getContractStatus(contractAddress);
        if(status !== initStatus
          && (status === 'Error' || !props?.targetStatus || props?.targetStatus === status)){
          onDone();
          return;
        }
      }
      // check update by allowance
      else if(checkUpdateByAllowanceLess){

        const [amountVal] = amount.split(' ');
        const allowanceVal = await Web3Common.getTokenAllowance(token, payer, contractAddress);

        const amountToPay = Web3Common.toAbsoluteForm(amountVal || '0', token);
        const allowance = Web3Common.toAbsoluteForm(allowanceVal || '0', token);
        if(amountToPay.gt(allowance)){
          onDone();
          return;
        }
      }
      // unknown to check
      else {
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


interface WaitSubscriptionUpdateProps {
  skipWaitSubscriptionUpdate?: boolean,
  targetStatus?: SubscriptionStatus,
  targetAllowanceIsLessThan?: string,
}


/**
 * Subscriptions browser sdk single instance
 */
export const SmartyPaySubscriptionsBrowser = new SmartyPaySubscriptionsBrowserImpl();

export async function restoreOldWalletConnectionFromAny(...providers: Web3ApiProvider[]): Promise<boolean>{
  return wallet.restoreOldWalletConnectionFromAny(SmartyPaySubscriptionsBrowser, ...providers);
}


export function isEndingSubscription(subscription: Subscription|undefined): boolean {

  if( ! subscription || subscription.status !== 'Active'){
    return false;
  }

  const token = getTokenByCurrency(subscription.asset);

  const [amountVal] = subscription.amount.split(' ');
  const [allowanceVal] = subscription.allowance.split(' ');

  const amountToPay = Web3Common.toAbsoluteForm(amountVal || '0', token);
  const allowance = Web3Common.toAbsoluteForm(allowanceVal || '0', token);

  return amountToPay.gt(allowance);
}