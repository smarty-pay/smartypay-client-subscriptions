/*
  SMARTy Pay Subscriptions Client SDK
  @author Evgeny Dolganov <evgenij.dolganov@gmail.com>
*/

const DefaultTimeout = 3000;

export async function getJsonFetcher<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), DefaultTimeout);

  const result = await fetch(url, {
    signal: controller.signal,
  })
    .then(handleRespNotOk)
    .then((res) => res.json() as T);

  clearTimeout(id);

  return result;
}

export async function postJsonFetcher<T>(url: string, reqData?: any): Promise<T> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), DefaultTimeout);

  const result = await fetch(url, {
    method: 'POST',
    body: reqData ? JSON.stringify(reqData) : undefined,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  })
    .then(handleRespNotOk)
    .then((res) => res.json() as T);

  clearTimeout(id);

  return result;
}

export async function handleRespNotOk(resp: any) {
  if (!resp.ok) {
    let msg = resp.statusText;
    try {
      const data = await resp.json();
      msg = data.message || msg;
    } catch (e) {
      // skip
    }
    throw new Error(msg);
  }
  return resp;
}
