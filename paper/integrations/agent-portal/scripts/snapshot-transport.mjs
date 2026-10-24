// Only immutable, read-only world snapshots use this retry. Never use it for
// account/password/gameplay actions whose result could be unknown.
export async function sendSnapshot(endpoint, {token, body, fetcher=fetch, timeoutMs=10000}) {
  for (let attempt=0; attempt<2; attempt++) {
    try {
      const response=await fetcher(endpoint, {method:'PUT',redirect:'error',
        headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Connection:'close'},
        body,signal:AbortSignal.timeout(timeoutMs)});
      const result=await response.json();
      return {response,result};
    } catch (error) {
      const transient=error.name==='TimeoutError'||['ECONNRESET','ETIMEDOUT','EPIPE','UND_ERR_SOCKET'].includes(error.cause?.code);
      if (attempt || !transient) throw error;
    }
  }
}
