// Bug 960397: UDP multicast options

const CC = Components.Constructor;

const UDPSocket = CC("@mozilla.org/network/udp-socket;1",
                     "nsIUDPSocket",
                     "init");
const { Promise: promise } = Cu.import("resource://gre/modules/Promise.jsm", {});

const PORT = 50624;
const ADDRESS = "224.0.0.255";
const TIMEOUT = 2000;

let gSocket;
let gListener = {
  onPacketReceived: function(socket, message) {},
  onStopListening: function(socket, status) {}
};
let gConverter;

function run_test() {
  setup();
  run_next_test();
}

function setup() {
  gConverter = Cc["@mozilla.org/intl/scriptableunicodeconverter"].
               createInstance(Ci.nsIScriptableUnicodeConverter);
  gConverter.charset = "utf8";

  gSocket = new UDPSocket(PORT, false);
  gSocket.asyncListen(gListener);
}

function sendPing() {
  let ping = "ping";
  let rawPing = gConverter.convertToByteArray(ping);

  let deferred = promise.defer();

  gListener.onPacketReceived = (socket, message) => {
    do_check_eq(message.data, ping);
    deferred.resolve(message.data);
  };

  gSocket.send(ADDRESS, PORT, rawPing, rawPing.length);

  // Timers are bad, but it seems like the only way to test *not* getting a
  // packet.
  let timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
  timer.initWithCallback(() => {
    deferred.reject();
  }, TIMEOUT, Ci.nsITimer.TYPE_ONE_SHOT);

  return deferred.promise;
}

add_test(() => {
  do_print("Joining multicast group");
  gSocket.joinMulticast(ADDRESS);
  sendPing().then(
    run_next_test,
    () => do_throw("Joined group, but no packet received")
  );
});

add_test(() => {
  do_print("Disabling multicast loopback");
  gSocket.multicastLoopback = false;
  sendPing().then(
    () => do_throw("Loopback disabled, but still got a packet"),
    run_next_test
  );
  gSocket.multicastLoopback = true;
});

add_test(() => {
  do_print("Changing multicast interface");
  gSocket.multicastInterface = "0.0.0.1";
  sendPing().then(
    () => do_throw("Changed interface, but still got a packet"),
    run_next_test
  );
  gSocket.multicastInterface = "0.0.0.0";
});

add_test(() => {
  do_print("Leaving multicast group");
  gSocket.leaveMulticast(ADDRESS);
  sendPing().then(
    () => do_throw("Left group, but still got a packet"),
    run_next_test
  );
});

do_register_cleanup(() => {
  gSocket.close();
});
