import os from 'node:os';

/**
 * Interface names that are wireless on the platforms we care about. This is a
 * heuristic — Node gives us no link-type information — so we phrase the warning
 * as a question, never as a fact.
 */
const WIRELESS_RE = /^(wl|wlan|wlp|wlx|ath|ra|wifi)/i;
const WIRELESS_WORDS = /(wi-?fi|wireless|airport)/i;

/**
 * @typedef {object} Addr
 * @property {string} iface
 * @property {string} address
 * @property {boolean} maybeWireless
 * @property {boolean} maybeEthernet
 */

/**
 * All non-internal IPv4 addresses, most-likely-useful first.
 * @returns {Addr[]}
 */
export function lanAddresses() {
  /** @type {Addr[]} */
  const out = [];
  for (const [iface, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      out.push({
        iface,
        address: info.address,
        maybeWireless: WIRELESS_RE.test(iface) || WIRELESS_WORDS.test(iface),
        maybeEthernet: /^(en|eth|enp|eno|ens)/i.test(iface) && !WIRELESS_WORDS.test(iface),
      });
    }
  }
  // Prefer private ranges players are actually on; docker/vpn bridges last.
  const rank = /** @param {Addr} a */ (a) => {
    if (/^(docker|br-|veth|vmnet|utun|tun|tap|zt)/i.test(a.iface)) return 3;
    if (/^192\.168\./.test(a.address)) return 0;
    if (/^10\./.test(a.address)) return 1;
    return 2;
  };
  return out.sort((a, b) => rank(a) - rank(b));
}

/**
 * @returns {Addr | undefined}
 */
export function bestLanAddress() {
  return lanAddresses()[0];
}
