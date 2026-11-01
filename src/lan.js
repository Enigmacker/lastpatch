'use strict';

// LAN-only guard shared by every network probe.
function isPrivateHost(hostname) {
  return (
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^fe80:/i.test(hostname)
  );
}

module.exports = { isPrivateHost };
