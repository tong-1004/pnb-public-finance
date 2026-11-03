export const SEPOLIA_CHAIN_ID = "0xaa36a7";
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const HASH = /^0x[a-fA-F0-9]{64}$/;

export function parseEthToWei(input) {
  if (typeof input !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(input)) throw new Error("ETH amount must be a positive decimal with at most 18 places");
  const [whole, fraction = ""] = input.split(".");
  const wei = BigInt(whole) * 10n ** 18n + BigInt((fraction + "0".repeat(18)).slice(0, 18));
  if (wei <= 0n) throw new Error("ETH amount must be greater than zero");
  if (wei > 10n ** 18n) throw new Error("Sepolia pilot is limited to 1 test ETH per transaction");
  return wei;
}

export function validateRecipient(address) {
  if (typeof address !== "string" || !ADDRESS.test(address) || /^0x0{40}$/i.test(address)) throw new Error("Recipient must be a nonzero Ethereum address");
  return address;
}

export async function prepareSepoliaTransfer(provider, recipient, amount) {
  if (!provider || typeof provider.request !== "function") throw new Error("No EIP-1193 wallet is available");
  const to = validateRecipient(recipient);
  const value = parseEthToWei(amount);
  const chainId = await provider.request({ method: "eth_chainId" });
  if (typeof chainId !== "string" || chainId.toLowerCase() !== SEPOLIA_CHAIN_ID) throw new Error("Wallet must be on Sepolia (chain ID 11155111)");
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || !ADDRESS.test(accounts[0] ?? "")) throw new Error("Wallet did not provide an account");
  if (accounts[0].toLowerCase() === to.toLowerCase()) throw new Error("Sender and recipient must differ");
  return { from: accounts[0], to, value: `0x${value.toString(16)}` };
}

export async function sendSepoliaTransfer(provider, transaction) {
  if (!provider || typeof provider.request !== "function" || !transaction || !ADDRESS.test(transaction.from ?? "") || !ADDRESS.test(transaction.to ?? "") || !/^0x[1-9a-f][0-9a-f]*$/i.test(transaction.value ?? "") || BigInt(transaction.value) > 10n ** 18n || transaction.from.toLowerCase() === transaction.to.toLowerCase()) throw new Error("Invalid Sepolia transfer preview");
  const chainId = await provider.request({ method: "eth_chainId" });
  if (typeof chainId !== "string" || chainId.toLowerCase() !== SEPOLIA_CHAIN_ID) throw new Error("Wallet network changed before sending");
  const accounts = await provider.request({ method: "eth_accounts" });
  if (!Array.isArray(accounts) || accounts[0]?.toLowerCase() !== transaction.from.toLowerCase()) throw new Error("Wallet account changed before sending");
  const hash = await provider.request({ method: "eth_sendTransaction", params: [transaction] });
  if (typeof hash !== "string" || !HASH.test(hash)) throw new Error("Wallet did not return a transaction hash");
  return hash;
}
