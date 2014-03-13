/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

let loader = Cc["@mozilla.org/moz/jssubscript-loader;1"]
             .getService(Ci.mozIJSSubScriptLoader);
loader.loadSubScript(
  "resource://gre/modules/devtools/transport/segments.js", this);
loader.loadSubScript(
  "resource://gre/modules/devtools/transport/packets.js", this);

function run_test() {
  add_test(test_packet_done);
  run_next_test();
}

// Ensure done can be checked without getting an error
function test_packet_done() {
  let json = new JSONPacket();
  do_check_false(!!json.done);

  let bulk = new BulkPacket();
  do_check_false(!!bulk.done);

  run_next_test();
}
