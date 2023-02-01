/*
  SMARTy Pay Subscriptions Client SDK
  @author Evgeny Dolganov <evgenij.dolganov@gmail.com>
*/
import {
  clearLastWeb3ApiName,
  getLastWeb3ApiName,
  storeLastWeb3ApiName,
  Web3Api,
  Web3ApiEvent,
  Web3ApiProvider
} from 'smartypay-client-web3-common';
import {
  Subscription,
  SubscriptionCharge,
  SubscriptionChargeStatus,
  SubscriptionId,
  SubscriptionPlan,
  SubscriptionPlanStatus,
  SubscriptionStatus,
  util,
} from 'smartypay-client-model';

export {
  SubscriptionPlan,
  SubscriptionPlanStatus,
  Subscription,
  SubscriptionStatus,
  SubscriptionId,
  SubscriptionCharge,
  SubscriptionChargeStatus,
}


export type SmartyPaySubscriptionsBrowserEvent =
  Web3ApiEvent
  | 'wallet-connecting'
  | 'api-locked'
  | 'api-unlocked'
  | 'api-error';


const Name = 'SmartyPaySubscriptionsBrowser';


class SmartyPaySubscriptionsBrowserImpl {

  private listeners = new util.ListenersMap<SmartyPaySubscriptionsBrowserEvent>();
  private lockOperation: string|undefined;

  // wallet state
  private activeWalletApi: Web3Api|undefined;
  private oldWalletApis = new Map<string, Web3Api>();
  private walletConnecting = false;

  // api state
  private apiLastError: any = undefined;

  addListener(event: SmartyPaySubscriptionsBrowserEvent, listener: (...args: any[])=>void){
    this.listeners.addListener(event, listener);
  }

  removeListener(listener: (...args: any[])=>void){
    this.listeners.removeListener(listener);
  }

  async connectToWallet(provider: Web3ApiProvider){
    await this.useApiLock('connectToWallet', async ()=>{

      const walletName = provider.name();

      if(this.activeWalletApi && this.activeWalletApi.name() !== walletName){
        throw util.makeError(Name, 'Already using other wallet', this.activeWalletApi.name());
      }

      // use old wallet if can
      let wallet = this.oldWalletApis.get(walletName);
      if( ! wallet){

        // make new instance
        wallet = provider.makeWeb3Api();
        this.oldWalletApis.set(walletName, wallet);

        // re-translate events
        wallet.addListener('wallet-connected', ()=>{
          this.listeners.fireEvent('wallet-connected', walletName);
        });
        wallet.addListener('wallet-disconnected', ()=>{
          this.listeners.fireEvent('wallet-disconnected', walletName);
        });
        wallet.addListener('wallet-account-changed', (newAddress: string)=>{
          this.listeners.fireEvent('wallet-account-changed', newAddress);
        });
        wallet.addListener('wallet-network-changed', (chainId: number)=>{
          this.listeners.fireEvent('wallet-network-changed', chainId);
        });
      }

      this.activeWalletApi = wallet;

      // connect to wallet
      this.walletConnecting = true;
      this.listeners.fireEvent('wallet-connecting', true);
      try {

        await wallet.connect();
        storeLastWeb3ApiName(walletName);

      } catch (e){

        // no need of non-connected active wallet
        this.activeWalletApi = undefined;
        clearLastWeb3ApiName();

        throw e;

      } finally {
        this.walletConnecting = false;
        this.listeners.fireEvent('wallet-connecting', false);
      }
    });
  }

  getOldConnectedWallet(){
    return getLastWeb3ApiName();
  }

  getWalletName(): string|undefined{
    return this.activeWalletApi?.name();
  }

  isWalletConnected(){
    return this.activeWalletApi?.isConnected() || false;
  }

  isWalletConnecting(){
    return this.walletConnecting;
  }

  async getWalletAddress(){
    if(this.activeWalletApi && this.activeWalletApi.isConnected()){
      return this.activeWalletApi.getAddress();
    }
    return undefined;
  }

  async getWalletChainId(){
    if(this.activeWalletApi && this.activeWalletApi.isConnected()){
      return this.activeWalletApi.getChainId();
    }
    return undefined;
  }

  async disconnectFromWallet(){
    await this.useApiLock('disconnectFromWallet', async ()=>{
      if( ! this.activeWalletApi){
        return;
      }
      const wallet = this.activeWalletApi;
      this.activeWalletApi = undefined;
      clearLastWeb3ApiName();

      try {
        await wallet.disconnect();
      } catch (e){
        console.warn(`${Name}: Can not correctly disconnect the wallet ${wallet.name()}`, e);
      }
    });
  }

  isApiLocked(){
    return !! this.lockOperation;
  }

  getApiLastError(){
    return this.apiLastError;
  }


  private async useApiLock<T>(
    opName: string,
    call: (...args: any[])=>Promise<T>
  ): Promise<T|undefined> {

    // use only one blocking operation
    if(this.lockOperation){
      console.warn(`${Name}: Can't call operation "${opName}" because api is locked by "${this.lockOperation}"`);
      return undefined;
    }


    let result: any;
    let resultError: any;

    this.lockOperation = opName;
    this.listeners.fireEvent('api-locked', opName);
    try {
      result = await call();
    }
    catch (e){
      resultError = e;
    }
    finally {
      this.lockOperation = undefined;
      this.listeners.fireEvent('api-unlocked', opName);
    }

    if(resultError){
      this.updateApiLastError(resultError);
      throw resultError;
    } else {
      return result;
    }
  }

  private getActiveWallet(): Web3Api {
    if(!this.activeWalletApi){
      throw util.makeError(Name, 'No wallet to use');
    }
    return this.activeWalletApi;
  }

  private updateApiLastError(error: any){
    this.apiLastError = error;
    this.listeners.fireEvent('api-error', error);
  }
}



/**
 * Subscriptions browser sdk single instance
 */
export const SmartyPaySubscriptionsBrowser = new SmartyPaySubscriptionsBrowserImpl();



export async function restoreOldWalletConnectionFromAny(...providers: Web3ApiProvider[]): Promise<boolean>{
  const oldConnectedWalletName = SmartyPaySubscriptionsBrowser.getOldConnectedWallet();
  const provider = providers.find(p => p.name() === oldConnectedWalletName);
  if(provider){
    return restoreOldWalletConnection(provider);
  } else {
    return false;
  }
}

async function restoreOldWalletConnection(provider: Web3ApiProvider): Promise<boolean>{

  const oldConnectedWalletName = SmartyPaySubscriptionsBrowser.getOldConnectedWallet();
  if( oldConnectedWalletName !== provider.name()){
    return false;
  }

  // wallet already connected
  if(SmartyPaySubscriptionsBrowser.isWalletConnected()){
    return false;
  }

  try {
    await SmartyPaySubscriptionsBrowser.connectToWallet(provider);
    return true;
  } catch (e){
    console.error(`${Name}: Can not connect to wallet`, e);
    return false;
  }
}