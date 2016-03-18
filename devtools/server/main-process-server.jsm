/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const Ci = Components.interfaces;
const Cu = Components.utils;

const { DevToolsLoader } = Cu.import("resource://devtools/shared/Loader.jsm", {});

this.EXPORTED_SYMBOLS = ["init"];

function init(msg) {
  dump("START MPS\n")

  // Init a custom, invisible DebuggerServer, in order to not pollute the
  // debugger with all devtools modules, nor break the debugger itself with
  // using it in the same process.
  let devtools = new DevToolsLoader();
  devtools.invisibleToDebugger = true;
  devtools.main("devtools/server/main");
  let { DebuggerServer } = devtools;

  DebuggerServer.init();
  DebuggerServer.addBrowserActors();
  DebuggerServer.allowChromeProcess = true;

  let mm = msg.target;
  let prefix = msg.data.prefix;

  // Connect both parent/child processes debugger servers RDP via message
  // managers
  const { ChildDebuggerTransport } =
    devtools.require("devtools/shared/transport/transport");
  let transport = new ChildDebuggerTransport(mm, prefix);
  DebuggerServer._onConnection(transport);

  mm.sendAsyncMessage("DevTools:InitDebuggerServer:Done");

  mm.addMessageListener("debug:content-process-destroy", function onDestroy() {
    mm.removeMessageListener("debug:content-process-destroy", onDestroy);

    DebuggerServer.destroy();
  });
}
