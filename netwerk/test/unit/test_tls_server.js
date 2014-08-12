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
  tlsServer.init(-1, true, -1);
  tlsServer.serverCert = cert;

  let listener = {
    onSocketAccepted: function(socket, transport) {
      do_print("Accept TLS client connection");
      let input = transport.openInputStream(0, 0, 0);
      let output = transport.openOutputStream(0, 0, 0);

      let connectionInfo = transport.securityInfo
                           .QueryInterface(Ci.nsITLSServerConnectionInfo);
      let status = connectionInfo.status;
      ok(!!status.peerCert, "Has peer cert");
      ok(status.peerCert.equals(cert), "Peer cert matches expected cert");

      equal(status.tlsVersionUsed, Ci.nsITLSClientStatus.TLS_VERSION_1_2,
             "Using TLS 1.2");
      equal(status.cipherName, "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
            "Using expected cipher");
      equal(status.keyLength, 128, "Using 128-bit symmetric key");
      equal(status.secretKeyLength, 128, "Using 128-bit secret key");

      input.asyncWait({
        onInputStreamReady: function(input) {
          NetUtil.asyncCopy(input, output);
        }
      }, 0, 0, Services.tm.currentThread);
    },
    onStopListening: function() {}
  };

  tlsServer.sessionCache = false;
  tlsServer.sessionTickets = false;
  tlsServer.requestCertificate = Ci.nsITLSServerSocket.REQUEST_ALWAYS;

  tlsServer.asyncListen(listener);

  return tlsServer.port;
}

function storeCertOverride(port, cert) {
  let overrideBits = Ci.nsICertOverrideService.ERROR_UNTRUSTED |
                     Ci.nsICertOverrideService.ERROR_MISMATCH;
  certOverrideService.rememberValidityOverride("127.0.0.1", port, cert,
                                               overrideBits, true);
}

function startClient(port, cert) {
  let transport =
    socketTransportService.createTransport(["ssl"], 1, "127.0.0.1", port, null);
  let input = transport.openInputStream(0, 0, 0);
  let output = transport.openOutputStream(0, 0, 0);

  let inputDeferred = promise.defer();
  input.asyncWait({
    onInputStreamReady: function(input) {
      try {
        let data = NetUtil.readInputStreamToString(input, input.available());
        equal(data, "HELLO", "Echoed data received");
        inputDeferred.resolve();
      } catch (e) {
        let SEC_ERROR_BASE = Ci.nsINSSErrorsService.NSS_SEC_ERROR_BASE;
        let SEC_ERROR_UNKNOWN_ISSUER = SEC_ERROR_BASE + 13;
        let errorCode = -1 * (e.result & 0xFFFF);
        if (errorCode == SEC_ERROR_UNKNOWN_ISSUER) {
          do_print("Client doesn't like server cert");
        }
        inputDeferred.reject(e);
      }
    }
  }, 0, 0, Services.tm.currentThread);

  let outputDeferred = promise.defer();
  output.asyncWait({
    onOutputStreamReady: function(output) {
      // Set the cert we want to avoid any cert UI prompts
      let clientSecInfo = transport.securityInfo;
      let tlsControl = clientSecInfo.QueryInterface(Ci.nsISSLSocketControl);
      tlsControl.clientCert = cert;
      try {
        output.write("HELLO", 5);
        do_print("Output to server written");
        outputDeferred.resolve();
      } catch (e) {
        let SSL_ERROR_BASE = Ci.nsINSSErrorsService.NSS_SSL_ERROR_BASE;
        let SSL_ERROR_BAD_CERT_ALERT = SSL_ERROR_BASE + 17;
        let errorCode = -1 * (e.result & 0xFFFF);
        if (errorCode == SSL_ERROR_BAD_CERT_ALERT) {
          do_print("Server doesn't like client cert");
        }
        outputDeferred.reject(e);
      }
    }
  }, 0, 0, Services.tm.currentThread);

  return promise.all([inputDeferred.promise, outputDeferred.promise]);
}

add_task(function*() {
  let cert = yield getCert();
  ok(!!cert, "Got self-signed cert");
  let port = startServer(cert);
  storeCertOverride(port, cert);
  yield startClient(port, cert);
});
