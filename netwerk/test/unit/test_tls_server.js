/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { classes: Cc, utils: Cu, interfaces: Ci } = Components;

// Need profile dir to store the key / cert
do_get_profile();
// Ensure PSM is initialized
Cc["@mozilla.org/psm;1"].getService(Ci.nsISupports);

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

  let lastServerTransport;
  let sInput, sOutput;

  let listener = {
    onSocketAccepted: function(socket, transport) {
      dump("ACCEPT TLS\n");
      lastServerTransport = transport;
      sInput = transport.openInputStream(0, 0, 0);
      sOutput = transport.openOutputStream(0, 0, 0);

      sInput.asyncWait({
        onInputStreamReady: function(input) {
          try {
            dump("INPUT: " + input.available() + "\n");
          } catch (e) {
            dump("INPUT ERROR:" + e + "\n");
          }
        }
      }, 0, 0, Services.tm.currentThread);
    },
    onStopListening: function() {
      dump("STOP\n");
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
      dump("STATUS: " + status + "\n");
    }
  }, Services.tm.currentThread);

  let input = transport.openInputStream(0, 0, 0);
  let output = transport.openOutputStream(0, 0, 0);

  let clientSecInfo = transport.securityInfo;
  let tlsControl = clientSecInfo.QueryInterface(Ci.nsISSLSocketControl);
  tlsControl.desiredClientCert = cert;

  input.asyncWait({
    onInputStreamReady: function(is) {
      try {
        dump("CLI INPUT: " + is.available() + "\n");
      } catch (e) {
        // Bad cert is known here!
        dump("CLI INPUT ERROR:" + e + "\n");
        let SEC_ERROR_BASE = Ci.nsINSSErrorsService.NSS_SEC_ERROR_BASE;
        let SEC_ERROR_UNKNOWN_ISSUER = SEC_ERROR_BASE + 13;
        let errorCode = -1 * (e.result & 0xFFFF);
        if (errorCode == SEC_ERROR_UNKNOWN_ISSUER) {
          dump("C doesn't like S cert\n");
        }
      }
    }
  }, 0, 0, Services.tm.currentThread);

  output.asyncWait({
    onOutputStreamReady: function(output) {
      try {
        output.write("HELLO", 5);
        dump("WRITE SUCCESS\n");
      } catch (e) {
        dump("WRITE FAILED: " + e.result + "\n");
        let SSL_ERROR_BASE = Ci.nsINSSErrorsService.NSS_SSL_ERROR_BASE;
        let SSL_ERROR_BAD_CERT_ALERT = SSL_ERROR_BASE + 17;
        let errorCode = -1 * (e.result & 0xFFFF);
        if (errorCode == SSL_ERROR_BAD_CERT_ALERT) {
          // Server didn't like client cert
          dump("S doesn't like C cert\n");
        }
      }
    }
  }, 0, 0, Services.tm.currentThread);
}

add_task(function*() {
  let cert = yield getCert();
  ok(!!cert, "Got self-signed cert");
  //startServer(cert);
  //storeCertOverride(cert);
  //startClient(cert);
});
