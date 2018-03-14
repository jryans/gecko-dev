/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const protocol = require("devtools/shared/protocol");
const { consoleSpec } = require("devtools/shared/specs/console");
const Services = require("Services");

loader.lazyRequireGetter(this, "ConsoleAPIListener", "devtools/server/actors/webconsole/listeners", true);
loader.lazyRequireGetter(this, "WebConsoleActor", "devtools/server/actors/webconsole", true);

/**
 *
 */
const ConsoleActor = protocol.ActorClassWithSpec(consoleSpec, {

  initialize(conn, context) {
    protocol.Actor.prototype.initialize.call(this, conn);
    this.context = context;
    // TODO(jryans): Just for now, to borrow some methods...
    this.oldConsole = new WebConsoleActor(conn, context);
  },

  start() {
    // TODO(jryans): Change how this filtering context is passed around
    this.listener = new ConsoleAPIListener(this.context.window, this);
    this.listener.init();
  },

  onConsoleAPICall(message) {
    const { processID, processType } = Services.appinfo;
    const { outerWindowID } = this.context;
    message = this.oldConsole.prepareConsoleMessageForRemote(message);
    dump(`P ${processID} T ${processType} W ${outerWindowID} ` +
         `Console API: ${JSON.stringify(message)}\n`);
  },

  destroy() {
    if (this.listener) {
      this.listener.destroy();
      this.listener = null;
    }
    this.context = null;
    this.oldConsole.destroy();
    this.oldConsole = null;
    protocol.Actor.prototype.destroy.call(this);
  },

});

exports.ConsoleActor = ConsoleActor;
