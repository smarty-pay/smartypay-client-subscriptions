/*
  SMARTy Pay Subscriptions Client SDK
  @author Evgeny Dolganov <evgenij.dolganov@gmail.com>
*/
import {urls, Assets, CurrencyKeys, Subscription, Token} from 'smartypay-client-model';
import {getJsonFetcher} from './fetch-util';
import {Web3Common} from 'smartypay-client-web3-common';

let cachedApiUrl: string|undefined;

export async function findApiByContactAddress(contractAddress: string): Promise<string|undefined> {

  if(cachedApiUrl){
    return cachedApiUrl;
  }

  const checkApis = [
    urls.SmartyPayApi.prod,
    urls.SmartyPayApi.staging,
    urls.SmartyPayApi.dev,
  ]

  for(const apiUrl of checkApis){
    try {

      await getJsonFetcher(`${apiUrl}/integration/subscriptions/${contractAddress}/status`);
      cachedApiUrl = apiUrl;

      return apiUrl;

    } catch (e){
      // not this api
    }
  }

  return undefined;
}



export function isEndingSubscription(subscription: Subscription|undefined): boolean {

  if( ! subscription
      || subscription.status !== 'Active'){
    return false;
  }

  const currency = CurrencyKeys.find(c => c === subscription.asset);
  if( ! currency || currency === 'UNKNOWN'){
    return false;
  }

  const token: Token = Assets[currency];

  const [amountVal] = subscription.amount.split(' ');
  const [allowanceVal] = subscription.allowance.split(' ');

  const amountToPay = Web3Common.toAbsoluteForm(amountVal || '0', token);
  const allowance = Web3Common.toAbsoluteForm(allowanceVal || '0', token);

  return amountToPay.gt(allowance);
}