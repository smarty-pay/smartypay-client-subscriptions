/*
  SMARTy Pay Subscriptions Client SDK
  @author Evgeny Dolganov <evgenij.dolganov@gmail.com>
*/


import {ClientWallet} from './client-wallet';

class SmartyPaySubscriptionsBrowserImpl {

  public readonly clientWallet: ClientWallet;

  constructor() {

    this.clientWallet = new ClientWallet();
  }

}



/**
 * Subscriptions browser sdk single instance
 */
export const SmartyPaySubscriptionsBrowser = new SmartyPaySubscriptionsBrowserImpl();