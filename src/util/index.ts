/*
  Smarty Pay Subscriptions Client SDK
  @author Evgeny Dolganov <evgenij.dolganov@gmail.com>
*/
import { urls } from 'smartypay-client-model';

import { getJsonFetcher } from './fetch-util';

let cachedApiUrl: string | undefined;

export async function findApiByContactAddress(contractAddress: string): Promise<string | undefined> {
  if (cachedApiUrl) {
    return cachedApiUrl;
  }

  const checkApis = [urls.SmartyPayApi.prod, urls.SmartyPayApi.staging, urls.SmartyPayApi.dev];

  for (const apiUrl of checkApis) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await getJsonFetcher(`${apiUrl}/integration/subscriptions/${contractAddress}/status`);
      cachedApiUrl = apiUrl;

      return apiUrl;
    } catch (e) {
      // not this api
    }
  }

  return undefined;
}
