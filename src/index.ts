/*
  SMARTy Pay Subscriptions Client SDK
  @author Evgeny Dolganov <evgenij.dolganov@gmail.com>
*/
import {
  Web3Api,
  Web3ApiEvent,
  Web3ApiProvider,
  storeLastWeb3ApiName,
  clearLastWeb3ApiName,
  getLastWeb3ApiName
} from 'smartypay-client-web3-common';
import {util} from 'smartypay-client-model';


export type SmartyPaySubscriptionsBrowserEvent =
  Web3ApiEvent
  | 'api-locked'
  | 'api-unlocked';


const Name = 'SmartyPaySubscriptionsBrowser';


class SmartyPaySubscriptionsBrowserImpl {

  private listeners = new util.ListenersMap<SmartyPaySubscriptionsBrowserEvent>();
  private lockOperation: string|undefined;

  private activeWalletApi: Web3Api|undefined;
  private oldWalletApis = new Map<string, Web3Api>();

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
      try {

        await wallet.connect();
        storeLastWeb3ApiName(walletName);

      } catch (e){
        // no need of non-connected active wallet
        this.activeWalletApi = undefined;
        clearLastWeb3ApiName();
        throw e;
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

  private async useApiLock<T>(
    opName: string,
    call: (...args: any[])=>Promise<T>
  ): Promise<T|undefined> {

    // use only one blocking operation
    if(this.lockOperation){
      console.warn(`${Name}: Can't call operation "${opName}" because api is locked by "${this.lockOperation}"`);
      return undefined;
    }

    this.lockOperation = opName;
    this.listeners.fireEvent('api-locked', opName);
    try {
      return await call();
    } finally {
      this.lockOperation = undefined;
      this.listeners.fireEvent('api-unlocked', opName);
    }
  }

  private getActiveWallet(): Web3Api {
    if(!this.activeWalletApi){
      throw util.makeError(Name, 'No wallet to use');
    }
    return this.activeWalletApi;
  }
}



/**
 * Subscriptions browser sdk single instance
 */
export const SmartyPaySubscriptionsBrowser = new SmartyPaySubscriptionsBrowserImpl();