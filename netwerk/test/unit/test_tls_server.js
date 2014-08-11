/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// Need profile dir to store the key / cert
do_get_profile();
// Ensure PSM is initialized
Cc["@mozilla.org/psm;1"].getService(Ci.nsISupports);

const { Services } = Cu.import("resource://gre/modules/Services.jsm", {});
const { NetUtil } = Cu.import("resource://gre/modules/NetUtil.jsm", {});
const { Promise: promise } =
  Cu.import("resource://gre/modules/Promise.jsm", {});
const certService = Cc["@mozilla.org/security/local-cert-service;1"]
                    .getService(Ci.nsILocalCertService);
const certOverrideService = Cc["@mozilla.org/security/certoverride;1"]
                            .getService(Ci.nsICertOverrideService);
const socketTransportService =
  Cc["@mozilla.org/network/socket-transport-service;1"]
  .getService(Ci.nsISocketTransportService);

function run_test() {
  run_next_test();
}

function getCert() {
  let deferred = promise.defer();
  certService.getOrCreateCert("tls-test", {
    handleCert: function(c, rv) {
      if (rv) {
        deferred.reject(rv);
        return;
      }
      deferred.resolve(c);
    }
  });
  return deferred.promise;
}

function startServer(cert) {
  let tlsServer = Cc["@mozilla.org/network/tls-server-socket;1"]
                  .createInstance(Ci.nsITLSServerSocket);
  // TODO: Change to any free port
  tlsServer.init(6080, false, -1);
  tlsServer.serverCert = cert;

  let sInput, sOutput;

  let listener = {
    onSocketAccepted: function(socket, transport) {
      do_print("ACCEPT TLS");
      sInput = transport.openInputStream(0, 0, 0);
      sOutput = transport.openOutputStream(0, 0, 0);

      let connectionInfo = transport.securityInfo
                           .QueryInterface(Ci.nsITLSServerConnectionInfo);
      let tlsStatus = connectionInfo.tlsStatus;
      ok(!!tlsStatus.serverCert, "Has peer cert");
      ok(tlsStatus.serverCert.equals(cert), "Peer cert matches expected cert");

      sInput.asyncWait({
        onInputStreamReady: function(input) {
          NetUtil.asyncCopy(input, sOutput);
        }
      }, 0, 0, Services.tm.currentThread);
    },
    onStopListening: function() {
      do_print("STOP");
    }
  };

  tlsServer.sessionCache = false;
  tlsServer.sessionTickets = false;
  tlsServer.requestCertificate = Ci.nsITLSServerSocket.REQUEST_ALWAYS;

  tlsServer.asyncListen(listener);
}

function storeCertOverride(cert) {
  let overrideBits = Ci.nsICertOverrideService.ERROR_UNTRUSTED |
                     Ci.nsICertOverrideService.ERROR_MISMATCH;
  certOverrideService.rememberValidityOverride("127.0.0.1", 6080, cert,
                                               overrideBits, false);
}

function startClient(cert) {
  let transport =
    socketTransportService.createTransport(["ssl"], 1, "127.0.0.1", 6080, null);

  transport.setEventSink({
    onTransportStatus: function(t, status) {
      do_print("STATUS: " + status);
    }
  }, Services.tm.currentThread);

  let input = transport.openInputStream(0, 0, 0);
  let output = transport.openOutputStream(0, 0, 0);

  let clientSecInfo = transport.securityInfo;
  let tlsControl = clientSecInfo.QueryInterface(Ci.nsISSLSocketControl);
  tlsControl.clientCert = cert;

  let inputDeferred = promise.defer();
  input.asyncWait({
    onInputStreamReady: function(is) {
      try {
        do_print("CLI INPUT: " + is.available());
        let data = NetUtil.readInputStreamToString(is, is.available());
        equal(data, "HELLO", "Echoed data received");
        inputDeferred.resolve();
      } catch (e) {
        // Bad cert is known here!
        do_print("CLI INPUT ERROR:" + e);
        let SEC_ERROR_BASE = Ci.nsINSSErrorsService.NSS_SEC_ERROR_BASE;
        let SEC_ERROR_UNKNOWN_ISSUER = SEC_ERROR_BASE + 13;
        let errorCode = -1 * (e.result & 0xFFFF);
        if (errorCode == SEC_ERROR_UNKNOWN_ISSUER) {
          do_print("C doesn't like S cert");
        }
        inputDeferred.reject();
      }
    }
  }, 0, 0, Services.tm.currentThread);

  let outputDeferred = promise.defer();
  output.asyncWait({
    onOutputStreamReady: function(output) {
      try {
        output.write("HELLO", 5);
        do_print("WRITE SUCCESS");
        outputDeferred.resolve();
      } catch (e) {
        do_print("WRITE FAILED: " + e.result);
        let SSL_ERROR_BASE = Ci.nsINSSErrorsService.NSS_SSL_ERROR_BASE;
        let SSL_ERROR_BAD_CERT_ALERT = SSL_ERROR_BASE + 17;
        let errorCode = -1 * (e.result & 0xFFFF);
        if (errorCode == SSL_ERROR_BAD_CERT_ALERT) {
          // Server didn't like client cert
          do_print("S doesn't like C cert");
        }
        outputDeferred.reject();
      }
    }
  }, 0, 0, Services.tm.currentThread);

  return promise.all([inputDeferred.promise, outputDeferred.promise]);
}

add_task(function*() {
  let cert = yield getCert();
  ok(!!cert, "Got self-signed cert");
  startServer(cert);
  storeCertOverride(cert);
  yield startClient(cert);
});
